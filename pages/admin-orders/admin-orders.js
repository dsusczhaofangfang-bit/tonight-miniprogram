const guard = require('../../utils/admin-guard');
const authService = require('../../services/auth');
const orderService = require('../../services/orders');
const { fenToYuan, formatDateTime } = require('../../utils/format');
const { ORDER_STATUS_LIST, ORDER_STATUS_TEXT } = require('../../utils/constants');

Page({
  data: {
    // 管理端需要「全部」，与顾客端（只按状态逐项看）不同
    filters: [],
    activeStatus: '',
    activeText: '全部',
    orders: [],
    counts: { all: 0, pending: 0, making: 0, completed: 0, cancelled: 0, openExceptions: 0 },
    total: 0,
    loading: true,
    session: null
  },

  onLoad() {
    guard.ensureOwner(this).then((ok) => {
      if (ok) this.load();
    });
  },

  // 从详情页返回时重新拉取：详情里改过状态，这里必须同步
  onShow() {
    if (this.data.session && !this.data.loading) this.load();
  },

  onPullDownRefresh() {
    this.load()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  buildFilters(counts) {
    return [{ value: '', text: '全部', count: counts.all }].concat(
      ORDER_STATUS_LIST.map((item) => ({
        value: item.value,
        text: item.text,
        count: counts[item.value] || 0
      }))
    );
  },

  load() {
    // 连续切筛选时只认最后一次请求
    const seq = (this._seq = (this._seq || 0) + 1);
    const status = this.data.activeStatus;
    this.setData({ loading: true });

    return Promise.all([
      orderService.adminListOrders({ status, pageSize: 200 }),
      orderService.adminOrderCounts()
    ])
      .then(([listRes, countRes]) => {
        if (seq !== this._seq) return;
        if (listRes.code !== 0) {
          this.setData({ loading: false });
          wx.showToast({ title: listRes.message || '订单加载失败', icon: 'none' });
          return;
        }

        const counts = countRes.code === 0 ? countRes.data : this.data.counts;

        this.setData({
          loading: false,
          orders: listRes.data.list.map((order) => this.decorate(order)),
          total: listRes.data.total,
          counts,
          filters: this.buildFilters(counts),
          activeText: status ? ORDER_STATUS_TEXT[status] : '全部'
        });
      })
      .catch(() => {
        if (seq !== this._seq) return;
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
      });
  },

  decorate(order) {
    const items = order.items || [];
    const firstName = items.length ? items[0].name : '示例订单';
    const extra = items.length > 1 ? ` 等 ${items.length} 款` : '';
    const exception = order.exception || null;

    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      statusText: ORDER_STATUS_TEXT[order.status] || order.status,
      tableText: order.tableName
        ? `${order.tableName}${order.tableArea ? ' · ' + order.tableArea : ''}`
        : '未记录桌号',
      timeText: formatDateTime(order.createdAt),
      summary: `${firstName}${extra}`,
      totalQty: order.totalQty || 0,
      amountText: fenToYuan(order.totalAmount || 0),
      hasException: Boolean(exception && exception.status === 'open'),
      exceptionReason: exception && exception.status === 'open' ? exception.reason : ''
    };
  },

  onFilterTap(event) {
    const status = event.currentTarget.dataset.status || '';
    if (status === this.data.activeStatus) return;
    // 只接受「全部」或四个状态之一
    if (status && !ORDER_STATUS_LIST.some((item) => item.value === status)) return;

    this.setData({ activeStatus: status, loading: true });
    this.load();
  },

  onOrderTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/admin-order-detail/admin-order-detail?id=${id}` });
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