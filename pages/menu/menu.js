const categoryService = require('../../services/categories');
const productService = require('../../services/products');

Page({
  data: {
    categories: [],
    activeId: '',
    products: [],
    loading: true
  },

  onShow() {
    this.loadCategories();
  },

  loadCategories() {
    categoryService.listCategories().then((res) => {
      if (res.code !== 0) {
        this.setData({ loading: false });
        wx.showToast({ title: res.message || '分类加载失败', icon: 'none' });
        return;
      }

      const categories = res.data;
      const activeId =
        this.data.activeId && categories.some((item) => item.id === this.data.activeId)
          ? this.data.activeId
          : categories.length
            ? categories[0].id
            : '';

      this.setData({ categories, activeId });

      if (activeId) {
        this.loadProducts(activeId);
      } else {
        this.setData({ products: [], loading: false });
      }
    });
  },

  loadProducts(categoryId) {
    this.setData({ loading: true });
    productService.listProducts({ categoryId }).then((res) => {
      if (res.code !== 0) {
        this.setData({ loading: false });
        wx.showToast({ title: res.message || '商品加载失败', icon: 'none' });
        return;
      }
      this.setData({ products: res.data, loading: false });
    });
  },

  onCategoryTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.activeId) return;
    this.setData({ activeId: id });
    this.loadProducts(id);
  },

  onProductTap() {
    wx.showToast({ title: '商品详情将在 M1 开放', icon: 'none' });
  },

  onAdd() {
    wx.showToast({ title: '购物车将在 M2 开放', icon: 'none' });
  }
});