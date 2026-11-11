#!/usr/bin/env node
/**
 * 晚安开关 · Bug 修复回归测试（B01/B02/B05/B06/B07/B08/B09/B13）
 * 用法：node scripts/check-regressions.js
 *
 * 与 check-dashboard / check-chat / check-theme 互补：
 * 这些脚本测纯函数与 AI 链路，本脚本专测「异常路径」——
 * 锁屏音频、访客数据合并失败、未发验证码登录、非法时长、连点保存、网络失败提示。
 * 全部通过 mock wx / 云端完成，无需真机与网络。
 */
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

const zh = require(path.join(ROOT, 'i18n/zh-CN'));
const D = require(path.join(ROOT, 'utils/dashboard'));

let failed = 0;
const check = (name, pass) => {
  console.log((pass ? '  ✅ ' : '  ❌ ') + name);
  if (!pass) failed++;
};

// ---------------- 全局 mock ----------------
const storage = {};
const removed = [];
const toasts = [];
const inserts = [];
const intervals = [];
const bg = {
  src: '', title: '', singer: '', coverImgUrl: '', epname: '',
  currentTime: 0, duration: 0,
  onTimeUpdate(cb) { this._time = cb; },
  onPlay(cb) { this._play = cb; },
  onPause(cb) { this._pause = cb; },
  onEnded(cb) { this._end = cb; },
  onStop(cb) { this._stop = cb; },
  onError(cb) { this._err = cb; },
  play() { if (this._play) this._play(); },
  pause() { if (this._pause) this._pause(); },
  stop() { if (this._stop) this._stop(); },
  seek() {},
};

global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { removed.push(k); delete storage[k]; },
  showToast: (o) => toasts.push(o.title),
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  showLoading: () => {}, hideLoading: () => {},
  getWindowInfo: () => ({ theme: 'light' }),
  setNavigationBarTitle: () => {},
  setNavigationBarColor: () => {}, setBackgroundColor: () => {},
  setTabBarStyle: () => {}, setTabBarItem: () => {},
  getBackgroundAudioManager: () => bg,
  login: (o) => o.success({ code: 'mock' }),
  getAccountInfoSync: () => ({ miniProgram: { appId: 'wxmock' } }),
  navigateTo: () => {}, switchTab: () => {}, navigateBack: () => {},
};
global.getCurrentPages = () => [{}, {}];

const fakeCloud = {
  selectError: false, insertFail: false,
  remoteLogs: [], remoteCheckins: [],
  auth: {
    getSession: async () => ({ data: null, error: null }),
    signInWithWechat: async () => ({ data: {}, error: null }),
    sendOtp: async () => ({ data: { verificationId: 'v' }, error: null }),
    verifyOtp: async () => ({ data: {}, error: null }),
    signOut: async () => {},
    onAuthStateChange: () => {},
    handleWorkBuddyMiniProgramCallback: async () => ({}),
  },
  database: {
    from(table) {
      return {
        select: () => ({
          order: () => ({
            limit: async () => {
              if (fakeCloud.selectError) return { data: null, error: { message: 'network' } };
              return {
                data: table === 'sleep_logs' ? fakeCloud.remoteLogs : fakeCloud.remoteCheckins,
                error: null,
              };
            },
          }),
          limit: async () => ({ data: [], error: null }),
        }),
        eq: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        insert: async (row) => {
          inserts.push([table, row]);
          if (fakeCloud.insertFail) return { error: { message: 'insert failed' } };
          return { data: row, error: null };
        },
      };
    },
  },
};

const mockI18n = { t: (k) => zh[k] || k, getLang: () => 'zh-CN', setLang: () => {}, all: () => ({}) };
const mockTheme = {
  bind: () => {}, unbind: () => {}, getTheme: () => 'auto',
  isDarkNow: () => false, setTheme: () => {}, syncNative: () => {},
};
const mockPlayer = { play: () => {}, pause: () => {}, resume: () => {}, stop: () => {}, setTimer: () => {}, getState: () => ({}), onProgress: () => {} };
const mockAuth = {
  getSessionSafe: async () => null,
  getIdentity: () => ({ mode: 'user', uid: 'u1', user: { id: 'u1' } }),
  getGuestSleepLogs: () => [], getGuestCheckins: () => [],
  addGuestCheckin: () => {}, addGuestSleepLog: () => {},
  loginWithWechat: async () => ({ session: {} }),
  loginWithPhone: async () => ({ session: {} }),
  sendPhoneCode: async () => ({ challenge: { verificationId: 'v', isExistingUser: false } }),
};

let resolvers = [];
const origLoad = Module._load;
Module._load = function (request) {
  for (const fn of resolvers) {
    const r = fn(request);
    if (r !== undefined) return r;
  }
  return origLoad.apply(this, arguments);
};

const i18nMock = (req) => (req === './i18n' || req.indexOf('core/i18n') !== -1) ? mockI18n : undefined;
const cloudMock = (req) => (req.indexOf('utils/cloud') !== -1) ? { cloud: fakeCloud } : undefined;
const pageMocks = [
  i18nMock, cloudMock,
  (req) => (req.indexOf('core/auth') !== -1) ? mockAuth : undefined,
  (req) => (req.indexOf('core/theme') !== -1) ? mockTheme : undefined,
  (req) => (req.indexOf('core/audio-player') !== -1) ? mockPlayer : undefined,
];

function fresh(relPath) {
  const file = path.join(ROOT, relPath);
  delete require.cache[require.resolve(file)];
  return require(file);
}
function loadPage(relPath) {
  let page = null;
  global.Page = (o) => { page = o; };
  fresh(relPath);
  page.setData = function (d) { Object.assign(page.data, d); };
  return page;
}

