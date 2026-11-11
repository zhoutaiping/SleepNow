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
    // 语音输入默认走系统键盘麦克风（个人主体零配置可用）。
    // 若要 App 内录音转文字，二选一（详见《AI 接入实操方案》第 10 节）：
    //   1) 企业主体：app.json 声明 WechatSI 插件 + 后台添加，utils/speech.js 自动启用
    //   2) 任意主体：wx.cloud.init({ env: '你的环境ID' })
    //                require('./utils/speech').enableCloudASR({ name: 'speechToText' })
    // 不要在此处写任何 SecretId / SecretKey，密钥只能放云函数环境变量。
  },
  onShow(options) {
    // 从后台回前台：系统可能重刷了原生控件配色，按用户手动选择再同步一次
    theme.syncNative();
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
