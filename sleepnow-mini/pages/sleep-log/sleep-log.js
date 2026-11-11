const { cloud } = require('../../utils/cloud');
const i18n = require('../../core/i18n');
const auth = require('../../core/auth');

function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function calcDuration(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60; // 跨午夜顺延到次日
  return mins;
}

Page({
  data: {
    title: '', addText: '', logEmpty: '', dateLabel: '', bedtimeLabel: '',
    wakeLabel: '', ratingLabel: '', noteLabel: '',
    saveText: '', cancelText: '',
    status: 'loading', logs: [], errorMsg: '', isGuest: false,
    formVisible: false,
    sleepDate: todayStr(), bedTime: '', wakeTime: '', quality: 3, note: '',
  },
  onShow() {
    this.setData({
      title: i18n.t('log.title'),
      addText: i18n.t('log.add'),
      logEmpty: i18n.t('log.empty'),
      dateLabel: i18n.t('log.date'),
      bedtimeLabel: i18n.t('log.bedtime'),
      wakeLabel: i18n.t('log.wake'),
      ratingLabel: i18n.t('log.rating'),
      noteLabel: i18n.t('log.note'),
      saveText: i18n.t('log.save'),
      cancelText: i18n.t('log.cancel'),
      sleepDate: todayStr(),
    });
    this.loadLogs();
  },
  async loadLogs() {
    this.setData({ status: 'loading' });
    await auth.getSessionSafe();
    const id = auth.getIdentity();
    let logs = [];
    if (id.mode === 'user') {
      const { data, error } = await cloud.database
        .from('sleep_logs')
        .select('id, sleep_date, bed_time, wake_time, quality, duration_min, note, created_at')
        .order('sleep_date', { ascending: false })
        .limit(30);
      if (error) {
        this.setData({ status: 'error', errorMsg: error.message || '加载失败' });
        return;
      }
      logs = (data || []).map((r) => ({
        id: r.id,
        date: r.sleep_date,
        time: [r.bed_time, r.wake_time].filter(Boolean).join(' → '),
        quality: r.quality,
        duration: r.duration_min,
      }));
    } else {
      logs = auth.getGuestSleepLogs().map((r, i) => ({
        id: 'g' + i,
        date: r.sleep_date,
        time: [r.bed_time, r.wake_time].filter(Boolean).join(' → '),
        quality: r.quality,
        duration: r.duration_min,
      }));
    }
    this.setData({ status: logs.length ? 'ready' : 'empty', logs, isGuest: id.mode === 'guest' });
  },
  retry() { this.loadLogs(); },
  openForm() { this.setData({ formVisible: true }); },
  closeForm() { this.setData({ formVisible: false }); },
  onDate(e) { this.setData({ sleepDate: e.detail.value }); },
  onBedTime(e) { this.setData({ bedTime: e.detail.value }); },
  onWakeTime(e) { this.setData({ wakeTime: e.detail.value }); },
  onQuality(e) { this.setData({ quality: Number(e.currentTarget.dataset.value) }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  async save() {
    const { sleepDate, bedTime, wakeTime, quality, note } = this.data;
    if (!sleepDate || !bedTime || !wakeTime) {
      wx.showToast({ title: '请填写日期、入睡与起床时间', icon: 'none' });
      return;
    }
    const record = {
      sleep_date: sleepDate,
      bed_time: bedTime,
      wake_time: wakeTime,
      quality: quality,
      duration_min: calcDuration(bedTime, wakeTime),
      note: note || null,
    };
    const id = auth.getIdentity();
    wx.showLoading({ title: '保存中' });
    if (id.mode === 'user') {
      const { error } = await cloud.database.from('sleep_logs').insert({
        ...record,
        source: 'manual',
        owner_name: id.user && id.user.name ? id.user.name : null,
      });
      wx.hideLoading();
      if (error) {
        wx.showToast({ title: '保存失败', icon: 'none' });
        return;
      }
    } else {
      auth.addGuestSleepLog(record);
      wx.hideLoading();
    }
    this.setData({ formVisible: false, bedTime: '', wakeTime: '', quality: 3, note: '' });
    this.loadLogs();
  },
});
