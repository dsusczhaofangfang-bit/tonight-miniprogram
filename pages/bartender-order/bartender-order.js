const guard = require('../../utils/bartender-guard');
const authService = require('../../services/auth');
const orderService = require('../../services/orders');
const { formatDateTime, formatTime } = require('../../utils/format');
const {
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_LOG_ACTOR,
  EXCEPTION_STATUS
} = require('../../utils/constants');

// 调酒师能做的只有「接单 / 制作完成」；取消订单、处理异常由老板完成
const NEXT_ACTION = {
  pending: { next: ORDER_STATUS.MAKING, text: '确认接单', success: '接单成功' },
  making: { next: ORDER_STATUS.COMPLETED, text: '制作完成', success: '已制作完成' }
};

Page({
  data: {
    session: null,
    order: null,
    items: [],
    logs: [],
    statusText: '',
    orderNo: '',
    tableText: '',
    timeText: '',
    totalQty: 0,
    remark: '',
    exception: null,
    exceptionText: '',
    exceptionByText: '',
    exceptionTimeText: '',
    canAdvance: false,
    nextStatus: '',
    nextActionText: '',
    canSubmitException: false,
    panel: false,
    reason: '',
    reasonMax: 100,
    quickReasons: ['缺货', '无法制作', '酒具不足', '其他'],
    acting: false,
    loading: true,
    error: ''
  },

  onLoad(options) {
    this.orderId = (options && options.id) || '';
    this._destroyed = false;
    guard.ensureBartender(this).then((ok) => {
      if (ok && !this._destroyed) this.load();
    });
  },

  onUnload() {
    this._destroyed = true;
  },

  onShow() {
    // 从后台切回时刷新，避免展示过期状态
    if (this.data.session && !this.data.loading) this.load();
  },

  onPullDownRefresh() {
    this.load()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  load() {
    if (this._destroyed) return Promise.resolve();
    if (!this.orderId) {
      this.setData({ loading: false, error: '缺少订单参数' });
      return Promise.resolve();
    }

    return orderService
      .getOrder(this.orderId)
      .then((res) => {
        if (this._destroyed) return;
        if (res.code !== 0) {
          this.setData({ loading: false, order: null, error: res.message || '订单不存在' });
          return;
        }

        const order = res.data;
        const action = NEXT_ACTION[order.status] || null;
        const exception = order.exception || null;

        this.setData({
          order,
          items: (order.items || []).map((item) => ({
            productId: item.productId,
            name: item.name,
            nameEn: item.nameEn || '',
            qty: item.qty
          })),
          logs: (order.statusLogs || []).map((log, index) => ({
            key: `${index}-${log.at}`,
            statusText: ORDER_STATUS_TEXT[log.status] || log.status,
            timeText: formatDateTime(log.at),
            actorText: ORDER_LOG_ACTOR[log.by] || '系统',
            note: log.note || ''
          })),
          statusText: ORDER_STATUS_TEXT[order.status] || order.status,
          orderNo: order.orderNo,
          tableText: order.tableName
            ? `${order.tableName}${order.tableArea ? ' · ' + order.tableArea : ''}`
            : '未记录桌号',
          timeText: formatDateTime(order.createdAt),
          totalQty: order.totalQty || 0,
          remark: order.remark || '',
          exception,
          exceptionText: exception
            ? `${exception.reason}${exception.note ? `（${exception.note}）` : ''}`
            : '',
          exceptionByText: exception ? ORDER_LOG_ACTOR[exception.by] || '店员' : '',
          exceptionTimeText: exception ? formatTime(exception.createdAt) : '',
          canAdvance: Boolean(action),
          nextStatus: action ? action.next : '',
          nextActionText: action ? action.text : '',
          canSubmitException:
            (order.status === ORDER_STATUS.PENDING || order.status === ORDER_STATUS.MAKING) &&
            !(exception && exception.status === EXCEPTION_STATUS.OPEN),
          loading: false,
          error: ''
        });

        wx.setNavigationBarTitle({ title: `订单 ${order.orderNo}` });
      })
      .catch(() => {
        if (this._destroyed) return;
        this.setData({ loading: false, error: '加载失败，请返回重试' });
      });
  },

  // 推进状态：带期望状态，若顾客/老板已改单则拒绝并刷新
  onAdvance() {
    if (!this.data.canAdvance || this.data.acting) return;

    const action = NEXT_ACTION[this.data.order.status];
    if (!action) return;

    wx.showModal({
      title: action.text,
      content:
        action.next === ORDER_STATUS.MAKING
          ? '接单后订单进入「制作中」，顾客端与老板端会同步。'
          : '确认已出品，订单标记为「已完成」，进入历史记录。',
      confirmText: action.text,
      confirmColor: '#D9A45B',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ acting: true });
        orderService
          .updateOrderStatus(this.orderId, action.next, 'bartender', this.data.order.status)
          .then((result) => {
            this.setData({ acting: false });
            if (result.code !== 0) {
              wx.showToast({ title: result.message || '操作失败', icon: 'none' });
              this.load();
              return;
            }
            wx.showToast({ title: action.success, icon: 'none' });
            this.load();
          })
          .catch(() => {
            this.setData({ acting: false });
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
          });
      }
    });
  },

  onOpenException() {
    if (!this.data.canSubmitException) return;
    this.setData({ panel: true, reason: '' });
  },

  onClosePanel() {
    this.setData({ panel: false, reason: '' });
  },

  // 面板内部点击不关闭（遮罩才关闭）
  noop() {},

  onQuickReason(event) {
    this.setData({ reason: event.currentTarget.dataset.reason || '' });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  // 调酒师只能提交异常说明；异常由老板处理，页面不提供「解除」
  onSubmitException() {
    if (this.data.acting) return;
    const reason = String(this.data.reason || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写异常原因', icon: 'none' });
      return;
    }

    this.setData({ acting: true });
    orderService
      .markOrderException(this.orderId, { reason, by: 'bartender' })
      .then((res) => {
        this.setData({ acting: false });
        if (res.code !== 0) {
          wx.showToast({ title: res.message || '提交失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已通知老板', icon: 'none' });
        this.setData({ panel: false, reason: '' });
        this.load();
      })
      .catch(() => {
        this.setData({ acting: false });
        wx.showToast({ title: '提交失败，请重试', icon: 'none' });
      });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({ url: '/pages/bartender-board/bartender-board' });
      }
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出工作台',
      content: '退出后需要重新输入调酒师口令。确定退出？',
      confirmColor: '#A32B41',
      success: (res) => {
        if (!res.confirm) return;
        authService.logout(authService.ROLES.BARTENDER).then(() => {
          wx.switchTab({ url: '/pages/home/home' });
        });
      }
    });
  }
});