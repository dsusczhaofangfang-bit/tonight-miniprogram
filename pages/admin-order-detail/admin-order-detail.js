const guard = require('../../utils/admin-guard');
const authService = require('../../services/auth');
const orderService = require('../../services/orders');
const { fenToYuan, formatDateTime } = require('../../utils/format');
const {
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_LOG_ACTOR,
  EXCEPTION_STATUS,
  EXCEPTION_STATUS_TEXT
} = require('../../utils/constants');

// 状态推进：待接单 → 制作中 → 已完成（与顾客端同一套状态机，不新增枚举）
const NEXT_STATUS = {
  pending: ORDER_STATUS.MAKING,
  making: ORDER_STATUS.COMPLETED
};

const NEXT_ACTION = {
  pending: { confirmText: '接单', title: '确认接单', content: '接单后订单进入「制作中」，顾客端会同步显示。' },
  making: { confirmText: '完成', title: '完成制作', content: '确认已出品，订单标记为「已完成」。' }
};

const PANEL_TEXT = {
  cancel: {
    title: '取消订单',
    confirm: '确认取消',
    placeholder: '请填写取消原因（会记录到状态记录）'
  },
  exception: {
    title: '标记异常',
    confirm: '提交异常',
    placeholder: '请填写异常原因，例如缺货、无法制作'
  },
  resolve: {
    title: '处理异常',
    confirm: '完成处理',
    placeholder: '请填写处理说明，例如已补货并重新出品'
  }
};

Page({
  data: {
    order: null,
    items: [],
    logs: [],
    statusText: '',
    nextStatusText: '',
    timeText: '',
    updatedText: '',
    totalText: '0.00',
    exception: null,
    exceptionText: '',
    canAdvance: false,
    canCancel: false,
    canMarkException: false,
    canResolveException: false,
    panel: '',
    panelTitle: '',
    panelConfirmText: '',
    panelPlaceholder: '',
    reason: '',
    reasonMax: 100,
    quickReasons: ['缺货', '无法制作', '顾客要求', '其他'],
    acting: false,
    loading: true,
    error: '',
    session: null
  },

  onLoad(options) {
    this.orderId = (options && options.id) || '';
    guard.ensureOwner(this).then((ok) => {
      if (ok) this.load();
    });
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
        const next = NEXT_STATUS[order.status] || '';
        const exception = order.exception || null;
        const open = Boolean(exception && exception.status === EXCEPTION_STATUS.OPEN);
        const active = order.status === ORDER_STATUS.PENDING || order.status === ORDER_STATUS.MAKING;

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
          nextStatusText: next ? ORDER_STATUS_TEXT[next] : '',
          timeText: formatDateTime(order.createdAt),
          updatedText: formatDateTime(order.updatedAt),
          totalText: fenToYuan(order.totalAmount),
          exception,
          exceptionText: exception ? EXCEPTION_STATUS_TEXT[exception.status] || '' : '',
          canAdvance: Boolean(next),
          canCancel: active,
          canMarkException: active && !open,
          canResolveException: open,
          loading: false,
          error: ''
        });

        wx.setNavigationBarTitle({ title: `订单 ${order.orderNo}` });
      })
      .catch(() => {
        this.setData({ loading: false, error: '加载失败，请返回重试' });
      });
  },

  // 推进状态：老板操作，写 by: 'owner'
  onAdvance() {
    const next = NEXT_STATUS[this.data.order && this.data.order.status];
    if (!next || this.data.acting) return;

    const action = NEXT_ACTION[this.data.order.status];

    wx.showModal({
      title: action.title,
      content: action.content,
      confirmText: action.confirmText,
      confirmColor: '#D9A45B',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ acting: true });
        orderService
          .updateOrderStatus(this.orderId, next, 'owner')
          .then((result) => {
            this.setData({ acting: false });
            if (result.code !== 0) {
              wx.showToast({ title: result.message || '操作失败', icon: 'none' });
              this.load();
              return;
            }
            wx.showToast({ title: `已更新为${ORDER_STATUS_TEXT[next]}`, icon: 'none' });
            this.load();
          })
          .catch(() => {
            this.setData({ acting: false });
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
          });
      }
    });
  },

  openPanel(kind) {
    const text = PANEL_TEXT[kind];
    if (!text) return;
    const same = this.data.panel === kind;
    this.setData({
      panel: same ? '' : kind,
      panelTitle: text.title,
      panelConfirmText: text.confirm,
      panelPlaceholder: text.placeholder,
      reason: ''
    });
  },

  onClosePanel() {
    this.setData({ panel: '', reason: '' });
  },

  onOpenCancel() {
    this.openPanel('cancel');
  },

  onOpenException() {
    this.openPanel('exception');
  },

  onOpenResolve() {
    this.openPanel('resolve');
  },

  onQuickReason(event) {
    const reason = event.currentTarget.dataset.reason || '';
    this.setData({ reason });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  onSubmitPanel() {
    if (this.data.acting) return;
    const panel = this.data.panel;
    const reason = String(this.data.reason || '').trim();
    if (!reason) {
      wx.showToast({ title: panel === 'resolve' ? '请填写处理说明' : '请填写原因', icon: 'none' });
      return;
    }

    let request = null;
    if (panel === 'cancel') {
      request = orderService.cancelOrder(this.orderId, { by: 'owner', reason });
    } else if (panel === 'exception') {
      request = orderService.markOrderException(this.orderId, { reason, by: 'owner' });
    } else if (panel === 'resolve') {
      request = orderService.resolveOrderException(this.orderId, { resolution: reason, by: 'owner' });
    }
    if (!request) return;

    this.setData({ acting: true });
    request
      .then((res) => {
        this.setData({ acting: false });
        if (res.code !== 0) {
          wx.showToast({ title: res.message || '操作失败', icon: 'none' });
          return;
        }
        const tips = { cancel: '订单已取消', exception: '已标记异常', resolve: '异常已处理' };
        wx.showToast({ title: tips[panel] || '已完成', icon: 'none' });
        this.setData({ panel: '', reason: '' });
        this.load();
      })
      .catch(() => {
        this.setData({ acting: false });
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      });
  },

  onBackToList() {
    wx.redirectTo({ url: '/pages/admin-orders/admin-orders' });
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