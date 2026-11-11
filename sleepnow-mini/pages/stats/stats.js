// 睡眠统计页：按近 7 / 30 天聚合 sleep_logs 与 checkins
// 身份分流与 sleep-log / home 保持一致：登录用户读云端，访客读本地
const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const auth = require('../../core/auth');

const MAX_BAR_RPX = 220;        // 柱状图最高柱子（rpx）
const MAX_SCALE_MIN = 12 * 60;  // 刻度下限 12 小时，避免单条记录把柱子撑满

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function lastNDays(n) {
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    list.push(dateStr(d));
  }
  return list;
}
function formatDuration(mins) {
  if (!mins || mins <= 0) return '--';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (i18n.getLang() === 'en-US') return `${h}h ${m}m`;
  return `${h}${i18n.t('stats.hours')}${m}${i18n.t('stats.minutes')}`;
}

Page({
  data: {
    t: {},               // 扁平词条，供 wxml 直接用 {{t.xxx}}
    range: 7,
    status: 'loading',   // loading | ready | empty | error
    errorMsg: '',
    isGuest: false,
    avgDuration: '--',
    avgQuality: '--',
    recordDays: 0,
    coverage: 0,
    streak: 0,
    bars: [],
    maxLabel: '',
  },

  onShow() {
    this.setData({ t: this.buildTexts() });
    wx.setNavigationBarTitle({ title: i18n.t('stats.title') });
    this.load();
  },

  buildTexts() {
    const keys = [
      'title', 'days7', 'days30', 'avgDuration', 'avgQuality', 'recordDays',
      'streak', 'chartTitle', 'empty', 'guestHint', 'error', 'daysUnit', 'goLog',
    ];
    const t = {};
    keys.forEach((k) => { t[k] = i18n.t('stats.' + k); });
    t.loading = i18n.t('common.loading');
    t.retry = i18n.t('common.retry');
    return t;
  },

  switchRange(e) {
    const range = Number(e.currentTarget.dataset.range);
    if (range === this.data.range) return;
    this.setData({ range });
    this.load();
  },

  async load() {
    this.setData({ status: 'loading', errorMsg: '' });
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    let logs = [];
    let checkins = [];

    if (id.mode === 'user') {
      const { data, error } = await cloud.database.from('sleep_logs')
        .select('sleep_date, quality, duration_min')
        .order('sleep_date', { ascending: false })
        .limit(90);
      if (error) {
        this.setData({ status: 'error', errorMsg: error.message || i18n.t('stats.error') });
        return;
      }
      logs = data || [];
      const ck = await cloud.database.from('checkins')
        .select('checkin_date, streak')
        .order('checkin_date', { ascending: false })
        .limit(1);
      if (ck.error) {
        this.setData({ status: 'error', errorMsg: ck.error.message || i18n.t('stats.error') });
        return;
      }
      checkins = ck.data || [];
    } else {
      logs = auth.getGuestSleepLogs();
      checkins = auth.getGuestCheckins();
    }

    this.render(logs, checkins, id.mode === 'guest');
  },

  render(logs, checkins, isGuest) {
    const range = this.data.range;
    const days = lastNDays(range);
    const daySet = {};
    days.forEach((d) => { daySet[d] = { sum: 0, count: 0 }; });

    let durationSum = 0;
    let durationCount = 0;
    let qualitySum = 0;
    let qualityCount = 0;

    (logs || []).forEach((r) => {
      const d = String(r.sleep_date || '').slice(0, 10);
      if (!daySet[d]) return; // 只统计当前区间内的日期
      const dur = Number(r.duration_min) || 0;
      const q = Number(r.quality) || 0;
      daySet[d].count += 1;
      daySet[d].sum += dur;
      if (dur > 0) { durationSum += dur; durationCount += 1; }
      if (q > 0) { qualitySum += q; qualityCount += 1; }
    });

    const valid = days.filter((d) => daySet[d].count > 0);
    let maxMinutes = MAX_SCALE_MIN;
    valid.forEach((d) => {
      const m = Math.round(daySet[d].sum / daySet[d].count);
      if (m > maxMinutes) maxMinutes = m;
    });

    const bars = days.map((d, i) => {
      const item = daySet[d];
      const mins = item.count ? Math.round(item.sum / item.count) : 0;
      const height = mins > 0
        ? Math.max(8, Math.round((mins / maxMinutes) * MAX_BAR_RPX))
        : 4;
      return {
        date: d,
        label: (range === 7 || i % 5 === 0 || i === days.length - 1)
          ? d.slice(5).replace('-', '/')
          : '',
        minutes: mins,
        hasData: item.count > 0,
        barHeight: height,
      };
    });

    let streak = 0;
    if (checkins && checkins.length) {
      let latest = checkins[0];
      checkins.forEach((c) => {
        if (String(c.checkin_date) > String(latest.checkin_date)) latest = c;
      });
      streak = Number(latest.streak) || 0;
    }

    this.setData({
      status: valid.length ? 'ready' : 'empty',
      isGuest,
      avgDuration: durationCount ? formatDuration(Math.round(durationSum / durationCount)) : '--',
      avgQuality: qualityCount ? (qualitySum / qualityCount).toFixed(1) : '--',
      recordDays: valid.length,
      coverage: Math.round((valid.length / range) * 100),
      streak,
      bars,
      maxLabel: formatDuration(maxMinutes),
    });
  },

  retry() { this.load(); },
  goLog() { wx.navigateBack(); },
});