(async () => {
  // ---------------- B01 后台音频 ----------------
  console.log('=== B01 锁屏/后台音频 ===');
  resolvers = [i18nMock];
  const audio = fresh('core/audio-player.js');
  check('play 使用 BackgroundAudioManager 并写入锁屏元数据',
    audio.play('https://example.com/rain.mp3', '雨声') === true &&
    bg.title === '雨声' && !!bg.singer && !!bg.coverImgUrl && bg.src.endsWith('rain.mp3'));
  bg._time && bg._time();
  check('onTimeUpdate 刷新进度且不误停', audio.getState().playing === true);
  audio.setTimer(30);
  audio.clearTimer();
  audio.getState().timerEndAt = Date.now() - 1; // 模拟定时已到
  bg._time && bg._time();
  check('后台触发的 onTimeUpdate 能按绝对时间关闭音频',
    audio.getState().playing === false && audio.getState().src === '');
  audio.clearTimer();

  // ---------------- B02 访客数据合并 ----------------
  console.log('=== B02 访客数据合并（失败不删 / 幂等） ===');
  resolvers = [i18nMock, cloudMock];
  const authReal = fresh('core/auth.js');
  storage.sn_guest_sleep_logs = [{ sleep_date: '2026-11-10', bed_time: '23:00', wake_time: '07:00', duration_min: 480, quality: 4 }];
  storage.sn_guest_checkins = [{ checkin_date: '2026-11-10', streak: 1 }];
  fakeCloud.insertFail = true;
  removed.length = 0; inserts.length = 0;
  const r1 = await authReal.migrateGuestData();
  check('insert 全部失败时本地访客数据仍保留',
    !!storage.sn_guest_sleep_logs && !!storage.sn_guest_checkins && removed.length === 0 && !!r1.error);
  fakeCloud.insertFail = false;
  fakeCloud.remoteLogs = [{ sleep_date: '2026-11-10' }]; // 云端已存在同日记录
  removed.length = 0; inserts.length = 0;
  const r2 = await authReal.migrateGuestData();
  check('幂等：云端已有日期跳过重复插入',
    inserts.filter((x) => x[0] === 'sleep_logs').length === 0 && r2.migrated >= 1);
  check('全部成功后才删除本地数据',
    removed.indexOf('sn_guest_sleep_logs') !== -1 && removed.indexOf('sn_guest_checkins') !== -1 &&
    !storage.sn_guest_sleep_logs && !storage.sn_guest_checkins);
  fakeCloud.remoteLogs = [];

  // ---------------- B05 / B13 登录异常与倒计时 ----------------
  console.log('=== B05 / B13 登录前置校验与倒计时 ===');
  resolvers = pageMocks;
  const login = loadPage('pages/login/login.js');
  login.onLoad();
  toasts.length = 0;
  login.data.code = '123456';
  login.data.challenge = null;
  await login.onPhoneLogin();
  check('未发验证码直接登录：不抛错、按钮复位、给出提示',
    login.data.logging === false && toasts.indexOf(zh['login.needCode']) !== -1);

  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  global.clearInterval = () => {};
  login.data.phone = '13800138000';
  intervals.length = 0;
  await login.onSendCode();
  await login.onSendCode(); // countdown > 0，应被拦截
  check('重复点击发送验证码只创建一个倒计时', intervals.length === 1);
  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;

  // ---------------- B06 / B07 统计口径与异常时长 ----------------
  console.log('=== B06 / B07 统计口径 ===');
  const days = D.lastNDays(7);
  const s = D.summarize([
    { sleep_date: days[5], duration_min: 480, quality: 0 },
    { sleep_date: days[6], duration_min: 480, quality: 5 },
  ], [], days);
  check('无评分记录不拉低平均质量（5.0 而非 2.5）', s.avgQuality === '5.0');
  check('goalPercent 对异常时长钳制到 100%', D.goalPercent(1440) === 100 && D.goalPercent(450) === 94);

  // ---------------- B07 / B08 保存校验与连点 ----------------
  console.log('=== B07 / B08 记录保存 ===');
  const log = loadPage('pages/sleep-log/sleep-log.js');
  log.onLoad();
  inserts.length = 0; toasts.length = 0;
  log.data.sleepDate = '2026-11-11';
  log.data.bedTime = '23:00';
  log.data.wakeTime = '23:00'; // 旧实现会算出 1440 分钟
  await log.save();
  check('bed==wake 的 24h 记录被拒绝', inserts.length === 0 && toasts.indexOf(zh['log.durationInvalid']) !== -1);

  log.data.wakeTime = '07:00';
  log._dates['2026-11-11'] = true;
  toasts.length = 0;
  await log.save();
  check('同日已有记录时拒绝重复写入', inserts.length === 0 && toasts.indexOf(zh['log.duplicate']) !== -1);

  log._dates = {};
  inserts.length = 0;
  await Promise.all([log.save(), log.save()]);
  check('连点两次保存只写入一次', inserts.length === 1);

  // ---------------- B09 网络异常可见反馈 ----------------
  console.log('=== B09 网络异常错误态 ===');
  fakeCloud.selectError = true;
  const home = loadPage('pages/home/home.js');
  await home.loadDashboard();
  check('首页云端失败显示轻错误条', home.data.loadError === true);
  const mine = loadPage('pages/settings/settings.js');
  await mine.loadOverview({ mode: 'user' });
  check('我的页云端失败显示轻错误条', mine.data.dataError === true);
  fakeCloud.selectError = false;

  console.log(failed ? `\n❌ 修复点回归失败 ${failed} 项` : '\n✅ 修复点回归全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('回归脚本异常：', e);
  process.exit(1);
});
