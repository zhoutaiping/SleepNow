// 主题管理：auto（跟随系统）/ light / dark
const THEME_KEY = 'wb_theme';

let currentTheme = 'auto';

function getTheme() {
  return currentTheme;
}

function initTheme() {
  try {
    const saved = wx.getStorageSync(THEME_KEY);
    if (saved) currentTheme = saved;
  } catch (e) {}
  applyTheme();
}

function setTheme(mode) {
  currentTheme = mode;
  try { wx.setStorageSync(THEME_KEY, mode); } catch (e) {}
  applyTheme();
}

function isDarkNow() {
  if (currentTheme === 'dark') return true;
  if (currentTheme === 'light') return false;
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.theme === 'dark';
  } catch (e) {
    return false;
  }
}

function applyTheme() {
  const dark = isDarkNow();
  try {
    wx.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: dark ? '#16162a' : '#ffffff',
    });
    wx.setBackgroundColor({ backgroundColor: dark ? '#16162a' : '#f5f7fa' });
  } catch (e) {}
}

module.exports = { initTheme, getTheme, setTheme, isDarkNow };
