/**
 * 晚安开关 · 语音输入抽象层
 * ---------------------------------------------------------------------------
 * 背景：微信「同声传译」插件（WechatSI，wx069ba97219f66d99）的服务类目是
 *       「IT 科技 > 软件服务提供商」，微信开放社区明确该插件 **不对个人主体开放**。
 *       因此本模块做成可插拔的三档 provider，按可用性自动降级：
 *
 *   1. plugin   企业主体：app.json 声明 WechatSI 并在后台添加插件后自动启用，
 *               走「录音 + 实时识别」，无需后端、免费。
 *   2. cloud    任意主体：configureRecognizer(fn) 或 enableCloudASR() 注入识别器，
 *               走「wx.getRecorderManager 录音 → 临时文件 → 云函数 ASR」。
 *   3. keyboard 个人主体默认（零配置）：调起单行输入框焦点，用系统键盘 / 微信键盘
 *               自带的麦克风语音输入，不需要录音权限、不需要后端、不需要插件。
 *
 * 设计约定：
 *   - 语音只负责「把声音变成输入框里的文字」，**绝不自动发送**；
 *     发送前仍由 moderation.checkInput 做输入侧审核，合规链路不变。
 *   - 识别结果追加到录音前已有的文字后面（mergeText），用户可编辑后再发送。
 *   - 录音文件不落库、不进聊天记录；cloud 模式只在识别期间临时上传。
 *   - 所有错误都以 reason 回调，由页面决定文案，本层不写 UI、不依赖 i18n。
 */
const PLUGIN_NAME = 'WechatSI';
const MAX_DURATION_MS = 30000;

let handlers = {};
let recognizer = null;
let siManager = null;
let recorder = null;
let state = 'idle'; // idle | recording | recognizing
let cancelled = false;
let currentLang = 'zh_CN';
let startedAt = 0;

function wxApi(name) {
  return (typeof wx !== 'undefined' && wx && typeof wx[name] === 'function') ? wx[name] : null;
}

function emit(name, arg1, arg2) {
  if (typeof handlers[name] === 'function') handlers[name](arg1, arg2);
}

function emitState(next, mode) {
  state = next;
  emit('onStateChange', next, mode || getMode());
}

/** 拼接识别文本：中文直连，英文单词间补空格，避免 "Iam" */
function mergeText(base, text) {
  const b = String(base || '');
  const x = String(text || '').trim();
  if (!x) return b;
  if (!b) return x;
  const glue = /[A-Za-z0-9]$/.test(b) && /^[A-Za-z0-9]/.test(x) ? ' ' : '';
  return b + glue + x;
}

function normalizeLang(lang) {
  return /^en/i.test(String(lang || '')) ? 'en_US' : 'zh_CN';
}

/** 插件模式：懒加载 requirePlugin，未声明 / 未授权 / 无权限时安静返回 null */
function getSiManager() {
  if (siManager) return siManager;
  if (typeof requirePlugin !== 'function') return null;
  let plugin;
  try { plugin = requirePlugin(PLUGIN_NAME); } catch (e) { return null; }
  if (!plugin || typeof plugin.getRecordRecognitionManager !== 'function') return null;
  const m = plugin.getRecordRecognitionManager();
  m.onStart = function () { /* 状态由 start() 统一置位，避免重复通知 */ };
  m.onRecognize = function (res) { emitPartial(res && res.result); };
  m.onStop = function (res) { finish(res && res.result, null); };
  m.onError = function (res) { finish('', (res && res.msg) || 'plugin-error'); };
  siManager = m;
  return m;
}

/** 云 ASR 模式：懒创建 RecorderManager */
function getRecorder() {
  if (recorder) return recorder;
  const create = wxApi('getRecorderManager');
  if (!create) return null;
  const r = create();
  r.onStop = function (res) { onRecordStop(res); };
  r.onError = function () { finish('', 'record-failed'); };
  recorder = r;
  return r;
}

/** 当前可用的语音输入模式（页面据此决定是否显示键盘提示） */
function getMode() {
  if (getSiManager()) return 'plugin';
  if (typeof recognizer === 'function') return 'cloud';
  return 'keyboard';
}

/** 页面注册回调：onStateChange / onPartial / onResult / onError */
function configure(opts) {
  handlers = opts || {};
  return getMode();
}

/** 注入自定义识别器：(tempFilePath, meta) => Promise<string> */
function configureRecognizer(fn) {
  recognizer = typeof fn === 'function' ? fn : null;
  return getMode();
}

/**
 * 一行启用「微信云开发 + 云函数 ASR」：
 *   speech.enableCloudASR({ name: 'speechToText' })
 * 前提：app.js 里已 wx.cloud.init(...)，且部署了同名云函数（见 AI 接入实操方案第 10 节）。
 * 前端只传 fileID，不接触任何 SecretId / SecretKey。
 */
