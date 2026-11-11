const i18n = require('../../core/i18n');
const auth = require('../../core/auth');
const theme = require('../../core/theme');

const TEXT_KEYS = {
  title: 'login.title', sub: 'login.sub', or: 'login.or',
  wechat: 'login.wechat', phone: 'login.phone', guest: 'login.guest',
  phonePlaceholder: 'login.phonePlaceholder', codePlaceholder: 'login.codePlaceholder',
  sendCode: 'login.sendCode',
};

Page({
  data: {
    t: {},
    phone: '',
    code: '',
    codeSent: false,
    sending: false,
    countdown: 0,
    phoneError: '',
    logging: false,
    challenge: null,
  },
  onLoad() {
    theme.bind(this);
    this.setData({ t: this.buildTexts() });
    this._timer = null;
  },
  onUnload() {
    theme.unbind(this);
    this.stopCountdown();
  },
  onShow() {
    // 语言可在「我的」页切换，返回本页时刷新文案
    this.setData({ t: this.buildTexts() });
  },

  buildTexts() {
    const t = {};
    Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
    return t;
  },

  toast(key) { wx.showToast({ title: i18n.t(key), icon: 'none' }); },

  async onWechat() {
    if (this.data.logging) return;
    this.setData({ logging: true });
    try {
      const { error } = await auth.loginWithWechat();
      if (error) {
        wx.showToast({ title: error.message, icon: 'none' });
        return;
      }
      this.finish();
    } catch (e) {
      this.toast('login.wechatFail');
    } finally {
      this.setData({ logging: false });
    }
  },
  onPhoneInput(e) {
    this.setData({ phone: e.detail.value, phoneError: '' });
  },
  onCodeInput(e) {
    this.setData({ code: e.detail.value });
  },

  stopCountdown() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async onSendCode() {
    // BUG B13：重复点击会创建多个 interval，秒数加速错乱
    if (this.data.sending || this.data.countdown > 0) return;
    const phone = this.data.phone;
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ phoneError: i18n.t('login.invalidPhone') });
      return;
    }
    this.setData({ sending: true });
    let challenge = null;
    try {
      const res = await auth.sendPhoneCode(phone);
      if (res.error) {
        wx.showToast({ title: res.error.message, icon: 'none' });
        return;
      }
      challenge = res.challenge;
    } catch (e) {
      this.toast('login.codeSendFail');
      return;
    } finally {
      this.setData({ sending: false });
    }
    this.stopCountdown();
    this.setData({ codeSent: true, challenge, countdown: 60 });
    this.toast('login.codeSent');
    this._timer = setInterval(() => {
      const c = this.data.countdown - 1;
      if (c <= 0) {
        this.stopCountdown();
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: c });
      }
    }, 1000);
  },

  async onPhoneLogin() {
    const { phone, code, challenge, logging } = this.data;
    // BUG B05：未发验证码时 challenge=null，旧实现读 verificationId 直接抛错，
    // logging 永远无法复位，登录按钮永久转圈。此处前置校验 + try/finally 兜底。
    if (logging) return;
    if (!challenge || !challenge.verificationId) { this.toast('login.needCode'); return; }
    if (!code) { this.toast('login.codeRequired'); return; }
    this.setData({ logging: true });
    try {
      const { error } = await auth.loginWithPhone(phone, code, challenge);
      if (error) {
        wx.showToast({ title: error.message, icon: 'none' });
        return;
      }
      this.finish();
    } catch (e) {
      this.toast('login.loginFail');
    } finally {
      this.setData({ logging: false });
    }
  },
  onGuest() {
    this.finish();
  },
  finish() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/settings/settings' });
  },
});
