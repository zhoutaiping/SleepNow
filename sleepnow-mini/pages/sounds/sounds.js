const player = require('../../core/audio-player');
const i18n = require('../../core/i18n');
const ALL_SOUNDS = require('../../utils/sounds-data');
const theme = require('../../core/theme');

Page({
  data: {
    title: '',
    sounds: [],
  },
  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
  },
  onShow() {
    this.setData({
      title: i18n.t('tab.sounds'),
      sounds: ALL_SOUNDS,
    });
  },
  play(e) {
    const ds = e.currentTarget.dataset;
    if (!ds.src) {
      wx.showToast({ title: '示例音频待接入', icon: 'none' });
      return;
    }
    player.play(ds.src, ds.name);
    wx.navigateTo({ url: '/pages/player/player' });
  },
});
