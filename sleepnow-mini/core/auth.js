// 登录与身份管理：微信(openid 静默登录) / 手机号(短信验证码 OTP) / 访客(本地存储)
// 个人主体说明：
//  - 微信登录走 wx.login 的 code → openid，拿不到手机号（getPhoneNumber 个人主体不可用）
//  - 手机号登录由 WorkBuddy 云服务后端处理短信，个人主体可用
//  - 云服务禁止匿名登录，故访客数据存本地，登录后询问是否并入账号
const { cloud } = require('../utils/cloud');
const i18n = require('./i18n');

const GUEST_ID_KEY = 'sn_guest_id';
const GUEST_SLEEP_KEY = 'sn_guest_sleep_logs';
const GUEST_CHECKIN_KEY = 'sn_guest_checkins';

let _session = null; // 内存缓存当前登录态

function getGuestId() {
  let id = wx.getStorageSync(GUEST_ID_KEY);
  if (!id) {
    id = 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    wx.setStorageSync(GUEST_ID_KEY, id);
  }
  return id;
}

// 异步刷新并缓存登录态，返回 session 或 null
async function getSessionSafe() {
  const { data, error } = await cloud.auth.getSession();
  if (data && !error) {
    _session = data;
    return _session;
  }
  return null;
}

// 同步返回当前身份：登录态 mode='user'，否则 mode='guest'
function getIdentity() {
  if (_session && _session.user) {
    return { mode: 'user', uid: _session.user.id, user: _session.user };
  }
  return { mode: 'guest', uid: getGuestId(), user: null };
}

// 微信静默登录：openid 维度，个人主体可用，无法获取手机号
function loginWithWechat() {
  return new Promise((resolve) => {
    wx.login({
      async success({ code }) {
        try {
          const appid = wx.getAccountInfoSync().miniProgram.appId;
          const { data: session, error } = await cloud.auth.signInWithWechat(code, appid);
          if (error) return resolve({ error });
          _session = session;
          afterLogin();
          resolve({ session });
        } catch (e) {
          resolve({ error: { message: '微信登录失败，请重试' } });
        }
      },
      fail: (err) => resolve({ error: { message: (err && err.errMsg) || '微信登录失败' } }),
    });
  });
}

// 发送手机验证码，返回 challenge（含 verificationId / isExistingUser）
async function sendPhoneCode(phone) {
  if (!/^1\d{10}$/.test(phone)) {
    return { error: { message: '请输入正确的 11 位手机号' } };
  }
  const { data, error } = await cloud.auth.sendOtp({ phone });
  if (error) return { error };
  return { challenge: data };
}

// 用验证码完成手机号登录
async function loginWithPhone(phone, code, challenge) {
  const { data, error } = await cloud.auth.verifyOtp({
    phone,
    verificationId: challenge.verificationId,
    isExistingUser: challenge.isExistingUser,
    token: code,
  });
  if (error) return { error };
  const { data: session } = await cloud.auth.getSession();
  _session = session;
  afterLogin();
  return { session };
}

async function logout() {
  await cloud.auth.signOut();
  _session = null;
}

// 登录成功后：询问是否把访客期间的本地数据并入账号
async function afterLogin() {
  await migrateGuestData();
}

async function migrateGuestData() {
  const sleep = wx.getStorageSync(GUEST_SLEEP_KEY) || [];
  const checkins = wx.getStorageSync(GUEST_CHECKIN_KEY) || [];
  if (sleep.length + checkins.length === 0) return;
  const confirm = await new Promise((resolve) => {
    wx.showModal({
      title: i18n.t('login.mergeTitle'),
      content: i18n.t('login.mergeContent'),
      confirmText: i18n.t('login.migrate'),
      cancelText: i18n.t('login.skip'),
      success: (r) => resolve(!!r.confirm),
    });
  });
  if (!confirm) return;
  for (const item of sleep) {
    await cloud.database.from('sleep_logs').insert({
      sleep_date: item.sleep_date,
      bed_time: item.bed_time,
      wake_time: item.wake_time,
      quality: item.quality,
      duration_min: item.duration_min,
      source: 'guest',
      note: item.note || null,
    });
  }
  for (const item of checkins) {
    await cloud.database.from('checkins').insert({
      checkin_date: item.checkin_date,
      streak: item.streak,
    });
  }
  wx.removeStorageSync(GUEST_SLEEP_KEY);
  wx.removeStorageSync(GUEST_CHECKIN_KEY);
}

// ===== 访客本地存储（未登录时使用） =====
function getGuestSleepLogs() {
  return wx.getStorageSync(GUEST_SLEEP_KEY) || [];
}
function addGuestSleepLog(item) {
  const list = getGuestSleepLogs();
  list.unshift(item);
  wx.setStorageSync(GUEST_SLEEP_KEY, list);
}
function getGuestCheckins() {
  return wx.getStorageSync(GUEST_CHECKIN_KEY) || [];
}
function addGuestCheckin(item) {
  const list = getGuestCheckins();
  list.push(item);
  wx.setStorageSync(GUEST_CHECKIN_KEY, list);
}

module.exports = {
  getSessionSafe,
  getIdentity,
  loginWithWechat,
  sendPhoneCode,
  loginWithPhone,
  logout,
  getGuestSleepLogs,
  addGuestSleepLog,
  getGuestCheckins,
  addGuestCheckin,
  onAuthStateChange: (cb) => cloud.auth.onAuthStateChange(cb),
};
