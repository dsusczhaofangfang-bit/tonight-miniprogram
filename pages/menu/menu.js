const categoryService = require('../../services/categories');
const productService = require('../../services/products');
const cartService = require('../../services/cart');
const { fenToYuan } = require('../../utils/format');
const { setCartBadge } = require('../../utils/tabbar');

const ALL_NAME = '全部';
const SEARCH_DEBOUNCE = 200;

Page({
  data: {
    categories: [],
    // activeId 为空串表示「全部」
    activeId: '',
    activeName: ALL_NAME,
    keyword: '',
    products: [],
    loading: true
  },

  onShow() {
    // 首页点分类跳过来时，globalData 里带着要选中的分类（tab 页不能用 URL 传参）
    const app = getApp();
    if (app && app.globalData && app.globalData.pendingCategoryId) {
      this._pendingCategoryId = app.globalData.pendingCategoryId;
      app.globalData.pendingCategoryId = '';
    }
    setCartBadge(cartService.getCountSync());
    this.bootstrap();
  },

  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
  },

  onPullDownRefresh() {
    this.bootstrap()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  bootstrap() {
    return categoryService
      .listCategories()
      .then((res) => {
        if (res.code !== 0) {
          this.setData({ loading: false });
          wx.showToast({ title: res.message || '分类加载失败', icon: 'none' });
          return null;
        }

        const categories = res.data;
        const pending = this._pendingCategoryId;
        this._pendingCategoryId = '';

        let activeId = this.data.activeId;
        if (pending && categories.some((item) => item.id === pending)) {
          activeId = pending;
        } else if (activeId && !categories.some((item) => item.id === activeId)) {
          activeId = '';
        }

        this.setData({
          categories,
          activeId,
          activeName: this.nameOf(activeId, categories)
        });
        return this.loadProducts();
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  // 分类与关键词都交给 services 过滤：M4 换云函数时页面不用改
  loadProducts() {
    const seq = (this._seq = (this._seq || 0) + 1);
    const { activeId, keyword } = this.data;
    this.setData({ loading: true });

    return productService
      .listProducts({ category: activeId, keyword })
      .then((res) => {
        // 连续输入或连续切分类时只认最后一次请求，避免旧结果覆盖新结果
        if (seq !== this._seq) return;
        if (res.code !== 0) {
          this.setData({ loading: false });
          wx.showToast({ title: res.message || '酒单加载失败', icon: 'none' });
          return;
        }

        const categoryNames = {};
        this.data.categories.forEach((item) => {
          categoryNames[item.id] = item.name;
        });

        const products = res.data.map((item) =>
          Object.assign({}, item, {
            priceText: fenToYuan(item.price),
            categoryName: categoryNames[item.category] || ''
          })
        );
        this.setData({ products, loading: false });
      })
      .catch(() => {
        if (seq !== this._seq) return;
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' });
      });
  },

  nameOf(id, categories) {
    if (!id) return ALL_NAME;
    const list = categories || this.data.categories;
    const matched = list.find((item) => item.id === id);
    return matched ? matched.name : ALL_NAME;
  },

  scrollToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onCategoryTap(event) {
    const id = event.currentTarget.dataset.id || '';
    if (id === this.data.activeId) return;
    this.setData({ activeId: id, activeName: this.nameOf(id) });
    this.loadProducts();
    this.scrollToTop();
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });

    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.loadProducts();
      if (keyword) this.scrollToTop();
    }, SEARCH_DEBOUNCE);
  },

  onSearchConfirm() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.loadProducts();
    this.scrollToTop();
  },

  onClearKeyword() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.setData({ keyword: '' });
    this.loadProducts();
    this.scrollToTop();
  },

  onProductTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/product/product?id=${id}` });
  },

  onAdd(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    cartService.addItem(id, 1).then((res) => {
      if (res.code !== 0) {
        wx.showToast({ title: res.message || '加入失败', icon: 'none' });
        return;
      }
      setCartBadge(res.data.totalQty);
      wx.showToast({ title: '已加入购物车', icon: 'none' });
    });
  },

  // 真实图片加载失败时退回 CSS 酒标占位块，不留空白
  onImageError(event) {
    const index = event.currentTarget.dataset.index;
    if (index === undefined || index < 0) return;
    this.setData({ [`products[${index}].image`]: '' });
  }
});