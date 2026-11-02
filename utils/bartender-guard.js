const authService = require('../services/auth');

// 调酒师页面统一守卫：入口隐藏只是体验，这里才是页面级拦截。
// 未登录（或角色不对）立即回调酒师登录页，页面不加载任何订单数据。
function ensureBartender(page) {
  return authService.requireBartender().then((res) => {
    if (res.code !== 0) {
      wx.showToast({ title: res.message || '请先登录', icon: 'none' });
      wx.redirectTo({ url: '/pages/bartender-login/bartender-login' });
      return false;
    }
    page.setData({
      session: res.data,
      roleText: res.data.roleText || authService.ROLE_TEXT.bartender
    });
    return true;
  });
}

module.exports = { ensureBartender };