const api = require('./api');
const storage = require('../utils/storage');
const format = require('../utils/format');
const tables = require('./tables');
const products = require('./products');
const {
  STORAGE_KEYS,
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_TRANSITIONS,
  PAY_STATUS,
  PAY_MODE
} = require('../utils/constants');

const HOUR = 60 * 60 * 1000;

function buildSeedOrders() {
  const now = Date.now();

  function makeOrder(config) {
    const createdAt = config.createdAt;
    return {
      id: config.id,
      orderNo: `${format.dateKey(createdAt)}-${String(config.seq).padStart(4, '0')}`,
      tableId: config.tableId,
      tableName: config.tableName,
      items: config.items,
      totalQty: config.items.reduce((sum, item) => sum + item.qty, 0),
      totalAmount: config.items.reduce((sum, item) => sum + item.price * item.qty, 0),
      status: config.status,
      payStatus: PAY_STATUS.MOCK_PAID,
      payMode: PAY_MODE.MOCK,
      remark: config.remark || '',
      createdAt,
      updatedAt: createdAt,
      statusLogs: config.logs || [{ status: ORDER_STATUS.PENDING, at: createdAt, by: 'customer' }]
    };
  }

  return [
    makeOrder({
      id: 'o_demo_001',
      seq: 1,
      tableId: 't_a1',
      tableName: 'A1',
      createdAt: now - 2 * HOUR,
      status: ORDER_STATUS.PENDING,
      items: [
        { productId: 'p_cocktail_01', name: '示例·鸡尾酒 01', nameEn: 'Demo Cocktail 01', price: 5800, qty: 2, subtotal: 11600 },
        { productId: 'p_snack_01', name: '示例·小食 01', nameEn: 'Demo Snack 01', price: 2800, qty: 1, subtotal: 2800 }
      ]
    }),
    makeOrder({
      id: 'o_demo_002',
      seq: 1,
      tableId: 't_b2',
      tableName: 'B2',
      createdAt: now - 26 * HOUR,
      status: ORDER_STATUS.COMPLETED,
      items: [
        { productId: 'p_whiskey_01', name: '示例·威士忌 01', nameEn: 'Demo Whiskey 01', price: 8800, qty: 1, subtotal: 8800 }
      ],
      logs: [
        { status: ORDER_STATUS.PENDING, at: now - 26 * HOUR, by: 'customer' },
        { status: ORDER_STATUS.ACCEPTED, at: now - 25.8 * HOUR, by: 'admin' },
        { status: ORDER_STATUS.MAKING, at: now - 25.7 * HOUR, by: 'admin' },
        { status: ORDER_STATUS.COMPLETED, at: now - 25 * HOUR, by: 'admin' }
      ]
    })
  ];
}

function loadAll() {
  let list = storage.get(STORAGE_KEYS.ORDERS, null);
  if (!Array.isArray(list)) {
    list = buildSeedOrders();
    storage.set(STORAGE_KEYS.ORDERS, list);
  }
  return list;
}

function saveAll(list) {
  storage.set(STORAGE_KEYS.ORDERS, list);
}

function nextOrderNo(createdAt) {
  const key = format.dateKey(createdAt);
  const count = loadAll().filter((item) => format.dateKey(item.createdAt) === key).length;
  return `${key}-${String(count + 1).padStart(4, '0')}`;
}

