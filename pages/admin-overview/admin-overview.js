const authService = require('../../services/auth');
const guard = require('../../utils/admin-guard');
const statsService = require('../../services/stats');
const orderService = require('../../services/orders');
const { fenToYuan, formatTime } = require('../../utils/format');
const { ORDER_STATUS_TEXT } = require('../../utils/constants');

Page({
  data: {
    loading: true,
    session: null,
    dateText: '',
    updatedText: '',
    overview: {
      todayOrderCount: 0,
      todayRevenueText: '0.00',
      handlingCount: 0,
      pendingCount: 0,
      makingCount: 0,
      onSaleCount: 0,
      offSaleCount: 0,
      openExceptionCount: 0
    },
    recentOrders: []
  },

  onLoad() {
    guard.ensureOwner(this).then((ok) => {
      if (ok) this.load();
    });
  },

  // 从订单详情返回时刷新，保证状态与概览数字同步
  onShow() {
    if (this.data.session) this.load();
  },

  onPullDownRefresh() {
    this.load()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true });

    return Promise.all([
      statsService.getAdminOverview(),
      orderService.adminListOrders({ page: 1, pageSize: 5 })
    ])
      .then(([statsRes, ordersRes]) => {
        if (statsRes.code !== 0) {
          this.setData({ loading: false });
          wx.showToast({ title: statsRes.message || '概览加载失败', icon: 'none' });
          return;
        }

        const overview = statsRes.data;
        const list = ordersRes.code === 0 ? ordersRes.data.list : [];

        this.setData({
          loading: false,
          overview: {
            todayOrderCount: overview.todayOrderCount,
            todayRevenueText: fenToYuan(overview.todayRevenue),
            handlingCount: overview.handlingCount,
            pendingCount: overview.pendingCount,
            makingCount: overview.makingCount,
            onSaleCount: overview.onSaleCount,
            offSaleCount: overview.offSaleCount,
            openExceptionCount: overview.openExceptionCount
          },
          dateText: `${overview.date.slice(0, 4)}.${overview.date.slice(4, 6)}.${overview.date.slice(6, 8)}`,
          recentOrders: list.map((order) => this.decorate(order)),
          updatedText: `更新于 ${formatTime(Date.now())}`
        });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
      });
  },

  // 概览只要摘要，点进去看完整明细
  decorate(order) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      statusText: ORDER_STATUS_TEXT[order.status] || order.status,
      tableText: order.tableName ? `${order.tableName}${order.tableArea ? ' · ' + order.tableArea : ''}` : '未记录桌号',
      timeText: `${formatTime(order.createdAt)}`,
      totalQty: order.totalQty || 0,
      amountText: fenToYuan(order.totalAmount || 0),
      hasException: Boolean(order.exception && order.exception.status === 'open')
    };
  },

  onOrderTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/admin-order-detail/admin-order-detail?id=${id}` });
  },

  onGoOrders() {
    wx.redirectTo({ url: '/pages/admin-orders/admin-orders' });
  },

  onGoProducts() {
    wx.redirectTo({ url: '/pages/admin-products/admin-products' });
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
          wx.showToast({ title: '已退出', icon: 'none' });
          wx.switchTab({ url: '/pages/home/home' });
        });
      }
    });
  }
});