const config = require('../../config/index');
const authService = require('../../services/auth');

Page({
  data: {
    version: config.version,
    isDev: false,
    // 老板身份只影响入口文案；真正的页面拦截在 utils/admin-guard
    isOwner: false,
    ownerText: ''
  },

  onLoad() {
    let envVersion = 'release';
    try {
      const info = wx.getAccountInfoSync();
      envVersion = (info.miniProgram && info.miniProgram.envVersion) || 'release';
    } catch (error) {
      envVersion = 'release';
    }
    this.setData({ isDev: envVersion !== 'release' });
  },

  // 每次回到本页都重新读会话：可能刚在后台退出登录
  onShow() {
    const session = authService.getSessionSync();
    const isOwner = Boolean(session && session.role === authService.ROLES.OWNER);
    this.setData({
      isOwner,
      ownerText: isOwner ? `${session.roleText || '老板'} · 已登录` : '需口令'
    });
  },

  // 「我的订单」与底部 Tab 进入的是同一个页面
  onOrdersTap() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  // 老板入口：已登录直接进后台，未登录先去口令页（Mock 鉴权）
  onAdminTap() {
    if (this.data.isOwner) {
      wx.navigateTo({ url: '/pages/admin-overview/admin-overview' });
      return;
    }
    wx.navigateTo({ url: '/pages/admin-login/admin-login' });
  },

  onLogout() {
    if (!this.data.isOwner) return;
    wx.showModal({
      title: '退出管理后台',
      content: '退出后需要重新输入管理口令。确定退出？',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        authService.logout().then(() => {
          wx.showToast({ title: '已退出', icon: 'none' });
          this.onShow();
        });
      }
    });
  },

  onAboutTap() {
    wx.showToast({ title: '关于页待完善', icon: 'none' });
  },

  onDevCheck() {
    wx.navigateTo({ url: '/pages/dev-check/dev-check' });
  }
});