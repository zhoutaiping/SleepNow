// 我的页 · 大身份卡 + 成就数据 + 分组列表
// 修复旧布局：头像/副文案/登录按钮在同一行互相挤压导致换行
const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const theme = require('../../core/theme');
const auth = require('../../core/auth');
const D = require('../../utils/dashboard');

const TEXT_KEYS = {
  title: 'settings.title', login: 'settings.login', logout: 'settings.logout',
  guest: 'settings.guest', guestDesc: 'settings.guestDesc', signedIn: 'settings.signedIn',
  wechatUser: 'settings.wechatUser', achievement: 'settings.achievement',
  totalLogs: 'settings.totalLogs', totalHours: 'settings.totalHours', streak: 'settings.streak',
  appearance: 'settings.appearance', more: 'settings.more',
  statsEntry: 'settings.statsEntry', statsDesc: 'settings.statsDesc',
  soundsEntry: 'settings.soundsEntry', soundsDesc: 'settings.soundsDesc',
  aboutEntry: 'settings.aboutEntry', footer: 'settings.footer',
  language: 'settings.language', themeLabel: 'settings.theme',
  themeAuto: 'theme.auto', themeLight: 'theme.light', themeDark: 'theme.dark',
  themeCurrent: 'theme.current', themeDesc: 'theme.desc',
  unitLog: 'settings.unitLog', unitHour: 'home.unitHour', unitDay: 'settings.unitDay',
};

// auto 模式下展示「实际生效的 mode · 跟随系统」，让切换控件明确传达自身状态
function themeStateLabel() {
  const mode = theme.getTheme();
  const effective = mode === 'auto' ? (theme.isDarkNow() ? 'dark' : 'light') : mode;
  const label = i18n.t('theme.' + effective);
  return mode === 'auto' ? label + ' · ' + i18n.t('theme.auto') : label;
}

Page({
  data: {
    t: {},
    lang: 'zh-CN',
    theme: 'auto',
    themeState: '',
    user: null,
    loading: true,
    isGuest: false,
    initial: '游',
    displayName: '',
    statusDesc: '',
    achievement: { logs: 0, streak: 0, hours: 0 },
  },

  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
  },

  async onShow() {
    this.buildTexts();
    this.setData({ loading: true });
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    const u = id.user;
    const name = u ? (u.name || u.phone || i18n.t('settings.wechatUser')) : i18n.t('settings.guest');
    this.setData({
      user: u,
      isGuest: id.mode === 'guest',
      loading: false,
      initial: String(name).slice(0, 1).toUpperCase(),
      displayName: name,
      statusDesc: u ? i18n.t('settings.signedIn') : i18n.t('settings.guestDesc'),
    });
    this.loadOverview(id);
  },

  buildTexts() {
    const t = {};
    Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
    this.setData({
      t,
      lang: i18n.getLang(),
      theme: theme.getTheme(),
      themeState: themeStateLabel(),
    });
  },

  async loadOverview(id) {
    let logs = [];
    let checkins = [];
    if (id.mode === 'user') {
      const { data, error } = await cloud.database.from('sleep_logs')
        .select('sleep_date, quality, duration_min')
        .order('sleep_date', { ascending: false })
        .limit(90);
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
    const s = D.summarize(logs, checkins, D.lastNDays(30));
    this.setData({
      achievement: { logs: s.totalLogs, streak: s.streak, hours: s.totalHours },
    });
  },

  switchLang(e) {
    i18n.setLang(e.currentTarget.dataset.lang);
    this.buildTexts();
    // 语言切换后身份卡里的默认名/状态文案也要跟着变
    const id = auth.getIdentity();
    const name = id.user
      ? (id.user.name || id.user.phone || i18n.t('settings.wechatUser'))
      : i18n.t('settings.guest');
    this.setData({
      initial: String(name).slice(0, 1).toUpperCase(),
      displayName: name,
      statusDesc: id.user ? i18n.t('settings.signedIn') : i18n.t('settings.guestDesc'),
    });
    wx.showToast({ title: i18n.t('common.switched'), icon: 'none' });
  },

  switchTheme(e) {
    theme.setTheme(e.currentTarget.dataset.theme);
    this.buildTexts();
    wx.showToast({ title: i18n.t('theme.switched'), icon: 'none' });
  },

  onLogin() { wx.navigateTo({ url: '/pages/login/login' }); },

  onLogout() {
    wx.showModal({
      title: i18n.t('settings.logout'),
      success: async (res) => {
        if (res.confirm) {
          await auth.logout();
          this.setData({
            user: null, isGuest: true,
            initial: i18n.t('settings.guest').slice(0, 1),
            displayName: i18n.t('settings.guest'),
            statusDesc: i18n.t('settings.guestDesc'),
            achievement: { logs: 0, streak: 0, hours: 0 },
          });
        }
      },
    });
  },

  goStats() { wx.navigateTo({ url: '/pages/stats/stats' }); },
  goSounds() { wx.switchTab({ url: '/pages/sounds/sounds' }); },
  goAbout() {
    wx.showModal({
      title: i18n.t('settings.aboutEntry'),
      content: 'v1.0.0 · WorkBuddy 云服务',
      showCancel: false,
    });
  },
});
