const player = require('../../core/audio-player');
const i18n = require('../../core/i18n');

Page({
  data: {
    title: '',
    playing: false,
    timers: [15, 30, 60],
    activeMin: 0,
    stopText: '',
    timerTitle: '',
  },
  onShow() {
    player.onProgress((cur, dur) => {
      this.setData({ current: cur, duration: dur });
    });
    const s = player.getState();
    this.setData({
      title: s.title || i18n.t('player.title'),
      playing: s.playing,
      stopText: i18n.t('player.stop'),
      timerTitle: i18n.t('player.timer'),
    });
  },
  toggle() {
    const s = player.getState();
    if (s.playing) player.pause();
    else player.resume();
    this.setData({ playing: !s.playing });
  },
  setTimer(e) {
    const min = e.currentTarget.dataset.min;
    player.setTimer(min);
    this.setData({ activeMin: min });
    wx.showToast({
      title: min ? '将在 ' + min + ' 分钟后停止' : '已关闭定时',
      icon: 'none',
    });
  },
  stop() {
    player.stop();
    this.setData({ playing: false });
  },
});
