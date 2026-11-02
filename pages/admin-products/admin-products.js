const guard = require('../../utils/admin-guard');
const authService = require('../../services/auth');
const productService = require('../../services/products');
const categoryService = require('../../services/categories');
const statsService = require('../../services/stats');
const { fenToYuan } = require('../../utils/format');

Page({
  data: {
    categories: [],
    activeCategory: '',
    keyword: '',
    products: [],
    counts: { total: 0, onSale: 0, offSale: 0 },
    loading: true,
    session: null
  },

  onLoad() {
    this.categoryNameById = {};
    guard.ensureOwner(this).then((ok) => {
      if (ok) this.loadCategories();
    });
  },

  // 从编辑页返回时重新拉取：改过的名称/价格/上下架必须立刻体现
  onShow() {
    if (this.data.session && !this.data.loading) this.load();
  },

  onPullDownRefresh() {
    this.load()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  loadCategories() {
    return categoryService.listCategories().then((res) => {
      if (res.code !== 0) {
        this.load();
        return;
      }
      const nameById = {};
      res.data.forEach((item) => {
        nameById[item.id] = item.name;
      });
      this.categoryNameById = nameById;

      this.setData({
        categories: [{ id: '', name: '全部' }].concat(
          res.data.map((item) => ({ id: item.id, name: item.name }))
        )
      });
      this.load();
    });
  },

  load() {
    const seq = (this._seq = (this._seq || 0) + 1);
    const category = this.data.activeCategory;
    const keyword = this.data.keyword;
    const nameById = this.categoryNameById || {};
    this.setData({ loading: true });

    return Promise.all([
      productService.listProducts({ onlyAvailable: false, category, keyword }),
      statsService.getAdminOverview()
    ])
      .then(([listRes, statRes]) => {
        if (seq !== this._seq) return;
        if (listRes.code !== 0) {
          this.setData({ loading: false });
          wx.showToast({ title: listRes.message || '商品加载失败', icon: 'none' });
          return;
        }

        const stats = statRes.code === 0 ? statRes.data : null;

        this.setData({
          loading: false,
          products: listRes.data.map((item) => ({
            id: item.id,
            name: item.name,
            nameEn: item.nameEn || '',
            categoryName: nameById[item.category] || '未分类',
            image: item.image || '',
            priceText: fenToYuan(item.price),
            isAvailable: item.isAvailable !== false
          })),
          counts: stats
            ? {
                total: stats.totalProductCount,
                onSale: stats.onSaleCount,
                offSale: stats.offSaleCount
              }
            : this.data.counts
        });
      })
      .catch(() => {
        if (seq !== this._seq) return;
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
      });
  },

  onCategoryTap(event) {
    const id = event.currentTarget.dataset.id || '';
    if (id === this.data.activeCategory) return;
    this.setData({ activeCategory: id });
    this.load();
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearchConfirm() {
    this.load();
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.load();
  },

  // 上下架：setAvailability 明确写入目标状态，避免连点时方向翻错
  onToggle(event) {
    const id = event.currentTarget.dataset.id;
    const available = event.detail.value !== false;
    if (!id) return;

    productService
      .setProductAvailability(id, available)
      .then((res) => {
        if (res.code !== 0) {
          wx.showToast({ title: res.message || '操作失败', icon: 'none' });
          this.load();
          return;
        }
        wx.showToast({ title: available ? '已上架' : '已下架', icon: 'none' });
        this.load();
      })
      .catch(() => {
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
        this.load();
      });
  },

  // switch 自带 tap，阻止冒泡到整行（否则会误进编辑页）
  onSwitchTap() {},

  onProductTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/admin-product-edit/admin-product-edit?id=${id}` });
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/admin-product-edit/admin-product-edit' });
  },

  onBackToCustomer() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  onLogout() {
    wx.showModal({
      title: '退出管理后台',
      content: '退出后需要重新输入管理口令。确定退出？',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        authService.logout().then(() => {
          wx.switchTab({ url: '/pages/home/home' });
        });
      }
    });
  }
});