const llm = require('../../utils/llm');
const auth = require('../../core/auth');
const i18n = require('../../core/i18n');
const theme = require('../../core/theme');

const HISTORY_KEY_PREFIX = 'sn_chat_history_';

// 本地第一层输入审核（基础词表）。生产环境应替换为云端内容安全：
// 微信 msgSecCheck / 腾讯云 TMS —— 前端无法安全持有内容安全密钥，需在云端完成双向审核。
const BLOCK_WORDS = ['示例违禁词'];
function moderateInput(text) {
  const s = (text || '').toLowerCase();
  for (const w of BLOCK_WORDS) {
    if (w && s.indexOf(w.toLowerCase()) !== -1) return { blocked: true };
  }
  return { blocked: false };
}

Page({
  data: {
    t: {},
    messages: [],
    inputText: '',
    isGenerating: false,
    models: [],
    model: '',
    modelName: '',
    showModelSheet: false,
    empty: true,
    error: '',
    errorText: '',
    identityMode: 'guest',
    scrollToId: '',
    retryUser: '',
  },

  onLoad() {
    theme.bind(this);
    const identity = auth.getIdentity();
    this._lang = i18n.getLang();
    this.setData({
      t: i18n.all(),
      identityMode: identity.mode,
    });
    this.loadModels();
    this.loadHistory(identity);
  },

  onUnload() {
    theme.unbind(this);
  },

  onShow() {
    if (i18n.getLang() !== this._lang) {
      this._lang = i18n.getLang();
      this.setData({ t: i18n.all() });
    }
    const identity = auth.getIdentity();
    if (identity.mode !== this.data.identityMode) {
      this.setData({ identityMode: identity.mode });
      this.loadHistory(identity);
    }
  },

  async loadModels() {
    const models = await llm.listModels();
    if (models.length) {
      const m = models[0];
      this.setData({ models, model: m.id, modelName: m.name || m.id });
    } else {
      this.setData({ error: 'generic', errorText: i18n.t('chat.noModel') });
    }
  },

  loadHistory(identity) {
    const key = HISTORY_KEY_PREFIX + identity.uid;
    const history = wx.getStorageSync(key) || [];
    this.setData({ messages: history, empty: history.length === 0, scrollToId: '' });
  },

  saveHistory() {
    const identity = auth.getIdentity();
    const key = HISTORY_KEY_PREFIX + identity.uid;
    wx.setStorageSync(key, this.data.messages);
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async onSend() {
    const text = (this.data.inputText || '').trim();
    if (!text || this.data.isGenerating) return;
    if (!this.data.model) {
      wx.showToast({ title: i18n.t('chat.noModel'), icon: 'none' });
      return;
    }
    const mod = moderateInput(text);
    if (mod.blocked) {
      wx.showToast({ title: i18n.t('chat.blocked'), icon: 'none' });
      return;
    }

    // 模型上下文：先取“加入当前轮之前”的历史（不含本次 user 与末尾空 assistant）
    const history = this.data.messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg = { role: 'user', content: text };
    const assistantMsg = { role: 'assistant', content: '' };
    const messages = this.data.messages.concat([userMsg, assistantMsg]);
    this.setData({
      messages,
      inputText: '',
      isGenerating: true,
      empty: false,
      error: '',
      errorText: '',
      scrollToId: 'msg-' + (messages.length - 1),
      retryUser: text,
    });

    const controller = new AbortController();
    this._controller = controller;
    let acc = '';
    try {
      await llm.streamChat({
        model: this.data.model,
        history,
        userContent: text,
        signal: controller.signal,
        onDelta: (piece) => {
          acc += piece;
          assistantMsg.content = acc;
          this.setData({ messages, scrollToId: 'msg-' + (messages.length - 1) });
        },
        onDone: () => {
          if (!acc) {
            this.setData({ error: 'generic', errorText: i18n.t('chat.errorGeneric') });
          }
        },
        onError: (err) => this.handleError(err),
      });
    } catch (err) {
      this.handleError(err);
    } finally {
      this.setData({ isGenerating: false });
      this.saveHistory();
    }
  },

  handleError(err) {
    const code = (err && err.error && err.error.code) || '';
    let kind = 'generic';
    if (code.startsWith('quota_')) kind = 'quota';
    else if (code.startsWith('auth_') || code.startsWith('gateway_') || code.startsWith('model_') || code.startsWith('internal_')) kind = 'network';
    const map = { quota: 'chat.errorQuota', network: 'chat.errorNetwork', generic: 'chat.errorGeneric' };
    this.setData({ error: kind, errorText: i18n.t(map[kind]) });
  },

  onStop() {
    if (this._controller) this._controller.abort();
  },

  onRetry() {
    if (this.data.isGenerating) return;
    this.setData({ inputText: this.data.retryUser || '', error: '', errorText: '' });
    if (this.data.inputText) this.onSend();
  },

  onClear() {
    wx.showModal({
      title: i18n.t('chat.newChat'),
      content: i18n.t('chat.clearConfirm'),
      success: (r) => {
        if (r.confirm) {
          this.setData({ messages: [], empty: true, error: '', errorText: '', scrollToId: '' });
          this.saveHistory();
        }
      },
    });
  },

  onPickModel() {
    if (this.data.isGenerating) return;
    if (!this.data.models.length) {
      this.loadModels();
      return;
    }
    this.setData({ showModelSheet: true });
  },

  onSelectModel(e) {
    const id = e.currentTarget.dataset.id;
    const m = this.data.models.find((x) => x.id === id);
    this.setData({ model: id, modelName: m ? (m.name || m.id) : id, showModelSheet: false });
  },

  onCloseSheet() {
    this.setData({ showModelSheet: false });
  },

  onGoLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  noop() {},
});
