// wx.storage 的薄封装：统一异常处理，读写失败不阻断页面
function get(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    if (value === '' || value === undefined || value === null) {
      return fallback;
    }
    return value;
  } catch (error) {
    console.warn('[storage] get failed:', key, error);
    return fallback;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    console.warn('[storage] set failed:', key, error);
    return false;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (error) {
    console.warn('[storage] remove failed:', key, error);
    return false;
  }
}

module.exports = { get, set, remove };