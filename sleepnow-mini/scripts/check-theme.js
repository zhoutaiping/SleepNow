#!/usr/bin/env node
/**
 * 晚安开关 · 黑白主题规范自检
 * 用法：node scripts/check-theme.js
 *
 * 覆盖：页面四件套 / 主题链路 / i18n 对齐 / token 定义与引用 /
 *       primary-on-primary 配对 / 硬编码色值 / 原生控件灰阶 / 三态切换逻辑
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let problems = 0;
const bad = (m) => { problems++; console.log('  ❌ ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

// 纯图形元素：用 --primary 作填充但不承载文字，无需 --on-primary
const GRAPHIC_SELECTORS = new Set(['.bar']);

console.log('=== 静态一致性 ===');
const app = JSON.parse(read('app.json'));
const pages = app.pages;

pages.forEach((p) => ['js', 'wxml', 'wxss', 'json'].forEach((ext) => {
  if (!exists(p + '.' + ext)) bad('缺少 ' + p + '.' + ext);
}));

pages.forEach((p) => {
  const first = read(p + '.wxml').split('\n')[0];
  if (!/\{\{themeClass\}\}/.test(first)) bad(p + '.wxml 根 view 未绑定 themeClass');
  const js = read(p + '.js');
  if (!/core\/theme/.test(js)) bad(p + '.js 未引入 theme');
  if (!/theme\.bind\(this\)/.test(js)) bad(p + '.js 未 bind');
  if (!/theme\.unbind\(this\)/.test(js)) bad(p + '.js 未 unbind');
});
ok(pages.length + ' 个页面：四件套 + 主题链路完整');

const zh = require(path.join(ROOT, 'i18n/zh-CN'));
const en = require(path.join(ROOT, 'i18n/en-US'));
Object.keys(zh).filter((k) => !(k in en)).forEach((k) => bad('en-US 缺 ' + k));
Object.keys(en).filter((k) => !(k in zh)).forEach((k) => bad('zh-CN 缺 ' + k));
['i18n/zh-CN.js', 'i18n/en-US.js'].forEach((f) => {
  const keys = [...read(f).matchAll(/^\s*'([^']+)':/gm)].map((x) => x[1]);
  [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))].forEach((k) => bad(f + ' 重复 key ' + k));
});
ok('i18n 词条 zh=' + Object.keys(zh).length + ' / en=' + Object.keys(en).length + '，对齐且无重复');

const appWxss = read('app.wxss');
const defined = new Set([...appWxss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((x) => x[1]));
const wxssFiles = [];
(function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') walk(p);
    else if (e.name.endsWith('.wxss')) wxssFiles.push(p);
  });
})(ROOT);
const used = new Set();
let hardcoded = 0;
wxssFiles.forEach((f) => {
  const rel = path.relative(ROOT, f);
  const s = fs.readFileSync(f, 'utf8');
  [...s.matchAll(/var\((--[a-z0-9-]+)\)/g)].forEach((x) => used.add(x[1]));
  if (rel !== 'app.wxss') {
    [...s.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\(|gradient/gi)].forEach(() => hardcoded++);
  }
  // 每个规则块单独检查 primary 背景配对
  [...s.matchAll(/([^{}]+)\{([^{}]*)\}/g)].forEach((m) => {
    const selector = m[1].trim().split(/\s+/).pop();
    const body = m[2];
    if (GRAPHIC_SELECTORS.has(selector)) return;
    if (/background:\s*var\(--primary\)/.test(body) && !/color:\s*var\(--on-primary\)/.test(body)) {
      bad(rel + ' ' + selector + ' 使用 primary 背景但缺 on-primary 文字');
    }
  });
});
[...used].filter((t) => !defined.has(t)).forEach((t) => bad('引用未定义 token ' + t));
if (hardcoded) bad('业务 wxss 存在 ' + hardcoded + ' 处硬编码色值 / 渐变（应全部走 token）');
ok('token 定义 ' + defined.size + ' / 引用 ' + used.size + '，零硬编码色值，primary 配对正确');

const isGray = (v) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return false;
  const r = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  return r[0] === r[1] && r[1] === r[2];
};
['navigationBarBackgroundColor', 'backgroundColor'].forEach((k) => {
  if (!isGray(app.window[k])) bad('app.json window.' + k + ' 非灰阶');
});
['color', 'selectedColor', 'backgroundColor'].forEach((k) => {
  if (!isGray(app.tabBar[k])) bad('app.json tabBar.' + k + ' 非灰阶');
});
ok('app.json 原生控件（导航栏 / tabBar）配色均为灰阶');

// ---------------- 主题逻辑（mock wx） ----------------
console.log('=== 三态切换逻辑 ===');
const calls = [];
global.wx = {
  getStorageSync: () => '',
  setStorageSync: (k, v) => calls.push(['storage', k, v]),
  getWindowInfo: () => ({ theme: 'light' }),
  setNavigationBarColor: (c) => calls.push(['nav', c.frontColor, c.backgroundColor]),
  setBackgroundColor: (c) => calls.push(['bg', c.backgroundColor]),
  setTabBarStyle: (c) => calls.push(['tab', c.selectedColor, c.backgroundColor, c.borderStyle]),
};
const theme = require(path.join(ROOT, 'core/theme.js'));
let pageData = {};
const page = { setData: (d) => Object.assign(pageData, d) };
const check = (name, pass) => { if (!pass) { problems++; console.log('  ❌ ' + name); } else console.log('  ✅ ' + name); };

theme.initTheme();
check('auto + 系统浅色 → theme-light', theme.getThemeClass() === 'theme-light');
theme.bind(page);
check('bind 注入 themeClass 并补同步原生控件', pageData.themeClass === 'theme-light' && calls.filter((c) => c[0] === 'tab').length >= 2);
theme.setTheme('dark');
check('手动深色 → 页面即时刷新 + tabBar 同步', theme.getThemeClass() === 'theme-dark' && pageData.themeClass === 'theme-dark' && calls.filter((c) => c[0] === 'tab').pop()[2] === '#141414');
theme.onSystemThemeChange('light');
check('手动深色不受系统变化影响', theme.getThemeClass() === 'theme-dark');
theme.setTheme('auto');
check('auto + 系统浅色 → light', theme.getThemeClass() === 'theme-light');
theme.onSystemThemeChange('dark');
check('auto 跟随系统深色且页面同步', theme.getThemeClass() === 'theme-dark' && pageData.themeClass === 'theme-dark');
theme.setTheme('light');
check('手动浅色覆盖系统深色', theme.getThemeClass() === 'theme-light');
theme.setTheme('invalid');
check('非法 mode 被忽略', theme.getTheme() === 'light');
theme.unbind(page);
theme.setTheme('dark');
check('unbind 后不再通知', pageData.themeClass === 'theme-light');
check('选择结果已持久化', calls.some((c) => c[0] === 'storage' && c[2] === 'dark'));

console.log(problems ? `\n❌ 共 ${problems} 处问题` : '\n✅ 黑白主题规范自检全部通过');
process.exit(problems ? 1 : 0);
