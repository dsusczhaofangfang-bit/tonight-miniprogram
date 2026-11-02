const shopService = require('../../services/shop');
const categoryService = require('../../services/categories');
const productService = require('../../services/products');
const tableService = require('../../services/tables');
const orderService = require('../../services/orders');
const statsService = require('../../services/stats');
const authService = require('../../services/auth');
const config = require('../../config/index');
const storage = require('../../utils/storage');
const { STORAGE_KEYS } = require('../../utils/constants');

Page({
  data: {
    version: config.version,
    checks: [],
    running: false,
    // 调试用桌号：没有真实二维码时替代扫码，仅开发版可见
    tableOptions: [],
    tableIndex: 0,
    tableName: '',
    tableArea: '',
    // 老板管理后台（演示鉴权）状态，仅作调试入口提示
    ownerText: ''
  },

  onLoad() {
    this.runChecks();
    this.loadTables();
  },

  // 从管理端返回时同步会话显示
  onShow() {
    const session = authService.getSessionSync();
    this.setData({
      ownerText: session ? `${session.roleText || '管理员'} · 已登录（演示）` : '未登录'
    });
  },

  onAdminLogin() {
    wx.navigateTo({ url: '/pages/admin-login/admin-login' });
  },

  loadTables() {
    const app = getApp();
    const current = (app && app.globalData && app.globalData.table) || null;

    tableService.listTables().then((res) => {
      const tables = res.code === 0 ? res.data : [];
      const options = [{ id: '', label: '清除当前桌号' }].concat(
        tables.map((item) => ({ id: item.id, label: `${item.name} · ${item.area}` }))
      );
      const found = current ? options.findIndex((item) => item.id === current.id) : -1;

      this.setData({
        tableOptions: options,
        tableIndex: found > 0 ? found : 0,
        tableName: current ? current.name : '',
        tableArea: current ? current.area : ''
      });
    });
  },

  // 只写入配置里启用中的桌号，走 app.setTable，和扫码路径同一条校验
  onTablePick(event) {
    const index = Number(event.detail.value);
    const option = this.data.tableOptions[index];
    if (!option) return;

    const app = getApp();

    if (!option.id) {
      app.clearTable();
      wx.showToast({ title: '已清除桌号', icon: 'none' });
    } else {
      const table = app.setTable(option.id);
      if (!table) {
        wx.showToast({ title: '桌号不可用', icon: 'none' });
        return;
      }
      wx.showToast({ title: `已设为 ${table.name}`, icon: 'none' });
    }

    this.loadTables();
  },

  runChecks() {
    if (this.data.running) return;
    this.setData({ running: true, checks: [] });

    const tasks = [
      {
        name: '店铺配置',
        run: () => shopService.getShop(),
        format: (data) => `${data.name} · ${data.nameEn}`
      },
      {
        name: '商品分类',
        run: () => categoryService.listCategories(),
        format: (data) => `${data.length} 个分类`
      },
      {
        name: '商品列表',
        run: () => productService.listProducts({}),
        format: (data) => `${data.length} 款在售`
      },
      {
        name: '桌号',
        run: () => tableService.listTables(),
        format: (data) => `${data.length} 个桌号`
      },
      {
        name: '订单',
        run: () => orderService.listOrders({}),
        format: (data) => `${data.length} 条订单`
      },
      {
        name: '今日数据',
        run: () => statsService.getTodayStats(),
        format: (data) => `订单 ${data.orderCount} 笔 · 营业额 ¥${(data.revenue / 100).toFixed(2)}`
      },
      {
        name: '管理员会话',
        run: () => authService.getSession(),
        format: (data) => (data ? `${data.roleText || '管理员'} · 演示鉴权` : '未登录（正常）')
      },
      {
        name: 'Mock 开关',
        run: () => Promise.resolve({ code: 0, data: config.useMock }),
        format: (data) => (data ? 'useMock = true' : 'useMock = false')
      }
    ];

    const results = [];
    const next = (index) => {
      if (index >= tasks.length) {
        this.setData({ checks: results, running: false });
        return;
      }

      const task = tasks[index];
      task.run().then((res) => {
        results.push({
          name: task.name,
          ok: res.code === 0,
          detail: res.code === 0 ? task.format(res.data) : res.message || '调用失败'
        });
        this.setData({ checks: results.slice() });
        next(index + 1);
      });
    };

    next(0);
  },

  onReset() {
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本地订单、商品修改、购物车与管理会话，恢复示例数据。确定继续？',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        [
          STORAGE_KEYS.CART,
          STORAGE_KEYS.ORDERS,
          STORAGE_KEYS.ORDER_SEQ,
          STORAGE_KEYS.PRODUCTS,
          STORAGE_KEYS.CATEGORIES,
          STORAGE_KEYS.TABLES,
          STORAGE_KEYS.SEED_PRODUCTS,
          STORAGE_KEYS.SEED_CATEGORIES,
          STORAGE_KEYS.SEED_TABLES,
          STORAGE_KEYS.ADMIN_SESSION
        ].forEach((key) => storage.remove(key));
        wx.showToast({ title: '已重置', icon: 'success' });
        this.runChecks();
        this.loadTables();
      }
    });
  }
});