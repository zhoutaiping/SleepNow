const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const auth = require('../../core/auth');
const player = require('../../core/audio-player');
const ALL_SOUNDS = require('../../utils/sounds-data');
const theme = require('../../core/theme');

function fmt(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayStr() { return fmt(new Date()); }
function offsetStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmt(d);
}

Page({
  data: {
    greeting: '', streakText: '', streak: 0, checkedToday: false,
    checkinText: '', checkedText: '',
    todayLogTitle: '', logAddBtn: '', recommendTitle: '',
    recommend: [],
  },
  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
  },
  onShow() {
    this.setData({
      greeting: i18n.t('home.greeting'),
      streakText: i18n.t('home.streak'),
      checkinText: i18n.t('home.checkin'),
      checkedText: i18n.t('home.checked'),
      todayLogTitle: i18n.t('home.todayLog'),
      logAddBtn: i18n.t('log.add'),
      recommendTitle: i18n.t('home.recommend'),
      // 首页推荐取前 4 条；补 title 字段供播放页展示
      recommend: ALL_SOUNDS.slice(0, 4).map((s) => ({
        id: s.id, name: s.name, src: s.src, title: s.name,
      })),
    });
    this.loadStreak();
  },
  async loadStreak() {
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    if (id.mode === 'user') {
      const { data, error } = await cloud.database.from('checkins')
        .select('checkin_date, streak')
        .order('checkin_date', { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) {
        this.setData({ streak: 0, checkedToday: false });
        return;
      }
      const last = data[0];
      this.setData({
        streak: last.streak || 0,
        checkedToday: last.checkin_date === todayStr(),
      });
    } else {
      const list = auth.getGuestCheckins();
      const last = list[list.length - 1];
      this.setData({
        streak: last ? last.streak : 0,
        checkedToday: last ? last.checkin_date === todayStr() : false,
      });
    }
  },
  async checkin() {
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    const today = todayStr();
    if (id.mode === 'user') {
      if (this.data.checkedToday) {
        wx.showToast({ title: i18n.t('home.checked'), icon: 'none' });
        return;
      }
      const yest = offsetStr(-1);
      const { data } = await cloud.database.from('checkins')
        .select('streak').eq('checkin_date', yest).limit(1);
      let streak = 1;
      if (data && data.length && data[0].streak) streak = data[0].streak + 1;
      wx.showLoading({ title: '签到中' });
      const { error } = await cloud.database.from('checkins').insert({
        checkin_date: today,
        streak: streak,
        owner_name: id.user && id.user.name ? id.user.name : null,
      });
      wx.hideLoading();
      if (error) {
        wx.showToast({ title: '签到失败', icon: 'none' });
        return;
      }
      this.setData({ streak, checkedToday: true });
      wx.showToast({ title: '签到成功', icon: 'success' });
    } else {
      if (this.data.checkedToday) {
        wx.showToast({ title: i18n.t('home.checked'), icon: 'none' });
        return;
      }
      const list = auth.getGuestCheckins();
      const last = list[list.length - 1];
      let streak = 1;
      if (last && last.checkin_date === offsetStr(-1)) streak = last.streak + 1;
      auth.addGuestCheckin({ checkin_date: today, streak });
      this.setData({ streak, checkedToday: true });
      wx.showToast({ title: '签到成功', icon: 'success' });
    }
  },
  goLog() {
    wx.switchTab({ url: '/pages/sleep-log/sleep-log' });
  },
  playSound(e) {
    const ds = e.currentTarget.dataset;
    if (!ds.src) {
      wx.showToast({ title: '示例音频待接入', icon: 'none' });
      return;
    }
    player.play(ds.src, ds.title);
    wx.navigateTo({ url: '/pages/player/player' });
  },
});
