// 主题管理：auto（跟随系统）/ light / dark
// ---------------------------------------------------------------------------
// One theme, two modes：
//   - 所有颜色只在 app.wxss 的 .theme-light / .theme-dark 中定义（同一套语义 token）
//   - JS 不持有任何色值用于页面渲染，只决定当前 mode
//   - 页面根 view 绑定 {{themeClass}}，切换时由本模块统一 setData 刷新
//   - 原生控件（导航栏 / tabBar / 窗口背景）用 wx.* API 同步为同色阶
// ---------------------------------------------------------------------------
const THEME_KEY = 'wb_theme';
const MODES = ['auto', 'light', 'dark'];

// 原生控件配色：纯黑白灰，与 app.wxss token 保持同一灰阶
const NATIVE = {
  light: {
    navBg: '#ffffff',
    navFront: '#000000',
    windowBg: '#f4f4f4',
    tabColor: '#8a8a8a',
    tabSelected: '#111111',
    tabBg: '#ffffff',
    tabBorder: 'white',
  },
  dark: {
    navBg: '#141414',
    navFront: '#ffffff',
    windowBg: '#0b0b0b',
    tabColor: '#8a8a8a',
    tabSelected: '#f2f2f2',
    tabBg: '#141414',
    tabBorder: 'black',
  },
};

let currentTheme = 'auto';
let systemDark = false;
const pages = new Set();

function getTheme() { return currentTheme; }

function readSystemDark() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.theme === 'dark';
  } catch (e) {
    return false;
  }
}

function isDarkNow() {
  if (currentTheme === 'dark') return true;
  if (currentTheme === 'light') return false;
  return systemDark;
}

// 供页面根 view 绑定的 class，wxml 里写 class="page {{themeClass}}"
function getThemeClass() {
  return isDarkNow() ? 'theme-dark' : 'theme-light';
}

function applyNative() {
  const c = NATIVE[isDarkNow() ? 'dark' : 'light'];
  try {
    wx.setNavigationBarColor({
      frontColor: c.navFront,
      backgroundColor: c.navBg,
    });
    wx.setBackgroundColor({ backgroundColor: c.windowBg });
    wx.setTabBarStyle({
      color: c.tabColor,
      selectedColor: c.tabSelected,
      backgroundColor: c.tabBg,
      borderStyle: c.tabBorder,
    });
  } catch (e) {
    // 非 tabBar 页面调用 setTabBarStyle 可能失败，忽略即可
  }
}

function notify() {
  const cls = getThemeClass();
  pages.forEach((p) => {
    try { p.setData({ themeClass: cls }); } catch (e) {}
  });
}

function applyTheme() {
  applyNative();
  notify();
}

function initTheme() {
  try {
    const saved = wx.getStorageSync(THEME_KEY);
    if (MODES.indexOf(saved) !== -1) currentTheme = saved;
  } catch (e) {}
  systemDark = readSystemDark();
  applyTheme();
}

function setTheme(mode) {
  if (MODES.indexOf(mode) === -1) return;
  currentTheme = mode;
  try { wx.setStorageSync(THEME_KEY, mode); } catch (e) {}
  applyTheme();
}

// 系统深色模式变化（App.onThemeChange）：仅 auto 模式跟随
function onSystemThemeChange(theme) {
  systemDark = theme === 'dark';
  if (currentTheme === 'auto') applyTheme();
}

// 页面订阅：onLoad 中 bind(this)，onUnload 中 unbind(this)
function bind(page) {
  pages.add(page);
  // onLaunch 阶段 tabBar 可能尚未初始化，页面加载时补同步一次原生控件配色
  applyNative();
  try { page.setData({ themeClass: getThemeClass() }); } catch (e) {}
}
function unbind(page) {
  pages.delete(page);
}

module.exports = {
  initTheme, getTheme, setTheme, isDarkNow, getThemeClass,
  onSystemThemeChange, bind, unbind, MODES,
};
