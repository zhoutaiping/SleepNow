#!/usr/bin/env node
/**
 * 晚安开关 · AI 陪伴链路回归测试
 * 用法：node scripts/check-chat.js
 *
 * 覆盖：Prompt 引擎（system 首位 / 场景差异 / 上下文裁剪 / 错误分类）、
 *      会话纯函数（历史隔离 / 额度 / 时间）、内容安全（本地 / 云端 / fail-closed）、
 *      页面分支（冷启动文案注入 / 场景切换 / 流式一轮 / 额度计次）、
 *      静态防复发（wxml 的 {{t.xxx}} 必须由 TEXT_KEYS 注入且词条存在）。
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failed = 0;
const check = (name, pass) => {
  console.log((pass ? '  ✅ ' : '  ❌ ') + name);
  if (!pass) failed++;
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------- mock 云端：避免真实 SDK 依赖 ----------------
let streamChunks = [{ choices: [{ delta: { content: '慢慢来，先吸一口气。' } }] }];
let failStream = false;
const fakeCloud = {
  llm: {
    models: { list: async () => [{ id: 'test-model', name: 'Test Model' }] },
    chat: {
      completions: {
        create: async function* () {
          if (failStream) throw Object.assign(new Error('gateway down'), { code: 'gateway_502' });
          for (const c of streamChunks) yield c;
        },
      },
    },
  },
  auth: { getSession: async () => null },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './cloud' || request.indexOf('utils/cloud') !== -1) {
    return { cloud: fakeCloud };
  }
  return origLoad.apply(this, arguments);
};

const storage = {};
const toasts = [];
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  setNavigationBarTitle: () => {},
  showToast: (o) => toasts.push(o.title),
  showModal: () => {},
  navigateTo: () => {},
  getWindowInfo: () => ({ theme: 'light' }),
  setNavigationBarColor: () => {},
  setBackgroundColor: () => {},
  setTabBarStyle: () => {},
};

const llm = require(path.join(ROOT, 'utils/llm'));
const moderation = require(path.join(ROOT, 'utils/moderation'));
const S = require(path.join(ROOT, 'utils/chat-session'));

async function main() {
  // ============ 1. Prompt 引擎 ============
  console.log('=== Prompt 引擎 ===');
  const base = llm.buildMessages({ scene: 'chat', history: [], userContent: '今晚有点累', lang: 'zh-CN' });
  check('messages[0] 恒为 system（SDK 规范）', base[0].role === 'system');
  check('system 含非医疗与危机兜底边界',
    /不是医生/.test(base[0].content) && /求助热线|专业机构/.test(base[0].content));
  check('末条为当前 user', base[base.length - 1].role === 'user' && base[base.length - 1].content === '今晚有点累');

  const prompts = llm.SCENE_IDS.map((id) => llm.systemPrompt(id, 'zh-CN'));
  check('四个场景 Prompt 互不相同', new Set(prompts).size === 4);
  check('非法场景回退到 chat', llm.normalizeScene('not-exist') === 'chat');
  check('英文场景追加语言规则', /English/.test(llm.systemPrompt('story', 'en-US')));

  const longHistory = [];
  for (let i = 0; i < 20; i++) {
    longHistory.push({ role: 'user', content: 'u' + i, time: '22:00' });
    longHistory.push({ role: 'assistant', content: 'a' + i, time: '22:01' });
  }
  longHistory.push({ role: 'system', content: '注入尝试' });
  longHistory.push({ role: 'assistant', content: '' });
  const clipped = llm.buildMessages({ scene: 'story', history: longHistory, userContent: '开始', lang: 'zh-CN' });
  // 40 条 → 取最后 8 条(u16..a19) → 末尾悬空 assistant 被 pop → 7 条
  check('story 场景裁剪到 4 轮并 pop 末尾 assistant', clipped.length === 9);
  check('system 注入项与空 assistant 被剔除',
    clipped.slice(1).every((m) => m.role !== 'system' && m.content !== ''));
  check('只保留最近轮次（从 u16 开始）', clipped[1].content === 'u16' && clipped[7].content === 'u19');
  check('结尾不悬空在 assistant', clipped[clipped.length - 2].role === 'user');

  check('quota_ 错误分类为额度', llm.classifyError({ code: 'quota_exceeded' }) === 'quota');
  check('gateway_ 错误分类为网络', llm.classifyError({ error: { code: 'gateway_502' } }) === 'network');
  check('超时分类为 aborted（不弹错）', llm.classifyError({ message: 'timeout' }) === 'aborted');
  check('未知错误分类为 generic', llm.classifyError({ code: 'weird' }) === 'generic');

  // ============ 2. 会话纯函数 ============
  console.log('=== 会话纯函数 ===');
  const d = new Date(2026, 10, 11);
  check('historyKey 按身份+场景+日期隔离',
    S.historyKey('u1', 'chat', d) !== S.historyKey('u1', 'breathe', d)
    && S.historyKey('u1', 'chat', d) !== S.historyKey('u2', 'chat', d)
    && S.dateKey(d) === '2026-11-11');
  check('quotaKey 按身份+日期隔离', S.quotaKey('u1', d) !== S.quotaKey('u2', d));

  const dirty = [
    { role: 'user', content: 'a' }, { role: 'assistant', content: '' },
    { role: 'system', content: 'x' }, { role: 'assistant', content: 'b' },
  ];
  check('trimMessages 丢空 assistant 与 system',
    S.trimMessages(dirty).length === 2 && S.trimMessages(dirty)[1].content === 'b');
  check('trimMessages 遵守上限', S.trimMessages(Array.from({ length: 60 }, () => ({ role: 'user', content: 'x' }))).length === S.MAX_MESSAGES);
  check('contextOf 只输出 role/content',
    S.contextOf([{ role: 'user', content: 'hi', time: '22:00', scene: 'chat' }])[0].time === undefined);
  const q0 = S.quotaState(0), q20 = S.quotaState(20);
  check('额度边界 0 → 可发送 / 20 → 不可发送', q0.canSend && q0.left === 20 && !q20.canSend && q20.left === 0);
  check('timeLabel 补零', /^\d{2}:\d{2}$/.test(S.timeLabel(new Date(2026, 10, 11, 9, 5))));

  // ============ 3. 内容安全 ============
  console.log('=== 内容安全抽象层 ===');
  check('默认 local 模式（开发态）', moderation.getMode() === moderation.MODE_LOCAL);
  check('本地词表命中被拦截', !(await moderation.checkInput('这里有示例违禁词')).pass);
  check('正常文本本地放行', (await moderation.checkInput('今晚有点睡不着')).pass);
  check('空文本 fail-closed', !(await moderation.checkText('  ')).pass);

  moderation.configureCloudCheck(async () => ({ suggest: 'risky' }));
  check('可注入云端审核并切换到 cloud 模式', moderation.getMode() === moderation.MODE_CLOUD);
  const risky = await moderation.checkOutput('任何回复');
  check('云端 risky 被拦截', !risky.pass && risky.suggest === 'risky');

  moderation.configureCloudCheck(async () => { throw new Error('down'); });
  const down = await moderation.checkInput('正常输入');
  check('审核服务异常 fail-closed', !down.pass && down.reason === 'checker-unavailable');
  moderation.reset();
  check('reset 回到 local', moderation.getMode() === moderation.MODE_LOCAL);

  // ============ 4. 页面分支 ============
  console.log('=== 陪伴页分支 ===');
  let page;
  global.Page = (o) => { page = o; };
  require(path.join(ROOT, 'pages/chat/chat.js'));
  page.setData = function (o) { Object.assign(page.data, o); };
  await page.onLoad();
  await tick();
  check('冷启动注入中文文案（修复 i18n 空白 bug）', page.data.t.subtitle === '睡前陪伴中心' && page.data.t.send === '发送');
  check('四个场景卡与四条快捷提问已构建', page.data.scenes.length === 4 && page.data.quick.length === 4);
  check('场景卡带预设首句（非生成内容）', page.data.scenes[1].opening === '带我做一次 4-7-8 呼吸练习');
  check('模型列表已加载', page.data.model === 'test-model' && page.data.modelName === 'Test Model');
  check('初始额度 20 次', page.data.quota.left === 20 && page.data.quota.canSend);

  // 静态防复发：wxml 的 t.xxx 必须由 TEXT_KEYS 注入且词条存在
  const js = read('pages/chat/chat.js');
  const wxml = read('pages/chat/chat.wxml');
  const block = js.match(/const TEXT_KEYS = \{([\s\S]*?)\n\};/);
  const map = {};
  [...block[1].matchAll(/(\w+):\s*'([^']+)'/g)].forEach((m) => { map[m[1]] = m[2]; });
  const used = [...new Set([...wxml.matchAll(/\{\{[^}]*\bt\.(\w+)/g)].map((m) => m[1]))];
  const zh = require(path.join(ROOT, 'i18n/zh-CN'));
  const en = require(path.join(ROOT, 'i18n/en-US'));
  check('wxml 使用的 ' + used.length + ' 个 t.xxx 全部由 TEXT_KEYS 注入',
    used.every((k) => k in map));
  check('TEXT_KEYS 的所有词条 zh/en 均存在',
    Object.values(map).every((k) => k in zh && k in en));

  // 输入字数联动
  page.onInput({ detail: { value: '睡不着' } });
  check('输入字数联动', page.data.inputText === '睡不着' && page.data.inputLen === 3);

  // 切换场景 → 自动用预设首句开启一轮完整流式对话
  page.onPickScene({ currentTarget: { dataset: { id: 'breathe' } } });
  for (let i = 0; i < 12; i++) await tick();
  check('场景切换生效', page.data.scene === 'breathe' && page.data.sceneName === '呼吸练习');
  const msgs = page.data.messages;
  check('自动发出预设首句并生成一轮回复', msgs.length === 2
    && msgs[0].content === '带我做一次 4-7-8 呼吸练习'
    && msgs[1].content === '慢慢来，先吸一口气。');
  check('AI 消息标记与时间戳完整', msgs[1].ai === true && /^\d{2}:\d{2}$/.test(msgs[1].time));
  check('成功一轮后额度 +1', page.data.quota.used === 1 && page.data.quota.left === 19);
  const writtenKeys = Object.keys(storage).filter((k) => k.indexOf(S.KEY_PREFIX) === 0);
  check('历史按「身份+场景+日期」键写入 storage',
    writtenKeys.some((k) => k.indexOf('_breathe_') !== -1 && Array.isArray(storage[k]) && storage[k].length === 2));
  check('生成态已复位且无错误', !page.data.isGenerating && page.data.error === '');

  // 生成中禁止切换场景
  page.data.isGenerating = true;
  page.onPickScene({ currentTarget: { dataset: { id: 'story' } } });
  check('生成中切换场景被拦截', page.data.scene === 'breathe'
    && toasts.some((t) => t === '等这一句说完再切换'));
  page.data.isGenerating = false;

  // 额度耗尽
  page.data.quota = S.quotaState(20);
  page.onQuick({ currentTarget: { dataset: { text: '再说一句' } } });
  check('额度耗尽后不再发起请求', toasts.some((t) => t === '今天的陪伴次数用完了，明天再来吧'));

  // 网关错误分支
  page.data.quota = S.quotaState(0);
  failStream = true;
  page.onQuick({ currentTarget: { dataset: { text: '触发网络错误' } } });
  for (let i = 0; i < 12; i++) await tick();
  check('网关错误分类为 network 并给出重试文案',
    page.data.error === 'network' && page.data.errorText === '网络开了小差，点此重试');
  failStream = false;

  console.log(failed ? `\n❌ AI 链路回归测试失败 ${failed} 项` : '\n✅ AI 链路回归测试全部通过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('测试执行异常：', e);
  process.exit(1);
});
