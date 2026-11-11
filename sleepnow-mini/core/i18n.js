// 轻量 i18n：词条来自 ../i18n/zh-CN.js 与 ../i18n/en-US.js
const zh = require('../i18n/zh-CN');
const en = require('../i18n/en-US');

const LANGS = { 'zh-CN': zh, 'en-US': en };
let currentLang = 'zh-CN';

function getLang() {
  return currentLang;
}

function setLang(lang) {
  if (!LANGS[lang]) return;
  currentLang = lang;
  try { wx.setStorageSync('wb_lang', lang); } catch (e) {}
  applySystemLocale();
}

function initI18n() {
  try {
    const saved = wx.getStorageSync('wb_lang');
    if (saved && LANGS[saved]) currentLang = saved;
  } catch (e) {}
  applySystemLocale();
}

// 让微信原生导航栏/时间选择器跟随语言
function applySystemLocale() {
  try {
    wx.setLocale ? wx.setLocale(currentLang) : null;
  } catch (e) {}
}

function t(key) {
  const dict = LANGS[currentLang] || zh;
  return dict[key] !== undefined ? dict[key] : key;
}

// 返回当前语言全部词条（key 带点，如 'chat.title'）。
// ⚠️ 不要把它直接 setData 成 t 后在 wxml 写 {{t.chatTitle}}：
//    带点 key 无法用点号访问，会让整页文案变 undefined（陪伴页 v1 的真实 bug）。
//    页面统一用 TEXT_KEYS + i18n.t() 生成驼峰别名对象，见 design-system/MASTER.md §8.2。
function all() {
  return LANGS[currentLang] || zh;
}

module.exports = { getLang, setLang, initI18n, t, all, LANGS };
