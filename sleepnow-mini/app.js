const { cloud } = require('./utils/cloud');
const theme = require('./core/theme');
const i18n = require('./core/i18n');

App({
  globalData: {
    appName: '晚安开关',
  },
  onLaunch() {
    theme.initTheme();
    i18n.initI18n();
  },
  onShow(options) {
    // WorkBuddy 小程序账号登录回调：在任意登录守卫/查询之前处理
    this.authReady = (async () => {
      const callback = await cloud.auth.handleWorkBuddyMiniProgramCallback(options);
      if (callback.error) return callback;
      return cloud.auth.getSession();
    })();
  },
  // 系统深色模式变化：auto 模式下自动跟随（需 app.json 开启 darkmode）
  onThemeChange(res) {
    theme.onSystemThemeChange(res && res.theme);
  },
});
