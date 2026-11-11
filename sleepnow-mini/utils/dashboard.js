// 仪表盘数据层：纯函数，无 wx / 云端依赖，可在 Node 下直接单测
// 首页 / 睡眠记录 / 我的 三页共用，保证统计口径完全一致
// ---------------------------------------------------------------------------
// 设计参照健身类 App：日期序列 → 周打卡条 → 指标聚合 → 活动列表
// 时区处理：一律用 new Date(y, m-1, d) 本地构造，避免 'YYYY-MM-DD' 被按 UTC 解析错开一天

const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GOAL_MINUTES = 8 * 60; // 默认睡眠目标 8 小时

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(s) {
  const str = String(s || '').slice(0, 10);
  return new Date(Number(str.slice(0, 4)), Number(str.slice(5, 7)) - 1, Number(str.slice(8, 10)));
}

// 以今天为末尾，返回最近 n 天的日期字符串（升序）
function lastNDays(n, base) {
  const b = base || new Date();
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    d.setDate(d.getDate() - i);
    list.push(dateStr(d));
  }
  return list;
}

function offsetStr(days, base) {
  const b = base || new Date();
  const d = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  d.setDate(d.getDate() + days);
  return dateStr(d);
}

function weekdayLabel(s, lang) {
  const w = parseDate(s).getDay();
  return (lang === 'en-US' ? WEEK_EN : WEEK_ZH)[w];
}

// 可读日期：11 月 11 日 · 周三 / Nov 11 · Wed
function todayLabel(base, lang) {
  const d = base || new Date();
  const w = (lang === 'en-US' ? WEEK_EN : WEEK_ZH)[d.getDay()];
  if (lang === 'en-US') {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${m[d.getMonth()]} ${d.getDate()} · ${w}`;
  }
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
}

function durationParts(mins) {
  const v = Math.max(0, Math.round(Number(mins) || 0));
  return { h: Math.floor(v / 60), m: v % 60 };
}

function formatDuration(mins, lang) {
  if (!mins || mins <= 0) return '--';
  const { h, m } = durationParts(mins);
  if (lang === 'en-US') return `${h}h ${pad(m)}m`;
  return `${h}小时${m}分`;
}

// 列表右侧的大数字，短格式：7h30m / 7:30
function shortDuration(mins) {
  if (!mins || mins <= 0) return '--';
  const { h, m } = durationParts(mins);
  return `${h}h${pad(m)}m`;
}

// 分段环形进度：返回每个小条的旋转角度与是否点亮
function buildRing(percent, count) {
  const total = count || 24;
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((p / 100) * total);
  const segs = [];
  for (let i = 0; i < total; i++) {
    segs.push({ i: i, deg: Math.round((360 / total) * i), on: i < filled });
  }
  return segs;
}

// 近 7 天周条：签到 / 睡眠记录两种标记都返回，页面按需取用
function buildWeekStrip(days, opts) {
  const o = opts || {};
  const logSet = {};
  const checkSet = {};
  (o.logDates || []).forEach((d) => { logSet[String(d).slice(0, 10)] = true; });
  (o.checkinDates || []).forEach((d) => { checkSet[String(d).slice(0, 10)] = true; });
  const today = o.today || days[days.length - 1];
  const lang = o.lang;
  return days.map((d) => ({
    date: d,
    weekday: weekdayLabel(d, lang),
    dayNum: String(Number(d.slice(8, 10))),
    hasLog: !!logSet[d],
    checked: !!checkSet[d],
    isToday: d === today,
  }));
}

// 聚合：只统计 days 区间内的记录，与 stats 页口径一致（同日多条取均值）
function summarize(logs, checkins, days) {
  const daySet = {};
  days.forEach((d) => { daySet[d] = { sum: 0, count: 0, quality: 0, qCount: 0 }; });
  const logDates = [];
  let totalMinutes = 0;

  (logs || []).forEach((r) => {
    const d = String(r.sleep_date || '').slice(0, 10);
    const dur = Number(r.duration_min) || 0;
    const q = Number(r.quality) || 0;
    totalMinutes += dur;
    logDates.push(d);
    if (!daySet[d]) return;
    daySet[d].count += 1;
    daySet[d].sum += dur;
    if (q > 0) { daySet[d].quality += q; daySet[d].qCount += 1; }
  });

  let durationSum = 0, durationCount = 0, qualitySum = 0, qualityCount = 0, recordDays = 0;
  Object.keys(daySet).forEach((d) => {
    const it = daySet[d];
    if (!it.count) return;
    recordDays += 1;
    durationSum += it.sum / it.count;
    durationCount += 1;
    qualitySum += it.quality / (it.qCount || 1);
    qualityCount += 1;
  });

  let streak = 0;
  let latest = null;
  (checkins || []).forEach((c) => {
    const d = String(c.checkin_date || '');
    if (!latest || d > latest.d) latest = { d: d, streak: Number(c.streak) || 0 };
  });
  if (latest) streak = latest.streak;

  const sorted = (logs || []).slice().sort((a, b) =>
    String(b.sleep_date || '').localeCompare(String(a.sleep_date || '')));

  return {
    avgDuration: durationCount ? Math.round(durationSum / durationCount) : 0,
    avgQuality: qualityCount ? (qualitySum / qualityCount).toFixed(1) : '--',
    recordDays: recordDays,
    coverage: days.length ? Math.round((recordDays / days.length) * 100) : 0,
    streak: streak,
    totalLogs: (logs || []).length,
    totalHours: Math.round(totalMinutes / 60),
    lastLog: sorted[0] || null,
    logDates: logDates,
    checkinDates: (checkins || []).map((c) => String(c.checkin_date || '').slice(0, 10)),
  };
}

// 活动列表：健身 App 的「最近训练」条目
function recentLogs(logs, n, lang) {
  const sorted = (logs || []).slice().sort((a, b) =>
    String(b.sleep_date || '').localeCompare(String(a.sleep_date || '')));
  return sorted.slice(0, n || 3).map((r, i) => {
    const d = String(r.sleep_date || '').slice(0, 10);
    const q = Number(r.quality) || 0;
    return {
      id: r.id !== undefined ? r.id : 'r' + i,
      date: d,
      dateLabel: d.slice(5).replace('-', '/'),
      weekday: weekdayLabel(d, lang),
      time: [r.bed_time, r.wake_time].filter(Boolean).map((t) => String(t).slice(0, 5)).join(' → '),
      durationText: formatDuration(r.duration_min, lang),
      durationShort: shortDuration(r.duration_min),
      quality: q,
      qualityDots: [1, 2, 3, 4, 5].map((k) => ({ k: k, on: k <= q })),
    };
  });
}

function goalPercent(mins, goal) {
  const g = goal || GOAL_MINUTES;
  return Math.round((Math.max(0, Number(mins) || 0) / g) * 100);
}

module.exports = {
  GOAL_MINUTES, pad, dateStr, parseDate, lastNDays, offsetStr,
  weekdayLabel, todayLabel, durationParts, formatDuration, shortDuration,
  buildRing, buildWeekStrip, summarize, recentLogs, goalPercent,
};
