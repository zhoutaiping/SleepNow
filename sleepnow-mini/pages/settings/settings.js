const i18n = require('../../core/i18n');
const theme = require('../../core/theme');
const auth = require('../../core/auth');

// auto 模式下展示「实际生效的 mode · 跟随系统」，让切换控件明确传达自身状态
function themeStateLabel() {
  const mode = theme.getTheme();
  const effective = mode === 'auto' ? (theme.isDarkNow() ? 'dark' : 'light') : mode;
  const label = i18n.t('theme.' + effective);
  return mode === 'auto' ? label + ' · ' + i18n.t('theme.auto') : label;
}

Page({
  data: {
    lang: 'zh-CN',
    theme: 'auto',
    themeState: '',
    themeDesc: '',
    themeAuto: '',
    themeLight: '',
    themeDark: '',
    themeCurrent: '',
    user: null,
    loading: true,
    isGuest: false,
    loginText: '',
    logoutText: '',
    langText: '',
    themeText: '',
    aboutText: '',
  },

  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
  },

  buildTexts() {
    this.setData({
      lang: i18n.getLang(),
      theme: theme.getTheme(),
      themeState: themeStateLabel(),
      loginText: i18n.t('settings.login'),
      logoutText: i18n.t('settings.logout'),
      langText: i18n.t('settings.language'),
      themeText: i18n.t('settings.theme'),
      aboutText: i18n.t('settings.about'),
      themeAuto: i18n.t('theme.auto'),
      themeLight: i18n.t('theme.light'),
      themeDark: i18n.t('theme.dark'),
      themeCurrent: i18n.t('theme.current'),
      themeDesc: i18n.t('theme.desc'),
    });
  },

  async onShow() {
    this.buildTexts();
    this.setData({ loading: true });
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    this.setData({ user: id.user, isGuest: id.mode === 'guest', loading: false });
  },

  switchLang(e) {
    i18n.setLang(e.currentTarget.dataset.lang);
    this.buildTexts();
    wx.showToast({ title: i18n.t('common.switched'), icon: 'none' });
  },

  switchTheme(e) {
    theme.setTheme(e.currentTarget.dataset.theme);
    this.buildTexts();
    wx.showToast({ title: i18n.t('theme.switched'), icon: 'none' });
  },

  onLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onLogout() {
    wx.showModal({
      title: i18n.t('settings.logout'),
      success: async (res) => {
        if (res.confirm) {
          await auth.logout();
          this.setData({ user: null, isGuest: true });
        }
      },
    });
  },
});
