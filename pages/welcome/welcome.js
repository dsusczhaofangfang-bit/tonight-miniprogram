const SKIP_READY_MS = 600;
// 与 welcome.wxss 中「进入酒馆」的 animation-delay（1.10s）对齐，留 50ms 余量
const ENTER_READY_MS = 1150;

Page({
  data: {},

  onLoad() {
    this._startedAt = Date.now();
    this._leaving = false;
  },

  onSkip() {
    if (Date.now() - this._startedAt < SKIP_READY_MS) {
      return;
    }
    this.enterHome();
  },

  onEnter() {
    if (Date.now() - this._startedAt < ENTER_READY_MS) {
      return;
    }
    this.enterHome();
  },

  enterHome() {
    if (this._leaving) {
      return;
    }

    this._leaving = true;
    wx.switchTab({
      url: '/pages/home/home',
      fail: () => {
        this._leaving = false;
        wx.showToast({ title: '暂时无法进入，请重试', icon: 'none' });
      }
    });
  }
});