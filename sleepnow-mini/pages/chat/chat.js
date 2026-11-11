// 陪伴页 v2 · 睡前陪伴中心
// 修复：旧版用 i18n.all() 注入带点 key 的字典，而 wxml 使用 {{t.chatTitle}} 驼峰别名，
//       导致整页文案全部为 undefined（截图里只剩模型名和一个空黑圆圈）。
//       现改为与 home / sleep-log / settings 一致的 TEXT_KEYS + buildTexts()。
const llm = require('../../utils/llm');
const moderation = require('../../utils/moderation');
const S = require('../../utils/chat-session');
const auth = require('../../core/auth');
const i18n = require('../../core/i18n');
const theme = require('../../core/theme');
const speech = require('../../utils/speech');

// 驼峰别名 → 词条 key（wxml 统一用 {{t.xxx}}）
const TEXT_KEYS = {
  subtitle: 'chat.subtitle', aiBadge: 'chat.aiBadge',
  aiGenerated: 'chat.aiGenerated', disclaimer: 'chat.disclaimer',
  disclaimerShort: 'chat.disclaimerShort',
  sceneTitle: 'chat.sceneTitle', sceneHint: 'chat.sceneHint',
  sceneNow: 'chat.sceneNow', switch: 'chat.switch',
  quickTitle: 'chat.quickTitle', quota: 'chat.quota',
  quotaUnit: 'chat.quotaUnit', quotaLeft: 'chat.quotaLeft',
  quotaReached: 'chat.quotaReached',
  modelLabel: 'chat.modelLabel', modelAuto: 'chat.modelAuto',
  modelHint: 'chat.modelHint', chooseModel: 'chat.chooseModel',
  cancel: 'chat.cancel', noModel: 'chat.noModel',
  thinking: 'chat.thinking', you: 'chat.you', assistant: 'chat.assistant',
  composerHint: 'chat.composerHint', send: 'chat.send', stop: 'chat.stop',
  clear: 'chat.clear', newChat: 'chat.newChat',
  clearConfirm: 'chat.clearConfirm', retry: 'chat.retry',
  loginHint: 'chat.loginHint', goLogin: 'chat.goLogin',
  blocked: 'chat.blocked', inputBlocked: 'chat.inputBlocked',
  outputBlocked: 'chat.outputBlocked',
  timeout: 'chat.timeout', sceneSwitched: 'chat.sceneSwitched',
  sceneLocked: 'chat.sceneLocked', safetyDev: 'chat.safetyDev',
  errorQuota: 'chat.errorQuota', errorNetwork: 'chat.errorNetwork',
  errorGeneric: 'chat.errorGeneric',
  // 语音输入：只把声音变成输入框里的文字，不自动发送
  voiceStart: 'chat.voiceStart', voiceListening: 'chat.voiceListening',
  voiceRecognizing: 'chat.voiceRecognizing', voiceStopHint: 'chat.voiceStopHint',
  voiceKeyboard: 'chat.voiceKeyboard', voiceAuth: 'chat.voiceAuth',
  voiceOpen: 'chat.voiceOpen', voiceEmpty: 'chat.voiceEmpty',
  voiceFail: 'chat.voiceFail', voiceDone: 'chat.voiceDone',
};

const SCENE_META = [
  { id: 'chat', no: '01', titleKey: 'chat.scene.chat', descKey: 'chat.scene.chatDesc' },
  { id: 'breathe', no: '02', titleKey: 'chat.scene.breathe', descKey: 'chat.scene.breatheDesc' },
  { id: 'body', no: '03', titleKey: 'chat.scene.body', descKey: 'chat.scene.bodyDesc' },
  { id: 'story', no: '04', titleKey: 'chat.scene.story', descKey: 'chat.scene.storyDesc' },
];

const STREAM_TIMEOUT_MS = 60000;

