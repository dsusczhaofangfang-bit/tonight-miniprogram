const guard = require('../../utils/bartender-guard');
const authService = require('../../services/auth');
const orderService = require('../../services/orders');
const feedFactory = require('../../services/order-feed');
const config = require('../../config/index');
const storage = require('../../utils/storage');
const { formatDateTime, formatTime } = require('../../utils/format');
const {
  STORAGE_KEYS,
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  WORKBENCH_STATUS_LIST
} = require('../../utils/constants');

// 卡片上的快捷操作：只允许向前推进，取消与异常处理不在这里
const ACTION_BY_STATUS = {
  pending: { next: ORDER_STATUS.MAKING, text: '接单' },
  making: { next: ORDER_STATUS.COMPLETED, text: '制作完成' }
};

function buildFilters(counts) {
  return WORKBENCH_STATUS_LIST.map((item) => ({
    value: item.value,
    text: item.text,
    count: counts[item.value] || 0
  }));
}

Page({
  data: {
    session: null,
    roleText: '调酒师',
    // 模拟实时：页面常驻标注，不写成真实推送
    mockFeed: true,
    online: true,
    intervalText: '5 秒',
    lastUpdatedText: '—',
    soundOn: true,
    filters: buildFilters({}),
    activeStatus: ORDER_STATUS.PENDING,
    activeText: '待接单',
    sort: 'asc',
    sortText: '先到先做',
    keyword: '',
    orders: [],
    total: 0,
    newCount: 0,
    loading: true,
    acting: false,
    error: ''
  },

  onLoad() {
    // 已见订单 id：用于区分「这次轮询新到的单」，避免首屏把所有历史单都当新单
    this._knownIds = {};
    this._newIds = {};
    this._firstLoad = true;
    this._destroyed = false;
    this._seq = 0;
    this._searchTimer = null;
    this._feed = null;
    this._audio = null;
    this._interval = Math.max(1000, Number(config.orderFeedIntervalMs) || 5000);
    this._seenAt = Number(storage.get(STORAGE_KEYS.BARTENDER_SEEN_AT, 0)) || 0;

    this.setData({ intervalText: `${Math.round(this._interval / 1000)} 秒` });

    guard.ensureBartender(this).then((ok) => {
      if (!ok) return;
      this.setData({ soundOn: this.readSoundPreference() });
      this.initAudio();
      this.initNetwork();
      // 先完成首屏加载再启动轮询：否则轮询的首个 tick 会把种子订单误判成「新单」
      this.load({ first: true }).then(() => this.startFeed());
    });
  },

  onShow() {
    if (!this.data.session) return;
    this.load({ silent: true }).then(() => this.startFeed());
  },

  // 离开页面停止轮询，避免后台空跑；同时记住「看到这里的时间」，下次回来据此标新单
  onHide() {
    this.stopFeed();
    this.markSeen();
  },

  onUnload() {
    this._destroyed = true;
    this.stopFeed();
    this.markSeen();
    this.destroyAudio();
    this.unbindNetwork();
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
  },

  onPullDownRefresh() {
    this.load({ silent: true })
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  // ---------- 轮询与连接状态 ----------

  startFeed() {
    if (this._destroyed) return;
    if (!this._feed) {
      this._feed = feedFactory.createOrderFeed({
        intervalMs: this._interval,
        onPoll: () => this.load({ poll: true }),
        onError: () => this.setData({ online: false })
      });
    }
    this._feed.start();
  },

  stopFeed() {
    if (this._feed) this._feed.stop();
  },

  initNetwork() {
    try {
      wx.getNetworkType({
        success: (res) => this.setData({ online: res.networkType !== 'none' })
      });
      this._netHandler = (res) => {
        const online = Boolean(res.isConnected);
        this.setData({ online });
        if (online) {
          // 恢复网络先补拉一次，再继续轮询
          this.load({ silent: true }).then(() => this.startFeed());
        } else {
          this.stopFeed();
        }
      };
      wx.onNetworkStatusChange(this._netHandler);
    } catch (error) {
      // 取不到网络状态时按在线处理，轮询失败会由 onError 置为离线
    }
  },

  unbindNetwork() {
    if (this._netHandler && typeof wx.offNetworkStatusChange === 'function') {
      wx.offNetworkStatusChange(this._netHandler);
      this._netHandler = null;
    }
  },

  // ---------- 提示音 ----------

  initAudio() {
    try {
      this._audio = wx.createInnerAudioContext();
      this._audio.src = '/assets/sounds/order-alert.wav';
      this._audio.loop = false;
    } catch (error) {
      this._audio = null;
    }
  },

  destroyAudio() {
    if (this._audio) {
      try {
        this._audio.destroy();
      } catch (error) {
        // 销毁失败不影响页面
      }
      this._audio = null;
    }
  },

  readSoundPreference() {
    const saved = storage.get(STORAGE_KEYS.BARTENDER_SOUND, null);
    return saved === false ? false : true;
  },

  onSoundChange(event) {
    const soundOn = Boolean(event.detail.value);
    storage.set(STORAGE_KEYS.BARTENDER_SOUND, soundOn);
    this.setData({ soundOn });
  },

  playAlert() {
    if (!this.data.soundOn || !this._audio) return;
    try {
      this._audio.stop();
      this._audio.play();
    } catch (error) {
      // 静音/系统限制时静默降级为视觉提醒
    }
  },

  vibrate() {
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (error) {
      // 部分机型不支持震动，忽略
    }
  },

  markSeen() {
    const at = Date.now();
    this._seenAt = at;
    storage.set(STORAGE_KEYS.BARTENDER_SEEN_AT, at);
  },

  // ---------- 数据加载 ----------

  load(options = {}) {
    if (this._destroyed) return Promise.resolve();
    const seq = (this._seq = (this._seq || 0) + 1);
    const first = Boolean(options.first);
    if (first) this.setData({ loading: true });

    return Promise.all([
      orderService.listWorkbenchOrders({
        status: this.data.activeStatus,
        keyword: this.data.keyword,
        sort: this.data.sort,
        pageSize: 100
      }),
      orderService.adminOrderCounts(),
      // 新单识别不受当前筛选影响：始终比对「待接单」全集
      orderService.listPendingOrders()
    ])
      .then(([listRes, countRes, pendingRes]) => {
        if (seq !== this._seq || this._destroyed) return;

        if (listRes.code !== 0) {
          this.setData({ loading: false });
          wx.showToast({ title: listRes.message || '订单加载失败', icon: 'none' });
          return;
        }

        if (pendingRes.code === 0) this.detectNew(pendingRes.data, first);

        const counts = countRes.code === 0 ? countRes.data : {};
        const orders = listRes.data.list.map((order) => this.decorate(order));

        const patch = {
          orders,
          total: listRes.data.total,
          filters: buildFilters(counts),
          activeText: (WORKBENCH_STATUS_LIST.find((item) => item.value === this.data.activeStatus) || {}).text || '',
          newCount: this.countNew(),
          loading: false,
          online: true,
          lastUpdatedText: formatTime(Date.now()),
          error: ''
        };
        this.setData(patch);
        this._firstLoad = false;
      })
      .catch(() => {
        if (seq !== this._seq || this._destroyed) return;
        this.setData({ loading: false, online: false });
        wx.showToast({ title: '加载失败，稍后自动重试', icon: 'none' });
      });
  },

  // 新单：只认「待接单」里没见过的 id；首屏不提醒，之后每轮到达才提醒
  detectNew(pendingList, first) {
    const arriving = [];

    pendingList.forEach((item) => {
      if (this._knownIds[item.id]) return;
      this._knownIds[item.id] = true;
      if (!first) {
        this._newIds[item.id] = true;
        arriving.push(item);
      }
    });

    // 已离开待接单的单不再算「新」
    const stillPending = {};
    pendingList.forEach((item) => {
      stillPending[item.id] = true;
    });
    Object.keys(this._newIds).forEach((id) => {
      if (!stillPending[id]) delete this._newIds[id];
    });

    if (arriving.length && !first) {
      this.playAlert();
      this.vibrate();
    }
  },

  countNew() {
    return Object.keys(this._newIds).length;
  },

  decorate(order) {
    const action = ACTION_BY_STATUS[order.status] || null;
    const exception = order.exception || null;
    const isNew =
      Boolean(this._newIds[order.id]) ||
      (this._seenAt > 0 && order.status === ORDER_STATUS.PENDING && order.createdAt > this._seenAt);

    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      statusText: ORDER_STATUS_TEXT[order.status] || order.status,
      tableName: order.tableName || '—',
      tableArea: order.tableArea || '',
      timeText: formatDateTime(order.createdAt),
      totalQty: order.totalQty || 0,
      items: (order.items || []).map((item) => ({
        productId: item.productId,
        name: item.name,
        qty: item.qty
      })),
      remark: order.remark || '',
      exceptionText:
        exception && exception.status === 'open' ? `异常待处理：${exception.reason}` : '',
      isNew,
      actionText: action ? action.text : '',
      actionNext: action ? action.next : ''
    };
  },

  // ---------- 交互 ----------

  onFilterTap(event) {
    const status = event.currentTarget.dataset.status || '';
    if (status === this.data.activeStatus) return;
    if (!WORKBENCH_STATUS_LIST.some((item) => item.value === status)) return;

    this.setData({ activeStatus: status, loading: true });
    this.load({ silent: true });
  },

  onToggleSort() {
    const sort = this.data.sort === 'asc' ? 'desc' : 'asc';
    this.setData({ sort, sortText: sort === 'asc' ? '先到先做' : '最新在前' });
    this.load({ silent: true });
  },

  onKeywordInput(event) {
    const keyword = event.detail.value || '';
    this.setData({ keyword });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.load({ silent: true });
    }, 300);
  },

  onSearchConfirm() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.load({ silent: true });
  },

  onClearKeyword() {
    if (!this.data.keyword) return;
    this.setData({ keyword: '' });
    this.load({ silent: true });
  },

  onNewBannerTap() {
    this._newIds = {};
    this.markSeen();
    this.setData({
      activeStatus: ORDER_STATUS.PENDING,
      keyword: '',
      newCount: 0,
      loading: true
    });
    this.load({ silent: true });
  },

  onOrderTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    if (this._newIds[id]) {
      delete this._newIds[id];
      this.setData({ newCount: this.countNew() });
    }
    this.markSeen();
    wx.navigateTo({ url: `/pages/bartender-order/bartender-order?id=${id}` });
  },

  // 快捷操作：带期望状态，遇到别端已改单会拒绝并刷新
  onQuickAction(event) {
    const { id, next, status } = event.currentTarget.dataset;
    if (!id || !next || this.data.acting) return;

    this.setData({ acting: true });
    orderService
      .updateOrderStatus(id, next, 'bartender', status)
      .then((res) => {
        this.setData({ acting: false });
        if (res.code !== 0) {
          wx.showToast({ title: res.message || '操作失败', icon: 'none' });
          this.load({ silent: true });
          return;
        }
        if (this._newIds[id]) delete this._newIds[id];
        wx.showToast({
          title: next === ORDER_STATUS.MAKING ? '接单成功' : '已制作完成',
          icon: 'none'
        });
        this.load({ silent: true });
      })
      .catch(() => {
        this.setData({ acting: false });
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      });
  },

  onBackToCustomer() {
    wx.switchTab({ url: '/pages/home/home' });
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
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: '/pages/home/home' });
      }
    });
  }
});