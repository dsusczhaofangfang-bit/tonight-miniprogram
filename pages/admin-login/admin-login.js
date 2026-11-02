const authService = require('../../services/auth');
const config = require('../../config/index');

Page({
  data: {
    password: '',
    submitting: false,
    error: '',
    // 演示阶段明确告知口令，不把前端口令包装成安全机制
    demoPassword: String(config.demoOwnerPassword || config.demoAdminPassword || ''),
    roleText: authService.ROLE_TEXT.owner
  },

  onLoad() {
    const session = authService.getSessionSync();
    if (session && session.role === authService.ROLES.OWNER) {
      wx.redirectTo({ url: '/pages/admin-overview/admin-overview' });
    }
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: '' });
  },

  onSubmit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, error: '' });

    authService
      .login(this.data.password, authService.ROLES.OWNER)
      .then((res) => {
        this.setData({ submitting: false });
        if (res.code !== 0) {
          this.setData({ error: res.message || '登录失败' });
          return;
        }
        wx.redirectTo({ url: '/pages/admin-overview/admin-overview' });
      })
      .catch(() => {
        this.setData({ submitting: false, error: '登录失败，请重试' });
      });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: '/pages/home/home' });
      }
    });
  }
});