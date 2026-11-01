const config = require('../../config/index');

Page({
  data: {
    version: config.version,
    isDev: false
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

  onAdminTap() {
    wx.showToast({ title: '管理后台将在 M3 开放', icon: 'none' });
  },

  onAboutTap() {
    wx.showToast({ title: '关于页待完善', icon: 'none' });
  },

  onDevCheck() {
    wx.navigateTo({ url: '/pages/dev-check/dev-check' });
  }
});