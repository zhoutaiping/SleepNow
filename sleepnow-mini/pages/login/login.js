const i18n = require('../../core/i18n');
const auth = require('../../core/auth');
const theme = require('../../core/theme');

Page({
  data: {
    title: '',
    wechatText: '',
    phoneText: '',
    guestText: '',
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
    this.setData({
      title: i18n.t('login.title'),
      wechatText: i18n.t('login.wechat'),
      phoneText: i18n.t('login.phone'),
      guestText: i18n.t('login.guest'),
    });
    this._timer = null;
  },
  onUnload() {
    theme.unbind(this);
    if (this._timer) clearInterval(this._timer);
  },
  async onWechat() {
    if (this.data.logging) return;
    this.setData({ logging: true });
    const { error } = await auth.loginWithWechat();
    this.setData({ logging: false });
    if (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.finish();
  },
  onPhoneInput(e) {
    this.setData({ phone: e.detail.value, phoneError: '' });
  },
  onCodeInput(e) {
    this.setData({ code: e.detail.value });
  },
  async onSendCode() {
    const phone = this.data.phone;
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ phoneError: '请输入正确的 11 位手机号' });
      return;
    }
    this.setData({ sending: true });
    const { challenge, error } = await auth.sendPhoneCode(phone);
    this.setData({ sending: false });
    if (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.setData({ codeSent: true, challenge, countdown: 60 });
    wx.showToast({ title: '验证码已发送', icon: 'none' });
    this._timer = setInterval(() => {
      const c = this.data.countdown - 1;
      if (c <= 0) {
        clearInterval(this._timer);
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: c });
      }
    }, 1000);
  },
  async onPhoneLogin() {
    const { phone, code, challenge } = this.data;
    if (!code) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return;
    }
    if (this.data.logging) return;
    this.setData({ logging: true });
    const { error } = await auth.loginWithPhone(phone, code, challenge);
    this.setData({ logging: false });
    if (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.finish();
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
