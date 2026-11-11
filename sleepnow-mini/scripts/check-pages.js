#!/usr/bin/env node
/**
 * 晚安开关 · 全页面静态审计（BUG B18）
 * 用法：node scripts/check-pages.js
 *
 * 覆盖：8 个页面的事件绑定 / {{t.xxx}} 注入链路 / 中英文案硬编码 /
 *       WXML 静态中文 / 最小字号 / 后台音频与数据库唯一约束防复发。
 *
 * 与 check-chat.js 的区别：后者只做陪伴页的运行时链路回归与单行输入防复发，
 * 本脚本面向「所有页面」且兼容 stats 页那类动态 buildTexts()（数组 + 前缀拼接），
 * 避免把动态注入误报成「文案未注入」。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const rel = (p) => path.relative(ROOT, p);

const app = JSON.parse(read('app.json'));
const pages = app.pages;
let problems = 0;
const bad = (m) => { problems++; console.log('  ❌ ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

// 语言自名（中文 / English）属于约定例外，不需要走词条
const WXML_TEXT_WHITELIST = new Set(['中文']);

function injectedKeys(js) {
  const keys = new Set();
  // 1) const TEXT_KEYS = { foo: 'x.foo', ... }
  const textKeys = js.match(/const TEXT_KEYS\s*=\s*\{([\s\S]*?)\n\};/);
  if (textKeys) {
    [...textKeys[1].matchAll(/(\w+)\s*:\s*'[^']+'/g)].forEach((m) => keys.add(m[1]));
  }
  // 2) 动态构建：const keys = ['title', ...] + i18n.t('stats.' + k)
  const arr = js.match(/const keys\s*=\s*\[([\s\S]*?)\];/);
  if (arr && /i18n\.t\(\s*'[^']+'\s*\+\s*k\s*\)/.test(js)) {
    [...arr[1].matchAll(/['"]([\w]+)['"]/g)].forEach((m) => keys.add(m[1]));
  }
  // 3) 显式补键：t.loading = ... / t.retry = ...
  [...js.matchAll(/\bt\.(\w+)\s*=/g)].forEach((m) => keys.add(m[1]));
  // 4) TEXT_KEYS 之外直接 setData 的扁平字段（{{title}} 这类，非 t. 前缀，不参与本检查）
  return keys;
}

console.log('=== 事件绑定 / 文案注入 / 国际化 ===');
let handlerCount = 0;
let textRefs = 0;
pages.forEach((p) => {
  const wxml = read(p + '.wxml');
  const js = read(p + '.js');

  // 事件处理器：支持 async、对象方法、冒号赋值三种写法
  const handlers = [...new Set([...wxml.matchAll(/\b(?:bind|catch)([a-zA-Z]+)\s*=\s*"([A-Za-z_$][\w$]*)"/g)]
    .map((m) => m[2]))];
  handlerCount += handlers.length;
  handlers.forEach((h) => {
    const re = new RegExp('(^|[\\s,{])(async\\s+)?' + h + '\\s*\\(', 'm');
    if (!re.test(js)) bad(p + ' 事件处理器未定义：' + h);
  });

  // {{t.xxx}} 必须由页面显式注入，防止回到 i18n.all() 那次空白页事故
  const used = [...new Set([...wxml.matchAll(/\{\{[^}]*\bt\.(\w+)/g)].map((m) => m[1]))];
  textRefs += used.length;
  const injected = injectedKeys(js);
  used.forEach((k) => {
    if (!injected.has(k)) bad(p + '.wxml 使用 {{t.' + k + '}} 但页面未注入该键');
  });

  // JS 里的 toast / modal / 错误文案不得硬编码中文
  const literal = /(?:title|content|phoneError)\s*:\s*'([^']*[\u4e00-\u9fa5][^']*)'/g;
  [...js.matchAll(literal)].forEach((m) => bad(p + '.js 硬编码中文提示：' + m[1]));
});
ok(pages.length + ' 页：' + handlerCount + ' 个事件绑定均有处理器，' + textRefs + ' 处 {{t.xxx}} 均已注入');

// WXML 静态中文（含 {{}} 表达式里的中文字面量）
let wxmlChinese = 0;
pages.forEach((p) => {
  const raw = read(p + '.wxml').replace(/<!--[\s\S]*?-->/g, '');
  [...raw.matchAll(/\{\{([\s\S]*?)\}\}/g)].forEach((m) => {
    [...m[1].matchAll(/['"]([^'"]*[\u4e00-\u9fa5][^'"]*)['"]/g)].forEach((q) => {
      bad(p + '.wxml 表达式内硬编码中文：' + q[1]);
      wxmlChinese++;
    });
  });
  const noExpr = raw.replace(/\{\{[\s\S]*?\}\}/g, '');
  [...noExpr.matchAll(/>\s*([^<>]*[\u4e00-\u9fa5][^<>]*)\s*</g)].forEach((m) => {
    const txt = m[1].trim();
    if (txt && !WXML_TEXT_WHITELIST.has(txt)) { bad(p + '.wxml 静态中文文本：' + txt); wxmlChinese++; }
  });
  [...noExpr.matchAll(/([\w-]+)="([^"]*[\u4e00-\u9fa5][^"]*)"/g)].forEach((m) => {
    bad(p + '.wxml 属性硬编码中文：' + m[1] + '=' + m[2]);
    wxmlChinese++;
  });
});
ok('WXML 静态中文检查完成（例外：语言自名「中文」），命中 ' + wxmlChinese + ' 处');

// 最小字号：20rpx 在 2x 屏只有 10px，正文/说明一律 >= 22rpx
console.log('=== 样式与工程防复发 ===');
const wxssFiles = [];
(function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') walk(p);
    else if (e.name.endsWith('.wxss')) wxssFiles.push(p);
  });
})(ROOT);
let smallFonts = 0;
wxssFiles.forEach((f) => {
  [...fs.readFileSync(f, 'utf8').matchAll(/font-size:\s*(\d+(?:\.\d+)?)rpx/g)].forEach((m) => {
    if (Number(m[1]) < 22) { bad(rel(f) + ' 字号过小 ' + m[1] + 'rpx（应 >= 22rpx）'); smallFonts++; }
  });
});
ok(wxssFiles.length + ' 个 wxss：无 < 22rpx 字号（命中 ' + smallFonts + ' 处）');

const audio = read('core/audio-player.js');
const audioCode = audio.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
if (!/wx\.getBackgroundAudioManager\(\)/.test(audioCode)) bad('core/audio-player.js 未使用后台音频播放器（锁屏会静音）');
if (/wx\.createInnerAudioContext\(\)/.test(audioCode)) bad('core/audio-player.js 回退到了 InnerAudioContext');
else ok('后台音频仍使用 getBackgroundAudioManager（B01 防复发）');

const schema = read('db/schema.sql');
if (!/UNIQUE \(owner_id, sleep_date\)/.test(schema)) bad('db/schema.sql 缺 sleep_logs 同日唯一约束');
if (!/ALTER TABLE sleep_logs ADD CONSTRAINT/.test(schema)) bad('db/schema.sql 缺线上增量迁移语句');
else ok('sleep_logs 同日唯一约束 + 线上迁移语句齐备（B08 防复发）');

const homeJs = read('pages/home/home.js');
const logJs = read('pages/sleep-log/sleep-log.js');
if (!/_checkingIn/.test(homeJs)) bad('首页签到缺少连点保护');
if (!/if \(this\.data\.saving\) return;/.test(logJs)) bad('记录保存缺少连点保护');
else ok('签到 / 保存均有连点保护');

console.log(problems ? `\n❌ 全页面静态审计发现 ${problems} 处问题` : '\n✅ 全页面静态审计全部通过');
process.exit(problems ? 1 : 0);
