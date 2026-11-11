// 睡眠统计页：按近 7 / 30 天聚合 sleep_logs 与 checkins
// 身份分流与 sleep-log / home 保持一致：登录用户读云端，访客读本地
// ---------------------------------------------------------------------------
// BUG B06：统计口径统一到 utils/dashboard.js 的 summarize()，
// 本页只保留柱状图所需的「按日均值」计算，避免与首页/记录页数值打架。
// ---------------------------------------------------------------------------
const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const auth = require('../../core/auth');
const theme = require('../../core/theme');
const D = require('../../utils/dashboard');

const MAX_BAR_RPX = 220;        // 柱状图最高柱子（rpx）
const MAX_SCALE_MIN = 12 * 60;  // 刻度下限 12 小时，避免单条记录把柱子撑满

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

  onLoad() {
    theme.bind(this);
  },
  onUnload() {
    theme.unbind(this);
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
    const days = D.lastNDays(range);
    const s = D.summarize(logs, checkins, days);

    // 柱状图：同一日期多条取均值（与 summarize 的口径一致）
    const daySet = {};
    days.forEach((d) => { daySet[d] = { sum: 0, count: 0 }; });
    (logs || []).forEach((r) => {
      const d = String(r.sleep_date || '').slice(0, 10);
      if (!daySet[d]) return;
      daySet[d].count += 1;
      daySet[d].sum += Number(r.duration_min) || 0;
    });

    let maxMinutes = MAX_SCALE_MIN;
    days.forEach((d) => {
      const item = daySet[d];
      if (!item.count) return;
      const m = Math.round(item.sum / item.count);
      if (m > maxMinutes) maxMinutes = m;
    });

    const lang = i18n.getLang();
    const bars = days.map((d, i) => {
      const item = daySet[d];
      const mins = item.count ? Math.round(item.sum / item.count) : 0;
      const height = mins > 0
        ? Math.max(8, Math.round((mins / maxMinutes) * MAX_BAR_RPX))
        : 4;
      return {
        date: d,
        // 字号提升到 22rpx 后，30 天视图需要更稀疏的标签避免重叠
        label: (range === 7 || i % 7 === 0 || i === days.length - 1)
          ? d.slice(5).replace('-', '/')
          : '',
        minutes: mins,
        hasData: item.count > 0,
        barHeight: height,
      };
    });

    this.setData({
      status: s.recordDays ? 'ready' : 'empty',
      isGuest,
      avgDuration: s.avgDuration ? D.formatDuration(s.avgDuration, lang) : '--',
      avgQuality: s.avgQuality,
      recordDays: s.recordDays,
      coverage: s.coverage,
      streak: s.streak,
      bars,
      maxLabel: D.formatDuration(maxMinutes, lang),
    });
  },

  retry() { this.load(); },
  goLog() { wx.navigateBack(); },
});
