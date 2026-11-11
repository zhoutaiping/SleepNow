const i18n = require('../../core/i18n');
const theme = require('../../core/theme');
const auth = require('../../core/auth');

Page({
  data: {
    lang: 'zh-CN',
    theme: 'auto',
    user: null,
    loading: true,
    isGuest: false,
    loginText: '',
    logoutText: '',
    langText: '',
    themeText: '',
    aboutText: '',
  },
  async onShow() {
    this.setData({
      lang: i18n.getLang(),
      theme: theme.getTheme(),
      loading: true,
      loginText: i18n.t('settings.login'),
      logoutText: i18n.t('settings.logout'),
      langText: i18n.t('settings.language'),
      themeText: i18n.t('settings.theme'),
      aboutText: i18n.t('settings.about'),
    });
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    this.setData({ user: id.user, isGuest: id.mode === 'guest', loading: false });
  },
  switchLang(e) {
    i18n.setLang(e.currentTarget.dataset.lang);
    this.setData({ lang: i18n.getLang() });
    wx.showToast({ title: '已切换', icon: 'none' });
  },
  switchTheme(e) {
    theme.setTheme(e.currentTarget.dataset.theme);
    this.setData({ theme: theme.getTheme() });
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
