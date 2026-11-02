const shopService = require('../../services/shop');
const categoryService = require('../../services/categories');
const recommendService = require('../../services/recommend');
const cartService = require('../../services/cart');
const config = require('../../config/index');
const { fenToYuan } = require('../../utils/format');
const { setCartBadge } = require('../../utils/tabbar');

function statusBarHeight() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return (info && info.statusBarHeight) || 20;
  } catch (error) {
    return 20;
  }
}

// 自定义导航没有原生导航栏：右上角的微信胶囊（含关闭/退出按钮）是原生层，
// 页面元素压到它下面时点击会直接落到胶囊上。这里把「我的」放到胶囊下方，避免误触退出。
function capsuleBottom() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const status = (info && info.statusBarHeight) || 20;
    const rect =
      typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;

    if (rect && rect.bottom > 0) {
      return Math.round(rect.bottom + 8);
    }

    return status + 44;
  } catch (error) {
    // 基础库不支持时按常见胶囊高度退回，宁可低一点也不要压住胶囊
    return 64;
  }
}

Page({
  data: {
    version: config.version,
    // 自定义导航：顶部内边距 = 状态栏高度 + 12px，避免刘海屏压字
    topInset: 32,
    // 「我的」的纵向位置：微信胶囊下沿 + 8px，避免被胶囊盖住
    profileTop: 64,
    intro: '',
    table: null,
    categories: [],
    featured: [],
    seasonal: [],
    season: '',
    totalCount: 0,
    loading: true
  },

  onLoad() {
    this.setData({ topInset: statusBarHeight() + 12, profileTop: capsuleBottom() });
  },

  onShow() {
    this.syncTable();
    setCartBadge(cartService.getCountSync());
    this.loadData();
  },

  onPullDownRefresh() {
    this.syncTable();
    this.loadData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  syncTable() {
    const app = getApp();
    this.setData({ table: (app && app.globalData && app.globalData.table) || null });
  },

  loadData() {
    return Promise.all([
      shopService.getShop(),
      categoryService.listCategories(),
      recommendService.getHome()
    ])
      .then(([shopRes, categoryRes, recommendRes]) => {
        const categories = categoryRes.code === 0 ? categoryRes.data : [];
        const nameById = {};
        categories.forEach((item) => {
          nameById[item.id] = item.name;
        });

        const recommend = recommendRes.code === 0 ? recommendRes.data : null;
        const featured = ((recommend && recommend.featured) || []).map((product) =>
          Object.assign({}, product, {
            categoryName: nameById[product.category] || '',
            priceText: fenToYuan(product.price)
          })
        );
        const seasonal = ((recommend && recommend.seasonal) || []).map((entry) => ({
          id: entry.product.id,
          name: entry.product.name,
          priceText: fenToYuan(entry.product.price),
          note: entry.note
        }));

        this.setData({
          intro: shopRes.code === 0 ? String(shopRes.data.intro || '') : '',
          categories,
          featured,
          seasonal,
          season: (recommend && recommend.season) || '',
          totalCount: (recommend && recommend.totalCount) || 0,
          loading: false
        });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
      });
  },

  // 点分类：tab 页不能带参数，先写 globalData 再由酒单页消费
  onCategoryTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pendingCategoryId = id;
    }
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  onStartOrder() {
    wx.switchTab({ url: '/pages/menu/menu' });
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

  onProfileTap() {
    wx.navigateTo({ url: '/pages/my/my' });
  }
});