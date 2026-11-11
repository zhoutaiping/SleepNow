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

// 返回当前语言全部词条，供页面 setData 后直接在 wxml 用 {{t.xxx}}
function all() {
  return LANGS[currentLang] || zh;
}

module.exports = { getLang, setLang, initI18n, t, all, LANGS };
