Page({
  onEnter() {
    this.enterHome();
  },

  onSkip() {
    this.enterHome();
  },

  enterHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});