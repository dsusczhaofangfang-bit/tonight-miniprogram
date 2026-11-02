// 本地存储键：统一在此维护，避免散落各页面
const STORAGE_KEYS = {
  CART: 'lm_cart',
  ORDERS: 'lm_orders',
  // 订单编号的按天序号：{ '20261102': 7 }
  ORDER_SEQ: 'lm_order_seq',
  ADMIN_SESSION: 'lm_admin_session',
  PRODUCTS: 'lm_products',
  CATEGORIES: 'lm_categories',
  TABLES: 'lm_tables',
  TABLE: 'lm_table',
  SEEN_WELCOME: 'lm_seen_welcome',
  // 调酒师会话与老板会话分开存：同一台设备可同时保持两种身份
  BARTENDER_SESSION: 'lm_bartender_session',
  // 调酒师工作台的本地偏好：声音开关、上次查看订单的时间（用于「新」角标）
  BARTENDER_SOUND: 'lm_bartender_sound',
  BARTENDER_SEEN_AT: 'lm_bartender_seen_at',
  // 种子版本：用于判断本地缓存是否需要用新的 mock-data 重建
  SEED_CATEGORIES: 'lm_seed_categories',
  SEED_PRODUCTS: 'lm_seed_products',
  SEED_TABLES: 'lm_seed_tables'
};

// 订单状态：待接单 → 制作中 → 已完成；待接单可取消（老板侧后续可在制作中取消）
const ORDER_STATUS = {
  PENDING: 'pending',
  MAKING: 'making',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const ORDER_STATUS_TEXT = {
  pending: '待接单',
  making: '制作中',
  completed: '已完成',
  cancelled: '已取消'
};

// 状态标签配色（status-tag 组件）
const ORDER_STATUS_TONE = {
  pending: 'amber',
  making: 'rose',
  completed: 'green',
  cancelled: 'muted'
};

// 订单列表筛选：顺序即页面展示顺序。
// 不设「全部」：顾客端只按 4 个状态逐项查看，进页面默认落在「待接单」；
// 需要不带状态的全量列表时由调用方传空 status（服务层仍支持，后台/统计用）。
const ORDER_STATUS_LIST = [
  { value: 'pending', text: '待接单' },
  { value: 'making', text: '制作中' },
  { value: 'completed', text: '已完成' },
  { value: 'cancelled', text: '已取消' }
];

// 调酒师工作台只看待接单/制作中/已完成。已取消仍留在老板端与顾客端可查，
// 不进工作台，避免调酒师误删/误处理取消单。
const WORKBENCH_STATUS_LIST = [
  { value: 'pending', text: '待接单' },
  { value: 'making', text: '制作中' },
  { value: 'completed', text: '已完成' }
];

// 状态机：只能前进，不可回退；顾客侧只在「待接单」可取消
const ORDER_TRANSITIONS = {
  pending: ['making', 'cancelled'],
  making: ['completed'],
  completed: [],
  cancelled: []
};

// 状态记录里的操作人（by）
// owner 为老板管理端；admin 是第五阶段演示推进用过的旧值，保留兼容旧数据
const ORDER_LOG_ACTOR = {
  customer: '顾客',
  owner: '老板',
  bartender: '调酒师',
  admin: '店员',
  demo: '演示',
  system: '系统'
};

// 订单异常（旁挂标记，不占用状态枚举）：
// 调酒师/老板可标记，老板负责解除；订单本身仍走 pending/making/completed/cancelled
const EXCEPTION_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved'
};

const EXCEPTION_STATUS_TEXT = {
  open: '异常待处理',
  resolved: '异常已处理'
};

// 支付状态：本阶段不涉及支付，下单后保持未支付；M5 接入真实支付后再流转
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
  ORDER_STATUS_TONE,
  ORDER_STATUS_LIST,
  WORKBENCH_STATUS_LIST,
  ORDER_TRANSITIONS,
  ORDER_LOG_ACTOR,
  EXCEPTION_STATUS,
  EXCEPTION_STATUS_TEXT,
  PAY_STATUS,
  PAY_STATUS_TEXT,
  PAY_MODE
};