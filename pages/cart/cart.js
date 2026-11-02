const cartService = require('../../services/cart');
const { fenToYuan } = require('../../utils/format');
const { setCartBadge } = require('../../utils/tabbar');

Page({
  data: {
    items: [],
    totalQty: 0,
    totalText: '0.00',
    // 勾选结算：底部合计只算已勾选商品
    selectedQty: 0,
    selectedText: '0.00',
    allSelected: false,
    loading: true
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    return cartService.getCart().then((res) => {
      if (res.code !== 0) {
        this.setData({ loading: false });
        wx.showToast({ title: res.message || '购物车加载失败', icon: 'none' });
        return;
      }

      const data = res.data;
      setCartBadge(data.totalQty);
      this.setData({
        items: data.items.map((item) =>
          Object.assign({}, item, {
            priceText: fenToYuan(item.price),
            subtotalText: fenToYuan(item.subtotal)
          })
        ),
        totalQty: data.totalQty,
        totalText: fenToYuan(data.totalAmount),
        selectedQty: data.selectedQty,
        selectedText: fenToYuan(data.selectedAmount),
        allSelected: data.allSelected,
        loading: false
      });
    });
  },

  onToggle(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.items.findIndex((item) => item.productId === id);
    if (!id || index < 0) return;
    const next = !this.data.items[index].selected;
    cartService.toggleSelected(id, next).then(() => this.refresh());
  },

  onToggleAll() {
    cartService.setAllSelected(!this.data.allSelected).then(() => this.refresh());
  },

  onQtyChange(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    cartService.updateItemQty(id, event.detail.value).then(() => this.refresh());
  },

  onRemove(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    wx.showModal({
      title: '移出购物车',
      content: '确定把这件商品移出购物车吗？',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        cartService.removeItem(id).then(() => this.refresh());
      }
    });
  },

  onClear() {
    wx.showModal({
      title: '清空购物车',
      content: '将清空购物车里的全部商品，确定继续？',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        cartService.clear().then(() => this.refresh());
      }
    });
  },

  // 只结算已勾选商品；确认页会再次校验桌号与金额
  onCheckout() {
    if (this.data.selectedQty <= 0) {
      wx.showToast({ title: '请先勾选要结算的商品', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/order-confirm/order-confirm' });
  },

  onGoMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  }
});