const authService = require('../../services/auth');
const config = require('../../config/index');

// 调酒师登录：演示口令，与老板后台完全独立的会话。
// 这里只做体验层拦截，正式版权限必须由云函数校验角色。
Page({
  data: {
    password: '',
    submitting: false,
    error: '',
    demoPassword: String(config.demoBartenderPassword || ''),
    roleText: authService.ROLE_TEXT.bartender
  },

  onLoad() {
    const session = authService.getSessionSync(authService.ROLES.BARTENDER);
    if (session && session.role === authService.ROLES.BARTENDER) {
      wx.redirectTo({ url: '/pages/bartender-board/bartender-board' });
    }
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: '' });
  },

  onSubmit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, error: '' });

    authService
      .login(this.data.password, authService.ROLES.BARTENDER)
      .then((res) => {
        this.setData({ submitting: false });
        if (res.code !== 0) {
          this.setData({ error: res.message || '登录失败' });
          return;
        }
        wx.redirectTo({ url: '/pages/bartender-board/bartender-board' });
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