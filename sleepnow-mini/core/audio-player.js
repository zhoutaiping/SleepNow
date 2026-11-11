// 全局音频播放管理：后台播放 + 定时关闭
// ---------------------------------------------------------------------------
// 助眠场景必须「锁屏 / 切后台继续播放」，因此只能用 wx.getBackgroundAudioManager()
// （微信全局单例，配合 app.json 的 requiredBackgroundModes: ["audio"]）。
// wx.createInnerAudioContext() 切后台即停，已在本工程弃用 —— 见 BUG B01。
// 锁屏控制条需要 title / singer / coverImgUrl，元数据在 play() 里统一写入。
// 定时关闭不能只靠 setTimeout：切后台后 JS 定时器会被挂起，故用
// timerEndAt 绝对时间戳 + onTimeUpdate 检查（后台音频事件仍会触发），
// setTimeout 仅作为前台兜底。
// ---------------------------------------------------------------------------
const i18n = require('./i18n');

const COVER = '/assets/cover.png';
const MAX_TIMER_MINUTES = 180;

let mgr = null;          // BackgroundAudioManager 是全局单例，不可重复创建
let timer = null;
let bound = false;       // 事件只绑一次，避免 stop 后重复注册

const state = {
  playing: false,
  title: '',
  src: '',
  duration: 0,
  current: 0,
  timerEndAt: 0,        // 定时关闭的绝对时间戳（毫秒）
  timerMin: 0,
  error: '',
  _onProgress: null,
};

function ensureMgr() {
  if (mgr) return mgr;
  if (typeof wx === 'undefined' || typeof wx.getBackgroundAudioManager !== 'function') {
    state.error = 'BackgroundAudioManager unavailable';
    return null;
  }
  mgr = wx.getBackgroundAudioManager();
  if (!bound) {
    bound = true;
    mgr.onTimeUpdate(() => {
      state.current = mgr.currentTime || 0;
      state.duration = mgr.duration || 0;
      // 后台/锁屏时 setTimeout 不可靠，靠音频进度事件兜底定时关闭
      if (state.timerEndAt && Date.now() >= state.timerEndAt) {
        stop();
        return;
      }
      if (state._onProgress) state._onProgress(state.current, state.duration);
    });
    mgr.onPlay(() => { state.playing = true; state.error = ''; });
    mgr.onPause(() => { state.playing = false; });
    mgr.onEnded(() => { state.playing = false; });
    mgr.onStop(() => { state.playing = false; });
    mgr.onError((e) => {
      state.playing = false;
      state.error = (e && e.errMsg) || 'audio error';
    });
  }
  return mgr;
}

function play(src, title) {
  if (!src) { state.error = 'empty src'; return false; }
  const m = ensureMgr();
  if (!m) return false;

  const name = title || i18n.t('app.name');
  state.src = src;
  state.title = name;
  state.error = '';
  // iOS / Android 锁屏控制条依赖这些元数据，缺 title / coverImgUrl 时部分机型不展示
  m.title = name;
  m.singer = i18n.t('player.title');
  m.coverImgUrl = COVER;
  m.epname = i18n.t('app.name');

  try {
    if (m.src === src) {
      // 同一音频再次点播：从头开始（设置 src 新值才会自动播放）
      if (typeof m.seek === 'function') m.seek(0);
      m.play();
    } else {
      m.src = src; // 官方行为：赋值 src 即开始播放
    }
  } catch (e) {
    state.error = (e && e.message) || 'play failed';
    state.playing = false;
    return false;
  }
  state.playing = true;
  return true;
}

function pause() {
  if (!mgr) return;
  try { mgr.pause(); } catch (e) {}
  state.playing = false;
}

function resume() {
  const m = ensureMgr();
  if (!m) return;
  try {
    if (state.src && m.src !== state.src) {
      m.src = state.src;
    } else {
      m.play();
    }
    state.playing = true;
  } catch (e) {
    state.error = (e && e.message) || 'resume failed';
    state.playing = false;
  }
}

function stop() {
  if (mgr) { try { mgr.stop(); } catch (e) {} }
  clearTimer();
  state.playing = false;
  state.src = '';
  state.title = '';
  state.current = 0;
  state.duration = 0;
}

function setTimer(minutes) {
  clearTimer();
  const min = Math.min(MAX_TIMER_MINUTES, Math.max(0, Number(minutes) || 0));
  if (!min) return;
  state.timerMin = min;
  state.timerEndAt = Date.now() + min * 60 * 1000;
  timer = setTimeout(() => { stop(); }, min * 60 * 1000);
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
  state.timerEndAt = 0;
  state.timerMin = 0;
}

function onProgress(cb) { state._onProgress = cb; }
function getState() { return state; }

module.exports = { play, pause, resume, stop, setTimer, clearTimer, onProgress, getState, COVER };