Page({
  data: {
    t: {},
    identityMode: 'guest',
    scenes: [],
    scene: 'chat',
    sceneName: '',
    quick: [],
    messages: [],
    empty: true,
    scrollToId: '',
    models: [],
    model: '',
    modelName: '',
    showModelSheet: false,
    isGenerating: false,
    inputText: '',
    inputLen: 0,
    inputFocus: false,
    voiceState: 'idle',
    voiceTip: '',
    voiceSeconds: 0,
    voiceMode: 'keyboard',
    error: '',
    errorText: '',
    retryUser: '',
    quota: { used: 0, limit: S.DAILY_QUOTA, left: S.DAILY_QUOTA, canSend: true },
    safetyMode: moderation.getMode(),
  },

  onLoad() {
    theme.bind(this);
    this._lang = i18n.getLang();
    this._stopped = false;
    this._timedOut = false;
    this._timer = null;
    this._streamError = null;
    this._voiceBase = '';
    this._voiceTimer = null;
    this._longPress = false;
    this._lastLongPressAt = 0;
    const voiceMode = speech.configure({
      onStateChange: (st, mode) => this.onVoiceState(st, mode),
      onPartial: (text) => this.onVoicePartial(text),
      onResult: (text) => this.onVoiceResult(text),
      onError: (reason) => this.onVoiceError(reason),
    });
    this.setData({ t: this.buildTexts(), voiceMode });
    this.buildScenes();
    this.loadModels();
  },

  onUnload() {
    theme.unbind(this);
    this.clearTimer();
    this.stopVoiceTimer();
    speech.cancel();
    this._stopped = true;
    try { if (this._controller) this._controller.abort(); } catch (e) {}
  },

  onShow() {
    const lang = i18n.getLang();
    if (lang !== this._lang) {
      this._lang = lang;
      this.setData({ t: this.buildTexts() });
      this.buildScenes();
    }
    wx.setNavigationBarTitle({ title: i18n.t('chat.title') });
    const identity = auth.getIdentity();
    this.setData({ identityMode: identity.mode, safetyMode: moderation.getMode() });
    if (!this.data.isGenerating) {
      this.loadHistory();
      this.loadQuota();
    }
  },

  buildTexts() {
    const t = {};
    Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
    return t;
  },

  buildScenes() {
    const t = this.data.t;
    const scenes = SCENE_META.map((s) => ({
      id: s.id,
      no: s.no,
      title: i18n.t(s.titleKey),
      desc: i18n.t(s.descKey),
      opening: i18n.t('chat.open.' + s.id),
      active: s.id === this.data.scene,
    }));
    const quick = ['chat.quick1', 'chat.quick2', 'chat.quick3', 'chat.quick4']
      .map((k, idx) => ({ id: 'q' + idx, text: i18n.t(k) }));
    const current = scenes.find((s) => s.id === this.data.scene);
    this.setData({ scenes, quick, sceneName: current ? current.title : (t && t.sceneNow) || '' });
  },

  async loadModels() {
    const models = await llm.listModels();
    if (models.length) {
      const picked = models[0];
      this.setData({ models, model: picked.id, modelName: picked.name });
    } else {
      this.setData({ modelName: i18n.t('chat.modelAuto'), error: 'generic', errorText: i18n.t('chat.noModel') });
    }
  },

  // ---------- 存储：按「身份 + 场景 + 日期」隔离 ----------
  loadHistory() {
    const identity = auth.getIdentity();
    const key = S.historyKey(identity.uid, this.data.scene);
    let list = [];
    try { list = wx.getStorageSync(key) || []; } catch (e) { list = []; }
    const messages = S.trimMessages(list);
    this.setData({
      messages,
      empty: messages.length === 0,
      scrollToId: messages.length ? 'msg-' + (messages.length - 1) : '',
    });
  },

  saveHistory() {
    const identity = auth.getIdentity();
    const key = S.historyKey(identity.uid, this.data.scene);
    // 落盘时丢掉未完成的空 assistant，避免下次进入出现空气泡
    const list = S.trimMessages(this.data.messages.filter((m) => m && m.content));
    try { wx.setStorageSync(key, list); } catch (e) {}
  },

  loadQuota() {
    const identity = auth.getIdentity();
    let used = 0;
    try { used = wx.getStorageSync(S.quotaKey(identity.uid)) || 0; } catch (e) { used = 0; }
    this.setData({ quota: S.quotaState(used) });
  },

  bumpQuota() {
    const identity = auth.getIdentity();
    const used = (this.data.quota.used || 0) + 1;
    try { wx.setStorageSync(S.quotaKey(identity.uid), used); } catch (e) {}
    this.setData({ quota: S.quotaState(used) });
  },

  // ---------- 交互 ----------
  onInput(e) {
    const v = e.detail.value || '';
    this.setData({ inputText: v, inputLen: v.length });
  },

  onInputBlur() { this.setData({ inputFocus: false }); },

  // ---------- 语音输入：轻点开始 / 再点结束；按住说话 / 松手结束 ----------
  onVoiceTap() {
    // 长按松手后微信可能补发一次 tap，400ms 内忽略，避免刚结束又重新开始
    if (Date.now() - (this._lastLongPressAt || 0) < 400) return;
    if (this.data.isGenerating) return;
    if (speech.isRecording()) return this.stopVoice();
    return this.startVoice();
  },

  onVoiceLongPress() {
    if (this.data.isGenerating || speech.isRecording()) return null;
    this._longPress = true;
    return this.startVoice();
  },

  onVoiceTouchEnd() {
    if (!this._longPress) return;
    this._longPress = false;
    this._lastLongPressAt = Date.now();
    if (speech.isRecording()) this.stopVoice();
  },

  onVoiceCancel() {
    this._longPress = false;
    speech.cancel();
    this.onVoiceState('idle', null);
  },

  async startVoice() {
    if (this.data.voiceState !== 'idle' || this.data.isGenerating) return;
    this._voiceBase = this.data.inputText || '';
    const r = await speech.start({ lang: i18n.getLang(), baseText: this._voiceBase });
    if (r.ok) return;
    // 个人主体默认降级：调起单行输入框，用系统键盘 / 微信键盘的麦克风说话
    if (r.mode === 'keyboard' || r.reason === 'start-failed' || r.reason === 'recognize-failed') {
      this.setData({ inputFocus: true });
      wx.showToast({ title: i18n.t('chat.voiceKeyboard'), icon: 'none' });
      return;
    }
    if (r.reason === 'auth-denied') return this.showVoiceAuth(r.needSetting);
    wx.showToast({ title: i18n.t('chat.voiceFail'), icon: 'none' });
  },

  stopVoice() { return speech.stop(); },

  showVoiceAuth(needSetting) {
    const content = i18n.t('chat.voiceAuth');
    if (!needSetting || typeof wx.showModal !== 'function') {
      wx.showToast({ title: content, icon: 'none' });
      return;
    }
    wx.showModal({
      title: i18n.t('chat.voiceStart'),
      content,
      confirmText: i18n.t('chat.voiceOpen'),
      success: (r) => { if (r.confirm && typeof wx.openSetting === 'function') wx.openSetting({}); },
    });
  },

  onVoiceState(st, mode) {
    const t = this.data.t || {};
    const tip = st === 'recording' ? t.voiceListening
      : (st === 'recognizing' ? t.voiceRecognizing : '');
    this.setData({ voiceState: st, voiceTip: tip, voiceMode: mode || this.data.voiceMode });
    if (st === 'recording') {
      this.setData({ voiceSeconds: 0 });
      this.startVoiceTimer();
    } else {
      this.stopVoiceTimer();
    }
  },

  startVoiceTimer() {
    this.stopVoiceTimer();
    this._voiceTimer = setInterval(() => {
      if (this.data.voiceState !== 'recording') return this.stopVoiceTimer();
      this.setData({ voiceSeconds: this.data.voiceSeconds + 1 });
    }, 1000);
  },

  stopVoiceTimer() {
    if (this._voiceTimer) { clearInterval(this._voiceTimer); this._voiceTimer = null; }
  },

  // 实时识别（插件模式）：追加到录音前已有的文字后，用户可随时编辑
  onVoicePartial(text) {
    const v = speech.mergeText(this._voiceBase, text).slice(0, 500);
    this.setData({ inputText: v, inputLen: v.length });
  },

  // 最终结果：只填入输入框，绝不自动发送 —— 发送前仍走 checkInput 审核
  onVoiceResult(text) {
    const v = speech.mergeText(this._voiceBase, text).slice(0, 500);
    this.setData({ inputText: v, inputLen: v.length });
    wx.showToast({ title: this.data.t.voiceDone, icon: 'none' });
  },

  onVoiceError(reason) {
    const map = {
      empty: 'chat.voiceEmpty',
      'auth-denied': 'chat.voiceAuth',
      'record-failed': 'chat.voiceFail',
      'recognize-failed': 'chat.voiceFail',
      'stop-failed': 'chat.voiceFail',
      'plugin-error': 'chat.voiceFail',
    };
    wx.showToast({ title: i18n.t(map[reason] || 'chat.voiceFail'), icon: 'none' });
  },

  onPickScene(e) {
    if (this.data.isGenerating) {
      wx.showToast({ title: i18n.t('chat.sceneLocked'), icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    if (llm.SCENE_IDS.indexOf(id) === -1 || id === this.data.scene) return;
    const scenes = this.data.scenes.map((s) => Object.assign({}, s, { active: s.id === id }));
    const current = scenes.find((s) => s.id === id);
    this.setData({ scene: id, scenes, sceneName: current ? current.title : '', error: '', errorText: '' });
    this.loadHistory();
    wx.showToast({ title: i18n.t('chat.sceneSwitched'), icon: 'none' });
    // 点场景即自动开启：用预设首句（非生成内容）作为第一条消息，用户无需再想要说什么
    if (this.data.empty && current && current.opening) {
      this.send(current.opening);
    }
  },

  onQuick(e) {
    const text = e.currentTarget.dataset.text;
    if (text) this.send(text);
  },

  onSend() {
    // 录音中点发送：结束录音，把已转出的文字当作普通输入发送
    if (this.data.voiceState !== 'idle') {
      speech.cancel();
      this.onVoiceState('idle', null);
    }
    const text = (this.data.inputText || '').trim();
    if (text) this.send(text);
  },

  async send(text) {
    if (this.data.isGenerating) return;
    if (!this.data.quota.canSend) {
      wx.showToast({ title: i18n.t('chat.quotaReached'), icon: 'none' });
      return;
    }
    if (!this.data.model) {
      await this.loadModels();
      if (!this.data.model) {
        wx.showToast({ title: i18n.t('chat.noModel'), icon: 'none' });
        return;
      }
    }

    // 1) 输入侧内容安全（本地粗筛 / 云端 msgSecCheck 由 configureCloudCheck 注入）
    const identity = auth.getIdentity();
    const checked = await moderation.checkInput(text, {
      openid: identity.uid || '', scene: this.data.scene,
    });
    if (!checked.pass) {
      wx.showToast({ title: i18n.t('chat.inputBlocked'), icon: 'none' });
      return;
    }

    // 2) 模型上下文 = 加入本轮之前的历史（纯函数裁剪，按场景隔离）
    const history = S.contextOf(this.data.messages);
    const now = S.timeLabel();
    const userMsg = { role: 'user', content: text, time: now };
    const assistantMsg = { role: 'assistant', content: '', time: now, pending: true };
    const messages = this.data.messages.concat([userMsg, assistantMsg]);

    this._stopped = false;
    this._timedOut = false;
    this._streamError = null;
    this.setData({
      messages, empty: false, inputText: '', inputLen: 0, inputFocus: false,
      isGenerating: true, error: '', errorText: '',
      scrollToId: 'msg-' + (messages.length - 1),
      retryUser: text,
    });

    // 3) 流式生成（中止不依赖 AbortController：shouldStop + signal 双保险）
    let controller = null;
    try {
      if (typeof AbortController !== 'undefined') controller = new AbortController();
    } catch (e) { controller = null; }
    this._controller = controller;
    this.startTimeout();

    let acc = '';
    await llm.streamChat({
      model: this.data.model,
      scene: this.data.scene,
      history,
      userContent: text,
      lang: i18n.getLang(),
      signal: controller ? controller.signal : undefined,
      shouldStop: () => this._stopped,
      onDelta: (piece) => {
        acc += piece;
        assistantMsg.content = acc;
        assistantMsg.pending = false;
        this.setData({ messages, scrollToId: 'msg-' + (messages.length - 1) });
      },
      onError: (err) => { this._streamError = err; },
    });

    if (this._streamError) this.handleError(this._streamError);
    else await this.postProcess(acc, assistantMsg, messages, identity);

    this.clearTimer();
    this.setData({ isGenerating: false });
    this.saveHistory();
  },

  // 生成结束后的收尾：超时 / 主动中止 / 空回复 / 输出侧审核 / 计次
  async postProcess(acc, assistantMsg, messages, identity) {
    if (this._timedOut) {
      if (!acc) this.removeTrailingEmpty(messages);
      this.setData({ messages, error: 'network', errorText: i18n.t('chat.timeout') });
      return;
    }
    if (this._stopped) {
      if (!acc) this.removeTrailingEmpty(messages);
      this.setData({ messages });
      return;
    }
    if (!acc) {
      this.removeTrailingEmpty(messages);
      this.setData({ messages, error: 'generic', errorText: i18n.t('chat.errorGeneric') });
      return;
    }
    // 输出侧审核：说明见《AI 接入实操方案》，生产建议改服务端分片审核
    const out = await moderation.checkOutput(acc, {
      openid: identity.uid || '', scene: this.data.scene,
    });
    if (!out.pass) {
      assistantMsg.content = i18n.t('chat.outputBlocked');
      assistantMsg.blocked = true;
    } else {
      assistantMsg.pending = false;
      assistantMsg.ai = true;
    }
    this.setData({ messages });
    this.bumpQuota();
  },

  removeTrailingEmpty(messages) {
    if (messages.length && messages[messages.length - 1].role === 'assistant'
      && !messages[messages.length - 1].content) messages.pop();
  },

  startTimeout() {
    this.clearTimer();
    this._timer = setTimeout(() => {
      if (!this.data.isGenerating) return;
      this._timedOut = true;
      this._stopped = true;
      try { if (this._controller) this._controller.abort(); } catch (e) {}
    }, STREAM_TIMEOUT_MS);
  },

  clearTimer() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },

  handleError(err) {
    const kind = llm.classifyError(err);
    if (kind === 'aborted') return;
    const map = {
      quota: 'chat.errorQuota',
      network: 'chat.errorNetwork',
      generic: 'chat.errorGeneric',
    };
    this.setData({ error: kind, errorText: i18n.t(map[kind]) });
  },

  onStop() {
    this._stopped = true;
    try { if (this._controller) this._controller.abort(); } catch (e) {}
  },

  onRetry() {
    if (this.data.isGenerating) return;
    const text = this.data.retryUser || '';
    // 重试前清掉上一轮残留的空 assistant，避免重复气泡
    const messages = S.trimMessages(this.data.messages.filter((m) => m && m.content));
    this.setData({ messages, error: '', errorText: '' });
    if (text) this.send(text);
  },

  onClear() {
    wx.showModal({
      title: i18n.t('chat.newChat'),
      content: i18n.t('chat.clearConfirm'),
      success: (r) => {
        if (!r.confirm) return;
        speech.cancel();
        this.stopVoiceTimer();
        this.setData({
          messages: [], empty: true, error: '', errorText: '', scrollToId: '',
          voiceState: 'idle', voiceTip: '',
        });
        this.saveHistory();
      },
    });
  },

  onPickModel() {
    if (this.data.isGenerating) return;
    if (!this.data.models.length) { this.loadModels(); return; }
    this.setData({ showModelSheet: true });
  },

  onSelectModel(e) {
    const id = e.currentTarget.dataset.id;
    const m = this.data.models.find((x) => x.id === id);
    this.setData({ model: id, modelName: m ? m.name : id, showModelSheet: false });
  },

  onCloseSheet() { this.setData({ showModelSheet: false }); },
  onGoLogin() { wx.navigateTo({ url: '/pages/login/login' }); },
  noop() {},
});
