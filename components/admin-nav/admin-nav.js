Component({
  properties: {
    active: { type: String, value: 'overview' }
  },

  data: {
    // 管理端独立导航：不进原生 tabBar（顾客端 4 个 Tab 固定不动）
    items: [
      { key: 'overview', text: '概览', url: '/pages/admin-overview/admin-overview' },
      { key: 'orders', text: '订单', url: '/pages/admin-orders/admin-orders' },
      { key: 'products', text: '商品', url: '/pages/admin-products/admin-products' }
    ]
  },

  methods: {
    // 用 redirectTo 切页，管理端栈深保持 1 层，返回直接回顾客端
    onTap(event) {
      const key = event.currentTarget.dataset.key;
      if (!key || key === this.data.active) return;
      const target = this.data.items.find((item) => item.key === key);
      if (!target) return;
      wx.redirectTo({ url: target.url });
    }
  }
});