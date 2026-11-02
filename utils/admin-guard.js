const authService = require('../services/auth');

// 管理端页面统一守卫：入口隐藏只是体验，这里才是页面级拦截。
// 未登录（或角色不对）立即回登录页，页面不加载任何管理数据。
function ensureOwner(page) {
  return authService.requireOwner().then((res) => {
    if (res.code !== 0) {
      wx.showToast({ title: res.message || '请先登录', icon: 'none' });
      wx.redirectTo({ url: '/pages/admin-login/admin-login' });
      return false;
    }
    page.setData({
      session: res.data,
      roleText: res.data.roleText || authService.ROLE_TEXT.owner
    });
    return true;
  });
}

module.exports = { ensureOwner };