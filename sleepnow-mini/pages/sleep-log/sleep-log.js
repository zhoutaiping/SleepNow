// 睡眠记录页 · 周视图 + 概览 + 活动列表
// 修复旧布局：标题被两个按钮挤到换行、空态只有一个大按钮、下半屏全白
const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const auth = require('../../core/auth');
const theme = require('../../core/theme');
const D = require('../../utils/dashboard');

const MAX_SLEEP_MINUTES = 16 * 60; // 生理合理上限；超过视为输入错误（BUG B07）

const TEXT_KEYS = {
  title: 'log.title', subtitle: 'log.subtitle', week: 'log.week',
  avg: 'log.avg', days: 'log.days', coverage: 'log.coverage',
  all: 'log.all', add: 'log.add', addDesc: 'log.addDesc',
  stats: 'log.stats', statsDesc: 'log.statsDesc',
  empty: 'log.empty', firstTitle: 'log.firstTitle', firstHint: 'log.firstHint',
  goLog: 'home.goLog', viewAll: 'home.viewAll', guestHint: 'stats.guestHint',
  date: 'log.date', bedtime: 'log.bedtime', wake: 'log.wake',
  rating: 'log.rating', note: 'log.note', save: 'log.save', saving: 'log.saving', cancel: 'log.cancel',
  loading: 'common.loading', retry: 'common.retry',
};

function todayStr() { return D.dateStr(new Date()); }

function calcDuration(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  if (![bh, bm, wh, wm].every(Number.isFinite)) return null;
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60; // 跨午夜顺延到次日
  // bed==wake 会得到 1440 分钟（24h），旧实现会让 Hero 显示 300% 达成
  if (mins <= 0 || mins > MAX_SLEEP_MINUTES) return null;
  return mins;
}

Page({
  data: {
    t: {},
    status: 'loading', logs: [], total: 0, errorMsg: '', isGuest: false,
    week: [], overview: { avg: '--', days: '0/7', coverage: '0%' },
    formVisible: false,
    saving: false,
    sleepDate: todayStr(), bedTime: '', wakeTime: '', quality: 3, note: '',
  },

  onLoad() {
    theme.bind(this);
    this._dates = {}; // 已记录日期集合，供保存时做同日去重（BUG B08）
  },
  onUnload() {
    theme.unbind(this);
  },

  onShow() {
    this.setData({ t: this.buildTexts(), sleepDate: todayStr() });
    this.loadLogs();
  },

  buildTexts() {
    const t = {};
    Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
    return t;
  },

  async loadLogs() {
    this.setData({ status: 'loading' });
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    let raw = [];

    if (id.mode === 'user') {
      const { data, error } = await cloud.database.from('sleep_logs')
        .select('id, sleep_date, bed_time, wake_time, quality, duration_min, note, created_at')
        .order('sleep_date', { ascending: false })
        .limit(90);
      if (error) {
        this.setData({ status: 'error', errorMsg: error.message || i18n.t('stats.error') });
        return;
      }
      raw = data || [];
    } else {
      raw = auth.getGuestSleepLogs();
    }
    this.render(raw, id.mode === 'guest');
  },

  render(raw, isGuest) {
    const lang = i18n.getLang();
    const days = D.lastNDays(7);
    const s = D.summarize(raw, [], days);
    this._dates = {};
    (raw || []).forEach((r) => {
      const d = String(r.sleep_date || '').slice(0, 10);
      if (d) this._dates[d] = true;
    });
    this.setData({
      status: raw.length ? 'ready' : 'empty',
      logs: D.recentLogs(raw, 30, lang),
      total: raw.length,
      week: D.buildWeekStrip(days, {
        logDates: s.logDates,
        today: days[days.length - 1],
        lang,
      }),
      overview: {
        avg: s.avgDuration ? D.shortDuration(s.avgDuration) : '--',
        days: `${s.recordDays}/${days.length}`,
        coverage: `${s.coverage}%`,
      },
      isGuest,
    });
  },

  retry() { this.loadLogs(); },
  goStats() { wx.navigateTo({ url: '/pages/stats/stats' }); },
  openForm() { this.setData({ formVisible: true }); },
  closeForm() { this.setData({ formVisible: false }); },
  onDate(e) { this.setData({ sleepDate: e.detail.value }); },
  onBedTime(e) { this.setData({ bedTime: e.detail.value }); },
  onWakeTime(e) { this.setData({ wakeTime: e.detail.value }); },
  onQuality(e) { this.setData({ quality: Number(e.currentTarget.dataset.value) }); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  async save() {
    // BUG B08：连点两次保存会写入同日两条；期间一律锁定按钮
    if (this.data.saving) return;
    const { sleepDate, bedTime, wakeTime, quality, note } = this.data;
    if (!sleepDate || !bedTime || !wakeTime) {
      wx.showToast({ title: i18n.t('log.required'), icon: 'none' });
      return;
    }
    const durationMin = calcDuration(bedTime, wakeTime);
    if (!durationMin) {
      wx.showToast({ title: i18n.t('log.durationInvalid'), icon: 'none' });
      return;
    }
    if (this._dates && this._dates[sleepDate]) {
      wx.showToast({ title: i18n.t('log.duplicate'), icon: 'none' });
      return;
    }
    const record = {
      sleep_date: sleepDate,
      bed_time: bedTime,
      wake_time: wakeTime,
      quality,
      duration_min: durationMin,
      note: note || null,
    };
    const id = auth.getIdentity();
    this.setData({ saving: true });
    wx.showLoading({ title: i18n.t('common.loading') });
    try {
      if (id.mode === 'user') {
        const { error } = await cloud.database.from('sleep_logs').insert({
          ...record,
          source: 'manual',
          owner_name: id.user && id.user.name ? id.user.name : null,
        });
        if (error) {
          wx.showToast({ title: i18n.t('log.saveFail'), icon: 'none' });
          return;
        }
      } else {
        auth.addGuestSleepLog(record);
      }
      this.setData({ formVisible: false, bedTime: '', wakeTime: '', quality: 3, note: '' });
      this.loadLogs();
    } catch (e) {
      wx.showToast({ title: i18n.t('log.saveFail'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },
});
