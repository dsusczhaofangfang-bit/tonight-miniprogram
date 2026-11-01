const shopService = require('../../services/shop');
const config = require('../../config/index');

Page({
  data: {
    shop: null,
    version: config.version
  },

  onShow() {
    this.loadShop();
  },

  loadShop() {
    shopService.getShop().then((res) => {
      if (res.code === 0) {
        this.setData({ shop: res.data });
      }
    });
  },

  onStartOrder() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  onViewMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  onMapTap() {
    wx.showToast({ title: '地图导航待完善', icon: 'none' });
  },

  onCallTap() {
    wx.showToast({ title: '电话待完善', icon: 'none' });
  }
});