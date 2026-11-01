const SKIP_READY_MS = 800;
const ENTER_READY_MS = 2600;

// 默认为 8 片。真机走查确认低端机掉帧时，只需把这里改为 4。
const PETAL_COUNT = 8;

Page({
  data: {
    petalCount: PETAL_COUNT
  },

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