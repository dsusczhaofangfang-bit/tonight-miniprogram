const productService = require('../../services/products');
const categoryService = require('../../services/categories');
const cartService = require('../../services/cart');
const { fenToYuan } = require('../../utils/format');
const { setCartBadge } = require('../../utils/tabbar');

Page({
  data: {
    loading: true,
    product: null,
    categoryName: '',
    categoryNameEn: '',
    priceText: '0.00',
    qty: 1,
    unavailable: false,
    imageFailed: false,
    error: ''
  },

  onLoad(options) {
    this.productId = (options && options.id) || '';
    this.load();
  },

  onShow() {
    setCartBadge(cartService.getCountSync());
  },

  load() {
    if (!this.productId) {
      this.setData({ loading: false, error: '缺少商品参数' });
      return;
    }

    Promise.all([productService.getProduct(this.productId), categoryService.listCategories()])
      .then(([productRes, categoryRes]) => {
        if (productRes.code !== 0) {
          this.setData({ loading: false, error: productRes.message || '商品不存在' });
          return;
        }

        const product = productRes.data;
        const categories = categoryRes.code === 0 ? categoryRes.data : [];
        const matched = categories.find((item) => item.id === product.category);

        this.setData({
          product,
          categoryName: matched ? matched.name : '',
          categoryNameEn: matched ? matched.nameEn : '',
          priceText: fenToYuan(product.price),
          unavailable: product.isAvailable === false,
          loading: false
        });
        wx.setNavigationBarTitle({ title: product.name });
      })
      .catch(() => {
        this.setData({ loading: false, error: '加载失败，请返回重试' });
      });
  },

  onQtyChange(event) {
    this.setData({ qty: event.detail.value });
  },

  // 有图但加载失败时退回占位块，避免顶部留白
  onImageError() {
    this.setData({ imageFailed: true });
  },

  onAdd() {
    const product = this.data.product;
    if (!product || this.data.unavailable) return;

    cartService.addItem(product.id, this.data.qty).then((res) => {
      if (res.code !== 0) {
        wx.showToast({ title: res.message || '加入失败', icon: 'none' });
        return;
      }
      setCartBadge(res.data.totalQty);
      wx.showToast({ title: `已加入 ${this.data.qty} 件`, icon: 'none' });
    });
  },

  onGoCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  }
});