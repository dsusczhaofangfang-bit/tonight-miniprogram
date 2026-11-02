const cartService = require('../../services/cart');
const orderService = require('../../services/orders');
const config = require('../../config/index');
const { fenToYuan } = require('../../utils/format');
const { setCartBadge } = require('../../utils/tabbar');

Page({
  data: {
    table: null,
    items: [],
    totalQty: 0,
    totalText: '0.00',
    remark: '',
    remarkLen: 0,
    remarkMax: 100,
    submitting: false,
    loading: true,
    empty: false,
    isDev: false,
    demoMode: config.demoMode
  },

  onLoad() {
    this.setData({ isDev: this.detectDev() });
    this.load();
  },

  // 从「开发自检」设置桌号返回时同步，避免仍显示未识别
  onShow() {
    if (!this._loaded) return;
    const app = getApp();
    this.setData({ table: (app && app.globalData && app.globalData.table) || null });
  },

  // 仅开发版展示调试入口；正式版桌号必须来自桌面二维码
  detectDev() {
    try {
      const info = wx.getAccountInfoSync();
      return ((info.miniProgram && info.miniProgram.envVersion) || 'release') !== 'release';
    } catch (error) {
      return false;
    }
  },

  load() {
    const app = getApp();
    const table = (app && app.globalData && app.globalData.table) || null;

    return cartService
      .getCart()
      .then((res) => {
        if (res.code !== 0) {
          this.setData({ loading: false, empty: true });
          wx.showToast({ title: res.message || '购物车加载失败', icon: 'none' });
          return;
        }

        const items = res.data.items
          .filter((item) => item.selected)
          .map((item) =>
            Object.assign({}, item, {
              priceText: fenToYuan(item.price),
              subtotalText: fenToYuan(item.subtotal)
            })
          );
        const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);

        this.setData({
          table,
          items,
          totalQty: items.reduce((sum, item) => sum + item.qty, 0),
          totalText: fenToYuan(totalAmount),
          loading: false,
          empty: items.length === 0
        });
        this._loaded = true;
      })
      .catch(() => {
        this.setData({ loading: false, empty: true });
        wx.showToast({ title: '加载失败，请返回重试', icon: 'none' });
      });
  },

  // 改数量：本地即时重算金额，同时写回购物车，返回后数量仍一致
  onQtyChange(event) {
    const id = event.currentTarget.dataset.id;
    const qty = event.detail.value;
    const index = this.data.items.findIndex((item) => item.productId === id);
    if (!id || index < 0) return;

    const items = this.data.items.slice();
    const item = Object.assign({}, items[index], { qty });
    item.subtotal = item.price * qty;
    item.subtotalText = fenToYuan(item.subtotal);
    items[index] = item;

    this.setData({
      items,
      totalQty: items.reduce((sum, entry) => sum + entry.qty, 0),
      totalText: fenToYuan(items.reduce((sum, entry) => sum + entry.subtotal, 0))
    });

    cartService.updateItemQty(id, qty).then((res) => {
      if (res.code !== 0) {
        wx.showToast({ title: res.message || '数量更新失败', icon: 'none' });
        this.load();
      }
    });
  },

  onRemarkInput(event) {
    const remark = event.detail.value || '';
    this.setData({ remark, remarkLen: remark.length });
  },

  // 有图但加载失败时退回酒标占位块，避免空白
  onImageError(event) {
    const index = event.currentTarget.dataset.index;
    if (index === undefined || index < 0) return;
    this.setData({ [`items[${index}].image`]: '' });
  },

  // 提交前再校验桌号；金额由订单服务按商品表重新核算
  onSubmit() {
    if (this.data.submitting) return;

    if (!this.data.table) {
      wx.showToast({ title: '未识别到桌号，请扫描桌面二维码', icon: 'none' });
      return;
    }

    const items = this.data.items;
    if (!items.length) {
      wx.showToast({ title: '没有可结算的商品', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    const submittedIds = items.map((item) => item.productId);

    orderService
      .createOrder({
        tableId: this.data.table.id,
        items: items.map((item) => ({ productId: item.productId, qty: item.qty })),
        remark: this.data.remark
      })
      .then((res) => {
        if (res.code !== 0) {
          this.setData({ submitting: false });
          wx.showToast({ title: res.message || '下单失败', icon: 'none' });
          return null;
        }

        // 只清除本次提交的商品，未勾选的商品留在购物车
        return cartService.removeItems(submittedIds).then(() => {
          setCartBadge(cartService.getCountSync());
          wx.showToast({ title: '下单成功', icon: 'success' });
          wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${res.data.id}` });
          return res;
        });
      })
      .catch(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '提交失败，请重试', icon: 'none' });
      });
  },

  onBackToCart() {
    wx.navigateBack();
  },

  onGoMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  // 没有真实二维码时，去开发自检里选一个已配置的桌号
  onGoDevCheck() {
    wx.navigateTo({ url: '/pages/dev-check/dev-check' });
  }
});