function enableCloudASR(opts) {
  const o = opts || {};
  const name = o.name || 'speechToText';
  const prefix = o.cloudPathPrefix || 'asr';
  return configureRecognizer(async function (filePath, meta) {
    const cloud = (typeof wx !== 'undefined' && wx) ? wx.cloud : null;
    if (!cloud || typeof cloud.uploadFile !== 'function' || typeof cloud.callFunction !== 'function') {
      throw new Error('wx.cloud not initialized');
    }
    const up = await cloud.uploadFile({
      cloudPath: prefix + '/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mp3',
      filePath: filePath,
    });
    const r = await cloud.callFunction({
      name: name,
      data: {
        fileID: up && up.fileID,
        lang: (meta && meta.lang) || currentLang,
        duration: (meta && meta.duration) || 0,
      },
    });
    const text = r && r.result && r.result.text;
    if (!text) throw new Error('empty recognition result');
    return text;
  });
}

/** 录音权限：已授权直接过；首次弹系统授权框；曾被拒绝则交给页面引导 openSetting */
function ensureRecordAuth() {
  return new Promise(function (resolve) {
    const getSetting = wxApi('getSetting');
    if (!getSetting) return resolve({ ok: true });
    getSetting({
      success: function (res) {
        const setting = (res && res.authSetting) || {};
        if (setting['scope.record'] === true) return resolve({ ok: true });
        if (setting['scope.record'] === false) return resolve({ ok: false, needSetting: true });
        const authorize = wxApi('authorize');
        if (!authorize) return resolve({ ok: true });
        authorize({
          scope: 'scope.record',
          success: function () { resolve({ ok: true }); },
          fail: function () { resolve({ ok: false, needSetting: false }); },
        });
      },
      fail: function () { resolve({ ok: true }); },
    });
  });
}

/** 开始录音（keyboard 模式返回 { ok:false, mode:'keyboard' }，由页面聚焦输入框） */
async function start(opts) {
  const o = opts || {};
  const mode = getMode();
  if (mode === 'keyboard') return { ok: false, mode: mode };
  if (state !== 'idle') return { ok: false, mode: mode, reason: 'busy' };

  const auth = await ensureRecordAuth();
  if (!auth.ok) return { ok: false, mode: mode, reason: 'auth-denied', needSetting: auth.needSetting };

  currentLang = normalizeLang(o.lang);
  cancelled = false;
  startedAt = Date.now();
  try {
    if (mode === 'plugin') {
      getSiManager().start({ duration: MAX_DURATION_MS, lang: currentLang });
    } else {
      const r = getRecorder();
      if (!r) throw new Error('recorder unavailable');
      r.start({
        duration: MAX_DURATION_MS,
        format: 'mp3',
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
      });
    }
  } catch (e) {
    state = 'idle';
    return { ok: false, mode: mode, reason: 'start-failed' };
  }
  emitState('recording', mode);
  return { ok: true, mode: mode };
}

/** 结束录音并等待识别结果 */
function stop() {
  if (state !== 'recording') return false;
  try {
    if (getMode() === 'plugin') getSiManager().stop();
    else if (recorder) recorder.stop();
    else throw new Error('recorder unavailable');
  } catch (e) {
    finish('', 'stop-failed');
  }
  return true;
}

/** 取消：丢弃本次录音，迟到的 onStop / onRecognize 一律忽略 */
function cancel() {
  if (state === 'idle' && !cancelled) return;
  cancelled = true;
  try {
    if (getMode() === 'plugin' && siManager) siManager.stop();
    else if (recorder) recorder.stop();
  } catch (e) { /* 已取消，忽略底层异常 */ }
  emitState('idle', null);
}

async function onRecordStop(res) {
  if (cancelled) return;
  const file = res && res.tempFilePath;
  if (!file || typeof recognizer !== 'function') {
    finish('', 'recognize-failed');
    return;
  }
  emitState('recognizing', 'cloud');
  try {
    const text = await recognizer(file, {
      duration: (res && res.duration) || (Date.now() - startedAt),
      lang: currentLang,
    });
    finish(text, null);
  } catch (e) {
    finish('', 'recognize-failed');
  }
}

function emitPartial(text) {
  if (cancelled || state === 'idle') return;
  const clean = String(text || '').trim();
  if (clean) emit('onPartial', clean);
}

function finish(text, errReason) {
  if (cancelled) return;
  const clean = String(text || '').trim();
  emitState('idle', null);
  if (errReason) return emit('onError', errReason);
  if (!clean) return emit('onError', 'empty');
  emit('onResult', clean);
}

module.exports = {
  PLUGIN_NAME: PLUGIN_NAME,
  MAX_DURATION_MS: MAX_DURATION_MS,
  configure: configure,
  configureRecognizer: configureRecognizer,
  enableCloudASR: enableCloudASR,
  getMode: getMode,
  getState: function () { return state; },
  isRecording: function () { return state === 'recording'; },
  mergeText: mergeText,
  start: start,
  stop: stop,
  cancel: cancel,
};
