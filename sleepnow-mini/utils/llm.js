// 晚安开关 · 场景化 LLM 接入层
// ---------------------------------------------------------------------------
// 规范强制（WorkBuddy 云服务 LLM 文档）：
//   1. 每条 chat.completions.create 的 messages[0] 必须是 system 消息
//   2. 必须 stream: true（非流式会被 SDK 拒绝）
//   3. keyless：前端只持 publishableKey，绝不出现模型 API Key
// ---------------------------------------------------------------------------
// v2 变更：单一 SYSTEM_PROMPT → 四个睡前场景 Prompt；上下文按场景裁剪；
//         中止不依赖 AbortController（小程序端兼容性未知，双保险）。
const { cloud } = require('./cloud');

// 所有场景共用的安全边界与语气基线
const BASE_RULES = [
  '你是「晚安开关」的睡前陪伴助手，正在陪一位准备入睡的用户。',
  '语气温柔、平静、克制，用短句，多用换行让文字呼吸。每次回复控制在 120 字内，除非用户明确要求更长。',
  '不要用列表、标题、加粗、emoji，也不要堆感叹号；像在床边轻声说话。',
  '你不是医生：不提供诊断、用药、治疗或心理治疗建议，不替代专业帮助。',
  '若用户流露强烈的绝望、自伤或危机倾向：先温和接住情绪，再建议联系信任的人、当地求助热线或专业机构，不追问细节。',
  '不讨论政治、暴力、色情与违法内容；遇到这类话题温和地转回睡前话题。',
  '始终使用与用户相同的语言回复。',
];

// 四个睡前场景：各有角色指令、上下文轮数上限、首条引导语 key
const SCENES = {
  chat: {
    id: 'chat',
    maxTurns: 8,
    prompt: '安静地倾听用户今天的事。先用一句话复述你听到的感受，再给一句轻轻的安放。不要说教，不要给建议清单，不要追问隐私。',
  },
  breathe: {
    id: 'breathe',
    maxTurns: 6,
    prompt: '带领 4-7-8 呼吸练习。每轮只给一次节奏提示（吸气 4 秒 / 屏息 7 秒 / 呼气 8 秒），句子极短，中间留白。用户说「继续」或回应后，才进入下一轮。',
  },
  body: {
    id: 'body',
    maxTurns: 6,
    prompt: '带领渐进式身体扫描放松。从脚趾开始，每次只聚焦一个部位，用两三句话描述松开的感觉，等用户回应再往下走。',
  },
  story: {
    id: 'story',
    maxTurns: 4,
    prompt: '讲一个舒缓的睡前小故事或宁静的画面，约 100 字，收束在一个安静的画面上。不要有冲突、惊吓、悬念或反转。',
  },
};
const SCENE_IDS = Object.keys(SCENES);
const DEFAULT_SCENE = 'chat';

function normalizeScene(id) {
  return SCENES[id] ? id : DEFAULT_SCENE;
}

function systemPrompt(sceneId, lang) {
  const scene = SCENES[normalizeScene(sceneId)];
  const langRule = lang === 'en-US'
    ? 'Reply in the user\'s language; if the user writes English, reply in English.'
    : '如果用户使用中文，请用中文回复。';
  return BASE_RULES.concat([scene.prompt, langRule]).join('\n');
}

// 构造模型上下文：system 首位 + 裁剪后的历史 + 当前 user
// 剔除：system 角色、空内容（生成中断留下的空 assistant）、超过 maxTurns 的旧轮次
function buildMessages({ scene = DEFAULT_SCENE, history = [], userContent = '', lang = 'zh-CN' }) {
  const sceneId = normalizeScene(scene);
  const maxItems = SCENES[sceneId].maxTurns * 2;
  const cleaned = (history || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  const trimmed = cleaned.length > maxItems ? cleaned.slice(cleaned.length - maxItems) : cleaned;
  // 结尾不能停在 assistant，否则部分模型会拒绝续写
  if (trimmed.length && trimmed[trimmed.length - 1].role === 'assistant') trimmed.pop();
  return [
    { role: 'system', content: systemPrompt(sceneId, lang) },
    ...trimmed,
    { role: 'user', content: userContent },
  ];
}

// 拉取可用模型（过滤 disabled），失败返回 []，由页面走降级文案
async function listModels() {
  try {
    const models = await cloud.llm.models.list();
    if (!models || !models.length) return [];
    return models.filter((m) => m && m.id && m.disabled !== true)
      .map((m) => ({ id: m.id, name: m.name || m.id }));
  } catch (e) {
    return [];
  }
}

/**
 * 流式对话。
 * @param {object}  opts
 * @param {string}  opts.model        模型 id
 * @param {string}  opts.scene        场景 id（chat/breathe/body/story）
 * @param {Array}   opts.history      页面历史（不含 system）
 * @param {string}  opts.userContent  本轮用户输入
 * @param {string}  opts.lang         当前语言
 * @param {AbortSignal} opts.signal   可选，AbortController.signal
 * @param {Function} opts.shouldStop  可选，每片前调用；返回 true 立即停止（不依赖 AbortController）
 * @param {Function} opts.onDelta     文本片段回调
 * @param {Function} opts.onReasoning 思考片段回调（可选）
 * @param {Function} opts.onDone      正常结束回调
 * @param {Function} opts.onError     错误回调
 */
async function streamChat(opts) {
  const {
    model, scene, history, userContent, lang, signal,
    shouldStop, onDelta, onReasoning, onDone, onError,
  } = opts || {};
  const messages = buildMessages({ scene, history, userContent, lang });
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model,
      messages,
      stream: true,
      signal,
    })) {
      if (shouldStop && shouldStop()) break;
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (!delta) continue;
      if (delta.content) onDelta && onDelta(delta.content);
      if (delta.reasoning_content && onReasoning) onReasoning(delta.reasoning_content);
    }
    onDone && onDone();
  } catch (err) {
    // 主动中止不视为错误
    if (shouldStop && shouldStop()) { onDone && onDone(); return; }
    onError && onError(err);
  }
}

// 错误分类：供页面给出可读文案（quota / network / generic）
function classifyError(err) {
  const code = (err && (err.code || (err.error && err.error.code))) || '';
  if (String(code).startsWith('quota_')) return 'quota';
  if (/abort|aborted|timeout|timedout/i.test(String(err && (err.message || code)))) return 'aborted';
  if (String(code).startsWith('auth_') || String(code).startsWith('gateway_')
    || String(code).startsWith('model_') || String(code).startsWith('internal_')) return 'network';
  return 'generic';
}

module.exports = {
  SCENES, SCENE_IDS, DEFAULT_SCENE, BASE_RULES,
  normalizeScene, systemPrompt, buildMessages,
  listModels, streamChat, classifyError,
};
