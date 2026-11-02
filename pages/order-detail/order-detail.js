const orderService = require('../../services/orders');
const config = require('../../config/index');
const { fenToYuan, formatDateTime } = require('../../utils/format');
const {
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_LOG_ACTOR
} = require('../../utils/constants');

// 演示推进：待接单 → 制作中 → 已完成（M3 换成老板后台真实操作）
const NEXT_STATUS = {
  pending: ORDER_STATUS.MAKING,
  making: ORDER_STATUS.COMPLETED
};

Page({
  data: {
    order: null,
    items: [],
    logs: [],
    statusText: '',
    timeText: '',
    totalText: '0.00',
    canCancel: false,
    nextStatus: '',
    nextStatusText: '',
    demoMode: config.demoMode,
    loading: true,
    error: ''
  },

  onLoad(options) {
    this.orderId = (options && options.id) || '';
    this.load();
  },

  load() {
    if (!this.orderId) {
      this.setData({ loading: false, error: '缺少订单参数' });
      return Promise.resolve();
    }

    return orderService
      .getOrder(this.orderId)
      .then((res) => {
        if (res.code !== 0) {
          this.setData({ loading: false, order: null, error: res.message || '订单不存在' });
          return;
        }

        const order = res.data;
        const nextStatus = NEXT_STATUS[order.status] || '';

        this.setData({
          order,
          items: (order.items || []).map((item) =>
            Object.assign({}, item, {
              priceText: fenToYuan(item.price),
              subtotalText: fenToYuan(item.subtotal)
            })
          ),
          logs: (order.statusLogs || []).map((log, index) => ({
            key: `${index}-${log.at}`,
            statusText: ORDER_STATUS_TEXT[log.status] || log.status,
            timeText: formatDateTime(log.at),
            actorText: ORDER_LOG_ACTOR[log.by] || '系统',
            note: log.note || ''
          })),
          statusText: ORDER_STATUS_TEXT[order.status] || order.status,
          timeText: formatDateTime(order.createdAt),
          totalText: fenToYuan(order.totalAmount),
          canCancel: order.status === ORDER_STATUS.PENDING,
          nextStatus,
          nextStatusText: nextStatus ? ORDER_STATUS_TEXT[nextStatus] : '',
          loading: false,
          error: ''
        });

        wx.setNavigationBarTitle({ title: `订单 ${order.orderNo}` });
      })
      .catch(() => {
        this.setData({ loading: false, error: '加载失败，请返回重试' });
      });
  },

  // 顾客取消：只在待接单开放，二次确认
  onCancel() {
    if (!this.data.canCancel) return;

    wx.showModal({
      title: '取消订单',
      content: '取消后订单不可恢复，确定取消这一单吗？',
      confirmText: '取消订单',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        orderService.cancelOrder(this.orderId, { by: 'customer' }).then((result) => {
          if (result.code !== 0) {
            wx.showToast({ title: result.message || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '订单已取消', icon: 'none' });
          this.load();
        });
      }
    });
  },

  // 演示用：模拟店员推进状态，界面上已明确标注
  onAdvance() {
    if (!this.data.nextStatus) return;
    const nextText = this.data.nextStatusText;

    wx.showModal({
      title: '演示：推进状态',
      content: `将订单状态改为「${nextText}」。仅用于演示流转，不代表真实店员操作。`,
      confirmColor: '#D9A45B',
      success: (res) => {
        if (!res.confirm) return;
        orderService.updateOrderStatus(this.orderId, this.data.nextStatus, 'demo').then((result) => {
          if (result.code !== 0) {
            wx.showToast({ title: result.message || '操作失败', icon: 'none' });
            return;
          }
          this.load();
        });
      }
    });
  },

  onViewAll() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  onGoMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  }
});