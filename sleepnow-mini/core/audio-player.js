// 全局音频播放管理（后台播放 + 定时关闭）
// 注意：real src 由云存储下发，本脚手架先用占位。
let ctx = null;
let timer = null;
const state = {
  playing: false,
  title: '',
  src: '',
  duration: 0,
  current: 0,
  _onProgress: null,
};

function ensureCtx() {
  if (!ctx) {
    ctx = wx.createInnerAudioContext();
    ctx.obeyMuteSwitch = false; // 不遵守静音键，保证助眠音频可播放
    ctx.onTimeUpdate(() => {
      state.current = ctx.currentTime || 0;
      state.duration = ctx.duration || 0;
      if (state._onProgress) state._onProgress(state.current, state.duration);
    });
    ctx.onPlay(() => { state.playing = true; });
    ctx.onPause(() => { state.playing = false; });
    ctx.onEnded(() => { state.playing = false; });
    ctx.onStop(() => { state.playing = false; });
    ctx.onError(() => { state.playing = false; });
  }
  return ctx;
}

function play(src, title) {
  ensureCtx();
  state.src = src;
  state.title = title || '';
  ctx.src = src;
  ctx.play();
  state.playing = true;
}

function pause() { if (ctx) ctx.pause(); }
function resume() { if (ctx) ctx.play(); }
function stop() {
  if (ctx) {
    ctx.stop();
    ctx.destroy();
    ctx = null;
  }
  clearTimer();
  state.playing = false;
  state.src = '';
  state.title = '';
}

function setTimer(minutes) {
  clearTimer();
  if (!minutes) return;
  timer = setTimeout(() => { stop(); }, minutes * 60 * 1000);
}
function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function onProgress(cb) { state._onProgress = cb; }
function getState() { return state; }

module.exports = { play, pause, resume, stop, setTimer, clearTimer, onProgress, getState };
