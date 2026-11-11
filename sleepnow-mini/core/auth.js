// 登录与身份管理：微信(openid 静默登录) / 手机号(短信验证码 OTP) / 访客(本地存储)
// 个人主体说明：
//  - 微信登录走 wx.login 的 code → openid，拿不到手机号（getPhoneNumber 个人主体不可用）
//  - 手机号登录由 WorkBuddy 云服务后端处理短信，个人主体可用
//  - 云服务禁止匿名登录，故访客数据存本地，登录后询问是否并入账号
// ---------------------------------------------------------------------------
// 数据安全约定（BUG B02）：访客数据只有在「全部成功写入云端」后才删除本地副本；
// 任一条失败都保留本地数据，下次登录靠云端日期查重实现幂等合并，绝不静默丢数据。
// ---------------------------------------------------------------------------
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

// 异步刷新并缓存登录态，返回 session 或 null。
// 网络异常 / SDK 抛错一律降级为访客，不能让登录态查询把整页打挂（BUG B09）
async function getSessionSafe() {
  try {
    const { data, error } = await cloud.auth.getSession();
    if (data && !error) {
      _session = data;
      return _session;
    }
  } catch (e) {
    // 静默降级：调用方按访客身份继续渲染，并由页面展示轻错误条
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
          await afterLogin();
          resolve({ session });
        } catch (e) {
          resolve({ error: { message: i18n.t('login.wechatFail') } });
        }
      },
      fail: (err) => resolve({ error: { message: (err && err.errMsg) || i18n.t('login.wechatFail') } }),
    });
  });
}

// 发送手机验证码，返回 challenge（含 verificationId / isExistingUser）
async function sendPhoneCode(phone) {
  if (!/^1\d{10}$/.test(phone)) {
    return { error: { message: i18n.t('login.invalidPhone') } };
  }
  try {
    const { data, error } = await cloud.auth.sendOtp({ phone });
    if (error) return { error };
    if (!data || !data.verificationId) {
      return { error: { message: i18n.t('login.codeSendFail') } };
    }
    return { challenge: data };
  } catch (e) {
    return { error: { message: i18n.t('login.codeSendFail') } };
  }
}

// 用验证码完成手机号登录
// BUG B05：challenge 为空时必须前置拦截，不能让 TypeError 逃逸导致按钮永久 loading
async function loginWithPhone(phone, code, challenge) {
  if (!challenge || !challenge.verificationId) {
    return { error: { message: i18n.t('login.needCode') } };
  }
  try {
    const { data, error } = await cloud.auth.verifyOtp({
      phone,
      verificationId: challenge.verificationId,
      isExistingUser: challenge.isExistingUser,
      token: code,
    });
    if (error) return { error };
    const { data: session } = await cloud.auth.getSession();
    _session = session;
    await afterLogin();
    return { session };
  } catch (e) {
    return { error: { message: i18n.t('login.loginFail') } };
  }
}

async function logout() {
  await cloud.auth.signOut();
  _session = null;
}

// 登录成功后：询问是否把访客期间的本地数据并入账号。
// 合并失败不能阻断登录本身（用户已经登录成功），只提示并保留本地数据。
async function afterLogin() {
  try {
    await migrateGuestData();
  } catch (e) {
    try { wx.showToast({ title: i18n.t('login.mergeFail'), icon: 'none' }); } catch (err) {}
  }
}

function uniqBy(list, key) {
  const map = {};
  (list || []).forEach((item) => {
    const k = String((item && item[key]) || '').slice(0, 10);
    if (k) map[k] = item; // 同日多条以最后一条为准
  });
  return Object.keys(map).map((k) => map[k]);
}

function dateSet(rows, key) {
  const set = {};
  (rows || []).forEach((r) => { set[String(r[key] || '').slice(0, 10)] = true; });
  return set;
}

async function migrateGuestData() {
  const sleep = uniqBy(wx.getStorageSync(GUEST_SLEEP_KEY) || [], 'sleep_date');
  const checkins = uniqBy(wx.getStorageSync(GUEST_CHECKIN_KEY) || [], 'checkin_date');
  if (!sleep.length && !checkins.length) return { migrated: 0, skipped: 'empty' };

  const confirm = await new Promise((resolve) => {
    wx.showModal({
      title: i18n.t('login.mergeTitle'),
      content: i18n.t('login.mergeContent'),
      confirmText: i18n.t('login.migrate'),
      cancelText: i18n.t('login.skip'),
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false), // 弹窗失败不能让 Promise 永远悬着
    });
  });
  if (!confirm) return { migrated: 0, skipped: 'user' };

  // 先读云端已有日期，保证重复登录 / 部分失败重试时不会产生重复行
  let remoteLogs = [];
  let remoteCheckins = [];
  try {
    const r1 = await cloud.database.from('sleep_logs')
      .select('sleep_date').order('sleep_date', { ascending: false }).limit(1000);
    if (r1.error) throw new Error(r1.error.message || 'read sleep_logs failed');
    remoteLogs = r1.data || [];
    const r2 = await cloud.database.from('checkins')
      .select('checkin_date').order('checkin_date', { ascending: false }).limit(1000);
    if (r2.error) throw new Error(r2.error.message || 'read checkins failed');
    remoteCheckins = r2.data || [];
  } catch (e) {
    return { error: { message: i18n.t('login.mergeFail') }, migrated: 0 };
  }

  const hasLog = dateSet(remoteLogs, 'sleep_date');
  const hasCheckin = dateSet(remoteCheckins, 'checkin_date');
  const failures = [];
  let migrated = 0;

  for (const item of sleep) {
    const d = String(item.sleep_date || '').slice(0, 10);
    if (!d || hasLog[d]) continue;
    try {
      const { error } = await cloud.database.from('sleep_logs').insert({
        sleep_date: d,
        bed_time: item.bed_time,
        wake_time: item.wake_time,
        quality: item.quality,
        duration_min: item.duration_min,
        source: 'guest',
        note: item.note || null,
      });
      if (error) throw new Error(error.message || 'insert failed');
      migrated += 1;
    } catch (e) {
      failures.push('sleep_logs:' + d);
    }
  }
  for (const item of checkins) {
    const d = String(item.checkin_date || '').slice(0, 10);
    if (!d || hasCheckin[d]) continue;
    try {
      const { error } = await cloud.database.from('checkins').insert({
        checkin_date: d,
        streak: item.streak,
      });
      if (error) throw new Error(error.message || 'insert failed');
      migrated += 1;
    } catch (e) {
      failures.push('checkins:' + d);
    }
  }

  if (failures.length) {
    try { wx.showToast({ title: i18n.t('login.mergeFail'), icon: 'none' }); } catch (e) {}
    // 关键：本地数据全部保留，下次登录重试；已成功的行由云端查重跳过
    return { error: { message: i18n.t('login.mergeFail') }, migrated, failures };
  }

  wx.removeStorageSync(GUEST_SLEEP_KEY);
  wx.removeStorageSync(GUEST_CHECKIN_KEY);
  return { migrated, failures: [] };
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
  migrateGuestData,
  onAuthStateChange: (cb) => cloud.auth.onAuthStateChange(cb),
};
