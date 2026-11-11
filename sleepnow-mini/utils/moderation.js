// 晚安开关 · 内容安全抽象层（双向审核）
// ---------------------------------------------------------------------------
// ⚠️ 重要：微信官方 msgSecCheck 文档明确「接口应在服务器端调用，不可在前端
//   （小程序、网页、APP 等）直接调用」。原因是需要 access_token / AppSecret，
//   前端持有即泄露。因此本文件只定义接口，不内置任何密钥。
//
// 当前状态：默认 'local'（本地粗筛，仅开发态可用，不能作为提审依据）。
// 生产接入：在 app.js 或页面启动处调用 configureCloudCheck(fn)，注入一个
//   走云函数 / 自建 BFF 的异步检测函数（完整云函数代码见《AI 接入实操方案》）。
//
// msgSecCheck v2 要点（官方）：
//   POST https://api.weixin.qq.com/wxa/msg_sec_check?access_token=...
//   body: { version: 2, scene: 2|4, openid, content }  content ≤ 2500 字 UTF-8
//   openid 必填且用户需近两小时访问过小程序；返回 result.suggest = pass|review|risky
//   频率：4000 次/分、200 万次/天；**未上架小程序仅 100 次/天**（开发期注意）
//   云调用需在云函数 config.json 声明 "openapi": ["security.msgSecCheck"]
// ---------------------------------------------------------------------------

const MODE_LOCAL = 'local';
const MODE_CLOUD = 'cloud';

// 本地粗筛词表：只兜明显风险，绝不作为唯一防线
const LOCAL_BLOCK_WORDS = [
  '示例违禁词',
];

let mode = MODE_LOCAL;
let cloudChecker = null; // async (text, ctx) => { suggest: 'pass'|'review'|'risky', reason? }

/**
 * 注入云端检测实现。示例（云函数版）：
 * configureCloudCheck(async (text, ctx) => {
 *   const r = await wx.cloud.callFunction({
 *     name: 'moderateText',
 *     data: { content: text, direction: ctx.direction },
 *   });
 *   return { suggest: r.result.suggest };
 * });
 */
function configureCloudCheck(fn) {
  if (typeof fn !== 'function') return false;
  cloudChecker = fn;
  mode = MODE_CLOUD;
  return true;
}

function reset() {
  cloudChecker = null;
  mode = MODE_LOCAL;
}

function getMode() {
  return mode;
}

function localCheck(text) {
  const s = String(text || '').toLowerCase();
  for (const w of LOCAL_BLOCK_WORDS) {
    if (w && s.indexOf(w.toLowerCase()) !== -1) {
      return { pass: false, suggest: 'risky', reason: 'local-word' };
    }
  }
  return { pass: true, suggest: 'pass', reason: '' };
}

/**
 * 统一检测入口
 * @param {string} text        待检文本
 * @param {object} ctx         { direction: 'input'|'output', openid, scene }
 * @returns {Promise<{pass:boolean, suggest:string, reason:string, mode:string}>}
 * 策略：pass 放行；risky 拦截；review 与接口异常一律「不放行」（fail-closed）
 */
async function checkText(text, ctx) {
  const value = String(text || '').trim();
  if (!value) return { pass: false, suggest: 'review', reason: 'empty', mode };

  const local = localCheck(value);
  if (!local.pass) return Object.assign({}, local, { mode: MODE_LOCAL });

  if (mode === MODE_CLOUD && cloudChecker) {
    try {
      const r = await cloudChecker(value.slice(0, 2500), ctx || {});
      const suggest = (r && r.suggest) || 'review';
      return {
        pass: suggest === 'pass',
        suggest,
        reason: (r && r.reason) || '',
        mode: MODE_CLOUD,
      };
    } catch (e) {
      // 审核服务不可用 → 拒绝放行，避免绕过审核
      return { pass: false, suggest: 'review', reason: 'checker-unavailable', mode: MODE_CLOUD };
    }
  }
  return Object.assign({}, local, { mode: MODE_LOCAL });
}

function checkInput(text, ctx) {
  return checkText(text, Object.assign({}, ctx || {}, { direction: 'input' }));
}

function checkOutput(text, ctx) {
  return checkText(text, Object.assign({}, ctx || {}, { direction: 'output' }));
}

module.exports = {
  MODE_LOCAL, MODE_CLOUD,
  configureCloudCheck, reset, getMode,
  checkText, checkInput, checkOutput, localCheck,
};