function createOrder(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const tableId = input.tableId;
  const remark = String(input.remark || '').trim().slice(0, 100);

  if (!items.length) return api.fail(4001, '购物车为空');
  if (!tableId) return api.fail(4002, '请选择桌号');

  const table = tables.getTableSync(tableId);
  if (!table || table.enabled === false) return api.fail(4003, '桌号不存在或已停用');

  const catalog = products.listAllSync();
  const normalized = [];
  let totalQty = 0;
  let totalAmount = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const product = catalog.find((p) => p.id === item.productId);
    if (!product || product.status !== 'on') {
      return api.fail(4004, `商品不可下单：${item.name || item.productId}`);
    }
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const subtotal = product.price * qty;
    normalized.push({
      productId: product.id,
      name: product.name,
      nameEn: product.nameEn,
      price: product.price,
      qty,
      subtotal
    });
    totalQty += qty;
    totalAmount += subtotal;
  }

  const createdAt = Date.now();
  const order = {
    id: api.nextId('o'),
    orderNo: nextOrderNo(createdAt),
    tableId: table.id,
    tableName: table.name,
    items: normalized,
    totalQty,
    totalAmount,
    status: ORDER_STATUS.PENDING,
    payStatus: PAY_STATUS.UNPAID,
    payMode: PAY_MODE.MOCK,
    remark,
    createdAt,
    updatedAt: createdAt,
    statusLogs: [{ status: ORDER_STATUS.PENDING, at: createdAt, by: 'customer' }]
  };

  const list = loadAll();
  list.push(order);
  saveAll(list);
  return api.success(api.clone(order));
}

// 模拟支付：只改变支付状态，不产生任何真实扣款
function markMockPaid(orderId) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === orderId);
  if (index < 0) return api.fail(4040, '订单不存在');

  const order = list[index];
  if (order.payStatus !== PAY_STATUS.UNPAID) {
    return api.fail(4005, '订单当前状态不可支付');
  }

  const updatedAt = Date.now();
  order.payStatus = PAY_STATUS.MOCK_PAID;
  order.paidAt = updatedAt;
  order.updatedAt = updatedAt;
  saveAll(list);
  return api.success(api.clone(order));
}

function updateOrderStatus(orderId, nextStatus, by = 'admin') {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === orderId);
  if (index < 0) return api.fail(4040, '订单不存在');

  const order = list[index];
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (allowed.indexOf(nextStatus) < 0) {
    return api.fail(
      4006,
      `订单状态不可从「${ORDER_STATUS_TEXT[order.status]}」变更为「${ORDER_STATUS_TEXT[nextStatus] || nextStatus}」`
    );
  }

  const updatedAt = Date.now();
  order.status = nextStatus;
  order.updatedAt = updatedAt;
  order.statusLogs = order.statusLogs || [];
  order.statusLogs.push({ status: nextStatus, at: updatedAt, by });
  saveAll(list);
  return api.success(api.clone(order));
}

function getOrder(orderId) {
  const order = loadAll().find((item) => item.id === orderId);
  return order ? api.success(api.clone(order)) : api.fail(4040, '订单不存在');
}

function listOrders(filter = {}) {
  const status = filter.status || '';
  let list = loadAll().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (status) list = list.filter((item) => item.status === status);
  return api.success(api.clone(list));
}

function adminListOrders(filter = {}) {
  const status = filter.status || '';
  const dateFrom = String(filter.dateFrom || '').replace(/-/g, '');
  const dateTo = String(filter.dateTo || '').replace(/-/g, '');
  const page = Math.max(1, parseInt(filter.page, 10) || 1);
  const pageSize = Math.max(1, parseInt(filter.pageSize, 10) || 20);
  const onlyPaid = filter.onlyPaid !== false;

  let list = loadAll().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (onlyPaid) list = list.filter((item) => item.payStatus === PAY_STATUS.MOCK_PAID);
  if (status) list = list.filter((item) => item.status === status);
  if (dateFrom) list = list.filter((item) => format.dateKey(item.createdAt) >= dateFrom);
  if (dateTo) list = list.filter((item) => format.dateKey(item.createdAt) <= dateTo);

  const total = list.length;
  const start = (page - 1) * pageSize;
  return api.success({
    list: api.clone(list.slice(start, start + pageSize)),
    total,
    page,
    pageSize
  });
}

module.exports = {
  createOrder,
  markMockPaid,
  updateOrderStatus,
  getOrder,
  listOrders,
  adminListOrders
};