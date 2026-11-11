// 主题管理：auto（跟随系统）/ light / dark
// ---------------------------------------------------------------------------
// One theme, two modes：
//   - 所有颜色只在 app.wxss 的 .theme-light / .theme-dark 中定义（同一套语义 token）
//   - JS 不持有任何色值用于页面渲染，只决定当前 mode
//   - 页面根 view 绑定 {{themeClass}}，切换时由本模块统一 setData 刷新
//   - 原生控件（导航栏 / tabBar / 窗口背景）用 wx.* API 同步为同色阶
//   - app.json 开启 darkmode 并引用 theme.json 变量（BUG B03）：
//     系统主题变化时框架自动切换原生控件；手动切主题 / 从后台回前台时由本模块覆盖
// ---------------------------------------------------------------------------
const THEME_KEY = 'wb_theme';
const MODES = ['auto', 'light', 'dark'];

// 原生控件配色：纯黑白灰，与 app.wxss token、theme.json 保持同一灰阶
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

// 与 theme.json 的 @tab* 变量一一对应；手动模式下 theme.json 变量跟随系统主题，
// 因此选中态图标必须由 JS 按「实际生效 mode」再覆盖一次（BUG B16）
const TAB_ICONS = [
  ['home', 'home-on.png', 'home-on-dark.png'],
  ['sounds', 'sounds-on.png', 'sounds-on-dark.png'],
  ['log', 'log-on.png', 'log-on-dark.png'],
  ['chat', 'chat-on.png', 'chat-on-dark.png'],
  ['mine', 'mine-on.png', 'mine-on-dark.png'],
];

let currentTheme = 'auto';
let systemDark = false;
let lastIconMode = null;
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

// BUG B04：三个 API 必须各自独立 try。原来共用一个 try，
// setBackgroundColor 抛错会让 setTabBarStyle 永远不执行（截图里 tabBar 恒为白色）。
// 同时挂 fail 回调，避免异步失败静默无感知。
function safeNative(name, args) {
  try {
    if (typeof wx[name] !== 'function') return false;
    const opts = Object.assign({}, args);
    opts.fail = (err) => {
      // 非 tabBar 页面调用 tabBar API 会失败，属预期；其余情况留痕便于真机排查
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[theme] ' + name + ' failed: ' + ((err && err.errMsg) || 'unknown'));
      }
    };
    wx[name](opts);
    return true;
  } catch (e) {
    return false;
  }
}

function applyNative() {
  const dark = isDarkNow();
  const c = NATIVE[dark ? 'dark' : 'light'];

  safeNative('setNavigationBarColor', {
    frontColor: c.navFront,
    backgroundColor: c.navBg,
  });
  safeNative('setBackgroundColor', { backgroundColor: c.windowBg });
  safeNative('setTabBarStyle', {
    color: c.tabColor,
    selectedColor: c.tabSelected,
    backgroundColor: c.tabBg,
    borderStyle: c.tabBorder,
  });

  const mode = dark ? 'dark' : 'light';
  if (lastIconMode !== mode && typeof wx.setTabBarItem === 'function') {
    TAB_ICONS.forEach((item, index) => {
      safeNative('setTabBarItem', {
        index,
        iconPath: 'assets/tab/' + item[0] + '.png',
        selectedIconPath: 'assets/tab/' + (dark ? item[2] : item[1]),
      });
    });
    lastIconMode = mode;
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
  lastIconMode = null;
  applyTheme();
}

function setTheme(mode) {
  if (MODES.indexOf(mode) === -1) return;
  currentTheme = mode;
  try { wx.setStorageSync(THEME_KEY, mode); } catch (e) {}
  applyTheme();
}

// App.onShow 调用：从后台回前台时，框架可能已按系统主题重刷原生控件，
// 这里再按用户手动选择覆盖一次，避免手动深色 + 系统浅色的割裂
function syncNative() {
  lastIconMode = null;
  applyNative();
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
  onSystemThemeChange, syncNative, bind, unbind, MODES,
};
