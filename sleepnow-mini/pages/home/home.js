// 首页 · 今日仪表盘（健身 App 范式）
// 结构：日期 Hero → 睡眠环形进度 → 指标网格 → 近 7 天打卡 → 助眠卡片 → 最近记录
// 数据分流与 sleep-log / stats 一致：登录读云端，访客读本地
const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const auth = require('../../core/auth');
const player = require('../../core/audio-player');
const ALL_SOUNDS = require('../../utils/sounds-data');
const theme = require('../../core/theme');
const D = require('../../utils/dashboard');

const TEXT_KEYS = {
  greeting: 'home.greeting', overview: 'home.overview', streak: 'home.streak',
  lastNight: 'home.lastNight', goal: 'home.goal', noRecord: 'home.noRecord',
  noRecordHint: 'home.noRecordHint', achieved: 'home.achieved',
  start: 'home.start', startHint: 'home.startHint', quality: 'home.quality',
  metricAvg: 'home.metricAvg', metricDays: 'home.metricDays',
  metricStreak: 'home.metricStreak', metricQuality: 'home.metricQuality',
  unitHour: 'home.unitHour', unitDay: 'home.unitDay',
  weekCheckin: 'home.weekCheckin', viewAll: 'home.viewAll',
  recommend: 'home.recommend', recent: 'home.recent',
  recentEmpty: 'home.recentEmpty', goLog: 'home.goLog',
  checkin: 'home.checkin', checked: 'home.checked',
  add: 'log.add', footer: 'settings.footer',
};

Page({
  data: {
    t: {},
    todayLabel: '',
    // Hero 环形
    ringSegs: [], ringValue: '--', ringPercent: 0, hasLast: false,
    lastTime: '', lastQuality: 0,
    // 指标网格
    metrics: { avg: '--', days: 0, streak: 0, quality: '--' },
    // 周打卡
    week: [], streak: 0, checkedToday: false,
    recommend: [], recent: [], isGuest: false,
  },

  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
  },

  onShow() {
    const lang = i18n.getLang();
    this.setData({
      t: this.buildTexts(),
      todayLabel: D.todayLabel(new Date(), lang),
      recommend: ALL_SOUNDS.slice(0, 6).map((s, i) => ({
        id: s.id, name: s.name, desc: s.desc, src: s.src,
        title: s.name, no: D.pad(i + 1),
      })),
    });
    this.loadDashboard();
  },

  buildTexts() {
    const t = {};
    Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
    return t;
  },

  async loadDashboard() {
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    let logs = [];
    let checkins = [];

    if (id.mode === 'user') {
      const { data, error } = await cloud.database.from('sleep_logs')
        .select('id, sleep_date, bed_time, wake_time, quality, duration_min')
        .order('sleep_date', { ascending: false })
        .limit(90);
      // 首页是入口页，云端读取失败时静默降级为空，不让整个首页变成错误态
      if (!error) logs = data || [];
      const ck = await cloud.database.from('checkins')
        .select('checkin_date, streak')
        .order('checkin_date', { ascending: false })
        .limit(30);
      if (!ck.error) checkins = ck.data || [];
    } else {
      logs = auth.getGuestSleepLogs();
      checkins = auth.getGuestCheckins();
    }
    this.render(logs, checkins, id.mode === 'guest');
  },

  render(logs, checkins, isGuest) {
    const lang = i18n.getLang();
    const days = D.lastNDays(7);
    const today = days[days.length - 1];
    const s = D.summarize(logs, checkins, days);
    const last = s.lastLog;
    const percent = last ? D.goalPercent(last.duration_min) : 0;

    this.setData({
      ringSegs: D.buildRing(percent, 24),
      ringValue: last ? D.formatDuration(last.duration_min, lang) : '--',
      ringPercent: percent,
      hasLast: !!last,
      lastTime: last
        ? [last.bed_time, last.wake_time].filter(Boolean).map((v) => String(v).slice(0, 5)).join(' → ')
        : '',
      lastQuality: last ? (Number(last.quality) || 0) : 0,
      metrics: {
        avg: s.avgDuration ? (s.avgDuration / 60).toFixed(1) : '--',
        days: s.recordDays,
        streak: s.streak,
        quality: s.avgQuality,
      },
      week: D.buildWeekStrip(days, {
        checkinDates: s.checkinDates, today, lang,
      }),
      streak: s.streak,
      checkedToday: s.checkinDates.indexOf(today) !== -1,
      recent: D.recentLogs(logs, 3, lang),
      isGuest,
    });
  },

  async checkin() {
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    const today = D.dateStr(new Date());
    if (this.data.checkedToday) {
      wx.showToast({ title: this.data.t.checked, icon: 'none' });
      return;
    }
    const yest = D.offsetStr(-1);
    let streak = 1;

    if (id.mode === 'user') {
      const { data } = await cloud.database.from('checkins')
        .select('streak').eq('checkin_date', yest).limit(1);
      if (data && data.length && data[0].streak) streak = data[0].streak + 1;
      wx.showLoading({ title: i18n.t('common.loading') });
      const { error } = await cloud.database.from('checkins').insert({
        checkin_date: today,
        streak,
        owner_name: id.user && id.user.name ? id.user.name : null,
      });
      wx.hideLoading();
      if (error) {
        wx.showToast({ title: i18n.t('home.checkinFail'), icon: 'none' });
        return;
      }
    } else {
      const list = auth.getGuestCheckins();
      const last = list[list.length - 1];
      if (last && last.checkin_date === yest) streak = last.streak + 1;
      auth.addGuestCheckin({ checkin_date: today, streak });
    }
    wx.showToast({ title: this.data.t.checked, icon: 'success' });
    this.loadDashboard(); // 周条 / 连续天数 / 指标一起刷新
  },

  startPlay() {
    const first = ALL_SOUNDS[0];
    if (!first || !first.src) {
      wx.showToast({ title: i18n.t('home.recommend'), icon: 'none' });
      return;
    }
    player.play(first.src, first.name);
    wx.navigateTo({ url: '/pages/player/player' });
  },

  playSound(e) {
    const ds = e.currentTarget.dataset;
    if (!ds.src) {
      wx.showToast({ title: i18n.t('home.recommend'), icon: 'none' });
      return;
    }
    player.play(ds.src, ds.title);
    wx.navigateTo({ url: '/pages/player/player' });
  },

  goLog() { wx.switchTab({ url: '/pages/sleep-log/sleep-log' }); },
  goSounds() { wx.switchTab({ url: '/pages/sounds/sounds' }); },
  goStats() { wx.navigateTo({ url: '/pages/stats/stats' }); },
});
