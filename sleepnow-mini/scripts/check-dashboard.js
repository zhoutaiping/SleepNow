#!/usr/bin/env node
/**
 * 晚安开关 · Dashboard 数据层回归测试
 * 用法：node scripts/check-dashboard.js
 *
 * 覆盖：utils/dashboard.js 纯函数 + home / sleep-log / settings 三页的
 *       render 与 loadOverview 分支（mock 掉 wx / 云端 / 认证 / 主题）
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

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ds(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------- 1. 纯函数 ----------------
console.log('=== 日期 / 环形 / 聚合纯函数 ===');
const days = D.lastNDays(7);
check('lastNDays(7) 长度 7 且末位为今天', days.length === 7 && days[6] === ds(0));
check('parseDate 用本地时区构造（周三识别正确）',
  D.weekdayLabel('2026-11-11', 'zh-CN') === '三' && D.weekdayLabel('2026-11-11', 'en-US') === 'Wed');
const ring = D.buildRing(50, 24);
check('buildRing(50%) 点亮 12/24 段且角度从 0 起每 15 度',
  ring.length === 24 && ring.filter((s) => s.on).length === 12 && ring[1].deg === 15);
check('goalPercent(450) = 94%', D.goalPercent(450) === 94);
check('formatDuration(450) = 7小时30分 / shortDuration = 7h30m',
  D.formatDuration(450, 'zh-CN') === '7小时30分' && D.shortDuration(450) === '7h30m');
check('英文时长格式 7h 30m', D.formatDuration(450, 'en-US') === '7h 30m');

const logs = [
  { id: 1, sleep_date: ds(0), bed_time: '23:15', wake_time: '06:45', duration_min: 450, quality: 4 },
  { id: 2, sleep_date: ds(-1), bed_time: '23:00', wake_time: '06:00', duration_min: 420, quality: 3 },
  { id: 3, sleep_date: ds(-1), bed_time: '01:00', wake_time: '02:00', duration_min: 60, quality: 5 },
  { id: 4, sleep_date: ds(-3), bed_time: '22:30', wake_time: '07:30', duration_min: 540, quality: 5 },
  { id: 5, sleep_date: ds(-20), bed_time: '22:00', wake_time: '06:00', duration_min: 999, quality: 1 },
];
const checkins = [{ checkin_date: ds(0), streak: 4 }, { checkin_date: ds(-2), streak: 3 }];
const s = D.summarize(logs, checkins, days);
check('区间外记录不计入天数（recordDays=3）', s.recordDays === 3);
check('同日多条取均值（近 7 天平均 410 分钟）', s.avgDuration === 410);
check('平均质量 4.3', s.avgQuality === '4.3');
check('覆盖率 43%', s.coverage === 43);
check('连续签到取最新一条 4', s.streak === 4);
check('累计记录 5 条 / 累计 41 小时',
  s.totalLogs === 5 && s.totalHours === Math.round((450 + 420 + 60 + 540 + 999) / 60));
check('lastLog 为最近一天', String(s.lastLog.sleep_date) === ds(0));
check('logDates / checkinDates 供周条使用',
  s.logDates.length === 5 && s.checkinDates.length === 2);

const week = D.buildWeekStrip(days, {
  logDates: s.logDates, checkinDates: s.checkinDates, today: ds(0), lang: 'zh-CN',
});
check('周条 7 列，今天列标记正确', week.length === 7 && week[6].isToday && !week[5].isToday);
check('周条签到/记录标记独立（ds(-2) 有签到但无记录）',
  week[6].checked && week[6].hasLog && week[4].checked === true && week[4].hasLog === false);

const recent = D.recentLogs(logs, 3, 'zh-CN');
check('活动列表按日期降序取 3 条', recent.length === 3 && recent[0].date === ds(0));
check('活动条目时长与质量点阵', recent[0].durationShort === '7h30m' && recent[0].qualityDots.filter((d) => d.on).length === 4);

// ---------------- 2. 页面 render 分支（mock） ----------------
console.log('=== 三页 render / loadOverview 分支 ===');
const chain = {
  select: () => chain, order: () => chain, eq: () => chain,
  limit: () => Promise.resolve({ data: [], error: null }),
  insert: () => Promise.resolve({ error: null }),
};
const mockCloud = { database: { from: () => chain } };
const mockAuth = {
  getSessionSafe: async () => null,
  getIdentity: () => ({ mode: 'guest', uid: 'g_test', user: null }),
  getGuestSleepLogs: () => [], getGuestCheckins: () => [],
  addGuestCheckin: () => {}, addGuestSleepLog: () => {}, logout: async () => {},
};
const mockTheme = {
  bind: () => {}, unbind: () => {}, getTheme: () => 'auto',
  isDarkNow: () => false, setTheme: () => {},
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request.indexOf('utils/cloud') !== -1) return { cloud: mockCloud };
  if (request.indexOf('core/auth') !== -1) return mockAuth;
  if (request.indexOf('core/theme') !== -1) return mockTheme;
  if (request.indexOf('core/i18n') !== -1) {
    return { t: (k) => zh[k] || k, getLang: () => 'zh-CN', setLang: () => {}, all: () => ({}) };
  }
  if (request.indexOf('core/audio-player') !== -1) return { play: () => {} };
  return origLoad.apply(this, arguments);
};
global.wx = {
  setStorageSync: () => {}, getStorageSync: () => '',
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  navigateTo: () => {}, switchTab: () => {}, showModal: () => {},
  getWindowInfo: () => ({ theme: 'light' }),
};
function loadPage(rel) {
  let page = null;
  global.Page = (o) => { page = o; };
  const file = path.join(ROOT, rel);
  delete require.cache[require.resolve(file)];
  require(file);
  page.setData = function (d) { Object.assign(page.data, d); };
  return page;
}

const home = loadPage('pages/home/home.js');
home.render(logs, checkins, true);
check('首页 Hero：最近一晚 7小时30分 / 94%', home.data.hasLast && home.data.ringValue === '7小时30分' && home.data.ringPercent === 94);
check('首页指标：6.8 小时 / 3 天 / 连续 4 天 / 4.3 分',
  home.data.metrics.avg === '6.8' && home.data.metrics.days === 3 &&
  home.data.metrics.streak === 4 && home.data.metrics.quality === '4.3');
check('首页周条与今日签到状态', home.data.week.length === 7 && home.data.checkedToday === true);
check('首页最近记录 3 条 + 访客标记', home.data.recent.length === 3 && home.data.isGuest === true);
home.render([], [], true);
check('首页空数据：Hero 降级为「还没有记录」，环形全灭',
  !home.data.hasLast && home.data.ringValue === '--' && home.data.ringSegs.every((x) => !x.on) && home.data.recent.length === 0);

const logPage = loadPage('pages/sleep-log/sleep-log.js');
logPage.render(logs, false);
check('记录页：ready 态 + 5 条活动', logPage.data.status === 'ready' && logPage.data.total === 5 && logPage.data.logs.length === 5);
check('记录页本周概览 6h50m / 3/7 / 43%',
  logPage.data.overview.avg === '6h50m' && logPage.data.overview.days === '3/7' && logPage.data.overview.coverage === '43%');
check('记录页周条按「是否有睡眠记录」点亮 3 天', logPage.data.week.filter((w) => w.hasLog).length === 3);
logPage.render([], true);
check('记录页空态：周条仍渲染 7 列且 overview 为 --',
  logPage.data.status === 'empty' && logPage.data.week.length === 7 && logPage.data.overview.avg === '--');

(async () => {
  const mine = loadPage('pages/settings/settings.js');
  await mine.loadOverview({ mode: 'guest' });
  check('我的页成就：空数据时三项归零',
    mine.data.achievement.logs === 0 && mine.data.achievement.streak === 0 && mine.data.achievement.hours === 0);
  console.log(failed ? `\n❌ Dashboard 回归失败 ${failed} 项` : '\n✅ Dashboard 回归全部通过');
  process.exit(failed ? 1 : 0);
})();
