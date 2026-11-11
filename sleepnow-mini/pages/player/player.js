const player = require('../../core/audio-player');
const i18n = require('../../core/i18n');
const theme = require('../../core/theme');

const TEXT_KEYS = {
  play: 'player.play', pause: 'player.pause', stop: 'player.stop',
  timerTitle: 'player.timer', unitMin: 'player.unitMin', off: 'player.off',
};

Page({
  data: {
    t: {},
    title: '',
    playing: false,
    timers: [15, 30, 60],
    activeMin: 0,
  },
  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
  },
  onShow() {
    player.onProgress((cur, dur) => {
      this.setData({ current: cur, duration: dur });
    });
    const s = player.getState();
    this.setData({
      t: this.buildTexts(),
      title: s.title || i18n.t('player.title'),
      playing: s.playing,
      activeMin: s.timerMin || 0,
    });
  },

  buildTexts() {
    const t = {};
    Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
    return t;
  },

  toggle() {
    const s = player.getState();
    if (s.playing) player.pause();
    else player.resume();
    this.setData({ playing: !s.playing });
  },
  setTimer(e) {
    const min = Number(e.currentTarget.dataset.min) || 0;
    player.setTimer(min);
    this.setData({ activeMin: min });
    wx.showToast({
      title: min
        ? i18n.t('player.timerOn').replace('{min}', String(min))
        : i18n.t('player.timerOff'),
      icon: 'none',
    });
  },
  stop() {
    player.stop();
    this.setData({ playing: false, activeMin: 0 });
  },
});
