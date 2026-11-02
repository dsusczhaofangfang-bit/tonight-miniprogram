const orderService = require('../../services/orders');
const { fenToYuan, formatDateTime } = require('../../utils/format');
const { ORDER_STATUS, ORDER_STATUS_LIST, ORDER_STATUS_TEXT } = require('../../utils/constants');

Page({
  data: {
    filters: ORDER_STATUS_LIST,
    // 没有「全部」：进页面默认看「待接单」，其余状态靠切换
    activeStatus: ORDER_STATUS.PENDING,
    activeText: '待接单',
    orders: [],
    total: 0,
    loading: true
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  load() {
    // 连续切换筛选时只认最后一次请求
    const seq = (this._seq = (this._seq || 0) + 1);
    const status = this.data.activeStatus;
    this.setData({ loading: true });

    return orderService
      .listOrders({ status })
      .then((res) => {
        if (seq !== this._seq) return;
        if (res.code !== 0) {
          this.setData({ loading: false, orders: [], total: 0 });
          wx.showToast({ title: res.message || '订单加载失败', icon: 'none' });
          return;
        }

        this.setData({
          orders: res.data.map((order) => this.decorate(order)),
          total: res.data.length,
          loading: false
        });
      })
      .catch(() => {
        if (seq !== this._seq) return;
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
      });
  },

  // 列表只展示摘要；完整明细进详情页，两边读同一份订单数据
  decorate(order) {
    const items = order.items || [];
    const firstName = items.length ? items[0].name : '示例订单';
    const extra = items.length > 1 ? ` 等 ${items.length} 款` : '';

    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      statusText: ORDER_STATUS_TEXT[order.status] || order.status,
      timeText: formatDateTime(order.createdAt),
      tableText: order.tableName
        ? `${order.tableName}${order.tableArea ? ' · ' + order.tableArea : ''}`
        : '未记录桌号',
      summary: `${firstName}${extra}`,
      totalQty: order.totalQty || 0,
      amountText: fenToYuan(order.totalAmount || 0)
    };
  },

  onFilterTap(event) {
    const status = event.currentTarget.dataset.status || '';
    if (status === this.data.activeStatus) return;

    // 只接受 4 个状态之一：空值不再表示「全部」，避免误回到不限状态的列表
    const hit = ORDER_STATUS_LIST.find((item) => item.value === status);
    if (!hit) return;

    this.setData({
      activeStatus: hit.value,
      activeText: hit.text,
      loading: true
    });
    this.load();
  },

  onOrderTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` });
  },

  onGoMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  }
});