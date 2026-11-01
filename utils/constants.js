// 本地存储键：统一在此维护，避免散落各页面
const STORAGE_KEYS = {
  CART: 'lm_cart',
  ORDERS: 'lm_orders',
  ADMIN_SESSION: 'lm_admin_session',
  PRODUCTS: 'lm_products',
  CATEGORIES: 'lm_categories',
  TABLES: 'lm_tables',
  SEEN_WELCOME: 'lm_seen_welcome'
};

// 订单状态
const ORDER_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  MAKING: 'making',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const ORDER_STATUS_TEXT = {
  pending: '待接单',
  accepted: '已接单',
  making: '制作中',
  completed: '已完成',
  cancelled: '已取消'
};

// 状态机：只能前进，不可回退；pending 允许管理员取消
const ORDER_TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['making'],
  making: ['completed'],
  completed: [],
  cancelled: []
};

// 支付状态
const PAY_STATUS = {
  UNPAID: 'unpaid',
  MOCK_PAID: 'mock_paid',
  PAID: 'paid'
};

const PAY_STATUS_TEXT = {
  unpaid: '未支付',
  mock_paid: '已模拟支付',
  paid: '已支付'
};

const PAY_MODE = {
  MOCK: 'mock',
  WECHAT: 'wechat'
};

module.exports = {
  STORAGE_KEYS,
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_TRANSITIONS,
  PAY_STATUS,
  PAY_STATUS_TEXT,
  PAY_MODE
};