const api = require('./api');
const storage = require('../utils/storage');
const format = require('../utils/format');
const tables = require('./tables');
const products = require('./products');
const categories = require('./categories');
const {
  STORAGE_KEYS,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
  EXCEPTION_STATUS,
  PAY_STATUS,
  PAY_MODE
} = require('../utils/constants');

const HOUR = 60 * 60 * 1000;
const MAX_QTY = 99;
const REMARK_MAX = 100;

// 旧版本状态 → 当前状态（历史本地订单自动迁移，不丢数据）
const LEGACY_STATUS_MAP = {
  accepted: ORDER_STATUS.MAKING,
  ready: ORDER_STATUS.COMPLETED
};

// ---------- 演示订单种子：首次运行或「重置演示数据」后生成 ----------

function seedItem(productId, name, nameEn, category, categoryName, price, qty) {
  return {
    productId,
    name,
    nameEn,
    category,
    categoryName,
    // 本阶段没有真实商品图：留空，页面显示酒标占位块
    image: '',
    price,
    qty,
    subtotal: price * qty
  };
}

function makeOrder(config) {
  const items = config.items || [];
  const createdAt = config.createdAt;
  const logs = config.logs || [{ status: ORDER_STATUS.PENDING, at: createdAt, by: 'customer' }];

  return {
    id: config.id,
    // 订单编号：按天序号，含日期，便于老板口头核对
    orderNo: `${format.dateKey(createdAt)}-${String(config.seq).padStart(4, '0')}`,
    tableId: config.tableId,
    tableName: config.tableName,
    tableArea: config.tableArea || '',
    items,
    totalQty: items.reduce((sum, item) => sum + item.qty, 0),
    totalAmount: items.reduce((sum, item) => sum + item.subtotal, 0),
    status: config.status,
    payStatus: PAY_STATUS.UNPAID,
    payMode: PAY_MODE.MOCK,
    remark: config.remark || '',
    // 异常为旁挂标记，不占用订单状态枚举（缺货/无法制作等由老板处理）
    exception: null,
    createdAt,
    updatedAt: logs[logs.length - 1].at,
    statusLogs: logs
  };
}

function buildSeedOrders() {
  const now = Date.now();

  return [
    // 1. 待接单（今天 2 小时前）：用于验证「取消订单」与「推进到制作中」
    makeOrder({
      id: 'o_demo_001',
      seq: 1,
      tableId: 't_a1',
      tableName: 'A1',
      tableArea: '吧台区',
      createdAt: now - 2 * HOUR,
      status: ORDER_STATUS.PENDING,
      items: [
        seedItem('p_traditional_01', '示例·传统饮品 01', 'Demo Classics 01', 'traditional', '传统饮品', 5800, 2),
        seedItem('p_snacks_01', '示例·小吃 01', 'Demo Snacks 01', 'snacks', '小吃', 2800, 1)
      ]
    }),
    // 2. 已取消（今天 3 小时前）：顾客在待接单时自行取消
    makeOrder({
      id: 'o_demo_002',
      seq: 2,
      tableId: 't_b1',
      tableName: 'B1',
      tableArea: '散座区',
      createdAt: now - 3 * HOUR,
      status: ORDER_STATUS.CANCELLED,
      remark: '临时有事，先取消',
      items: [
        seedItem('p_signature_01', '示例·特调饮品 01', 'Demo Signature 01', 'signature', '特调饮品', 6800, 1)
      ],
      logs: [
        { status: ORDER_STATUS.PENDING, at: now - 3 * HOUR, by: 'customer' },
        { status: ORDER_STATUS.CANCELLED, at: now - 2.9 * HOUR, by: 'customer', note: '顾客取消' }
      ]
    }),
    // 3. 制作中（今天 50 分钟前）：用于验证「推进到已完成」
    makeOrder({
      id: 'o_demo_003',
      seq: 3,
      tableId: 't_b2',
      tableName: 'B2',
      tableArea: '散座区',
      createdAt: now - 50 * 60 * 1000,
      status: ORDER_STATUS.MAKING,
      remark: '少冰，谢谢',
      items: [
        seedItem('p_signature_03', '示例·特调饮品 03', 'Demo Signature 03', 'signature', '特调饮品', 8800, 1),
        seedItem('p_non_alcoholic_02', '示例·无酒精饮品 02', 'Demo Non-alcoholic 02', 'non_alcoholic', '无酒精饮品', 3600, 2)
      ],
      logs: [
        { status: ORDER_STATUS.PENDING, at: now - 50 * 60 * 1000, by: 'customer' },
        { status: ORDER_STATUS.MAKING, at: now - 40 * 60 * 1000, by: 'admin' }
      ]
    }),
    // 4. 已完成（昨天）：验证跨天列表与历史订单快照
    makeOrder({
      id: 'o_demo_004',
      seq: 1,
      tableId: 't_a3',
      tableName: 'A3',
      tableArea: '吧台区',
      createdAt: now - 26 * HOUR,
      status: ORDER_STATUS.COMPLETED,
      items: [
        seedItem('p_traditional_05', '示例·传统饮品 05', 'Demo Classics 05', 'traditional', '传统饮品', 8800, 1)
      ],
      logs: [
        { status: ORDER_STATUS.PENDING, at: now - 26 * HOUR, by: 'customer' },
        { status: ORDER_STATUS.MAKING, at: now - 25.8 * HOUR, by: 'admin' },
        { status: ORDER_STATUS.COMPLETED, at: now - 25 * HOUR, by: 'admin' }
      ]
    })
  ];
}

// ---------- 读写与迁移 ----------

function saveAll(list) {
  storage.set(STORAGE_KEYS.ORDERS, list);
}

// 补齐旧订单缺失的字段：分类名、图片、小计；并迁移旧状态
function migrate(list) {
  const productById = {};
  products.listAllSync().forEach((item) => {
    productById[item.id] = item;
  });

  const nameById = {};
  categories.listAllSync().forEach((item) => {
    nameById[item.id] = item.name;
  });

  let changed = false;

  list.forEach((order) => {
    if (!order || typeof order !== 'object') return;

    const legacyStatus = LEGACY_STATUS_MAP[order.status];
    if (legacyStatus) {
      const at = order.updatedAt || order.createdAt || Date.now();
      order.status = legacyStatus;
      order.updatedAt = at;
      order.statusLogs = order.statusLogs || [];
      order.statusLogs.push({ status: legacyStatus, at, by: 'system', note: '旧版本状态迁移' });
      changed = true;
    }

    (order.items || []).forEach((item) => {
      const product = productById[item.productId];

      if (!Object.prototype.hasOwnProperty.call(item, 'category')) {
        item.category = product ? product.category : '';
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'categoryName')) {
        item.categoryName = nameById[item.category] || '';
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'image')) {
        item.image = product ? product.image || '' : '';
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'subtotal')) {
        item.subtotal = (Number(item.price) || 0) * (Number(item.qty) || 0);
        changed = true;
      }
    });
  });

  return changed;
}

function loadAll() {
  let list = storage.get(STORAGE_KEYS.ORDERS, null);

  if (!Array.isArray(list) || list.length === 0) {
    list = buildSeedOrders();
    saveAll(list);
    return list;
  }

  if (migrate(list)) saveAll(list);
  return list;
}

// ---------- 订单编号 ----------

// 按天自增且查重：删除订单或历史数据异常时也不会重号
function nextOrderNo(createdAt) {
  const key = format.dateKey(createdAt);
  const seqMap = storage.get(STORAGE_KEYS.ORDER_SEQ, null);
  const map = seqMap && typeof seqMap === 'object' ? seqMap : {};

  const used = {};
  loadAll().forEach((order) => {
    if (order.orderNo) used[order.orderNo] = true;
  });

  let seq = Math.max(0, parseInt(map[key], 10) || 0);
  let orderNo = '';

  do {
    seq += 1;
    orderNo = `${key}-${String(seq).padStart(4, '0')}`;
  } while (used[orderNo] && seq < 10000);

  map[key] = seq;
  storage.set(STORAGE_KEYS.ORDER_SEQ, map);
  return orderNo;
}

// ---------- 创建订单 ----------

// 只接收 { productId, qty }，名称/单价/分类全部按下单时的商品表写快照
function normalizeItems(inputItems) {
  const catalog = products.listAllSync();
  const nameById = {};
  categories.listAllSync().forEach((item) => {
    nameById[item.id] = item.name;
  });

  const normalized = [];

  for (let i = 0; i < inputItems.length; i += 1) {
    const input = inputItems[i] || {};
    const product = catalog.find((item) => item.id === input.productId);

    if (!product || product.isAvailable === false) {
      return { error: api.fail(4004, `商品不可下单：${input.name || input.productId || '未知商品'}`) };
    }

    const qty = Math.max(1, Math.min(MAX_QTY, parseInt(input.qty, 10) || 1));
    const existed = normalized.find((item) => item.productId === product.id);

    if (existed) {
      existed.qty = Math.min(MAX_QTY, existed.qty + qty);
      existed.subtotal = existed.price * existed.qty;
    } else {
      normalized.push({
        productId: product.id,
        name: product.name,
        nameEn: product.nameEn || '',
        category: product.category || '',
        categoryName: nameById[product.category] || '',
        image: product.image || '',
        price: product.price,
        qty,
        subtotal: product.price * qty
      });
    }
  }

  return { items: normalized };
}

function createOrder(input = {}) {
  const inputItems = Array.isArray(input.items) ? input.items : [];
  const tableId = input.tableId;
  const remark = String(input.remark || '').trim().slice(0, REMARK_MAX);

  if (!inputItems.length) return api.fail(4001, '购物车为空');
  if (!tableId) return api.fail(4002, '未识别到桌号，请扫描桌面二维码');

  const table = tables.getTableSync(tableId);
  if (!table || table.enabled === false) return api.fail(4003, '桌号不存在或已停用');

  const { items, error } = normalizeItems(inputItems);
  if (error) return error;

  let totalQty = 0;
  let totalAmount = 0;
  items.forEach((item) => {
    totalQty += item.qty;
    totalAmount += item.subtotal;
  });

  // 提交时按当前商品表重新核价，页面传来的金额一律不采信
  const createdAt = Date.now();
  const order = {
    id: api.nextId('o'),
    orderNo: nextOrderNo(createdAt),
    tableId: table.id,
    tableName: table.name,
    tableArea: table.area || '',
    items,
    totalQty,
    totalAmount,
    status: ORDER_STATUS.PENDING,
    payStatus: PAY_STATUS.UNPAID,
    payMode: PAY_MODE.MOCK,
    remark,
    exception: null,
    createdAt,
    updatedAt: createdAt,
    statusLogs: [{ status: ORDER_STATUS.PENDING, at: createdAt, by: 'customer' }]
  };

  const list = loadAll();
  list.push(order);
  saveAll(list);
  return api.success(api.clone(order));
}

// 模拟支付：只改变支付状态，不产生任何真实扣款（M5 前不在界面出现）
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

// 状态流转：待接单 → 制作中 → 已完成；页面只调用这里，不直接改数据。
// expectedStatus 为乐观锁：页面带上看到的状态，若已被别端改过则拒绝，
// 避免调酒师「制作完成」覆盖顾客刚提交的取消。
function updateOrderStatus(orderId, nextStatus, by = 'admin', expectedStatus = '') {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === orderId);
  if (index < 0) return api.fail(4040, '订单不存在');

  const order = list[index];

  if (expectedStatus && order.status !== expectedStatus) {
    return api.fail(4017, '订单状态已变化，请刷新后重试');
  }

  // 调酒师只能往前推单，不能取消、不能改商品；取消与异常处理归老板
  if (by === 'bartender' && nextStatus === ORDER_STATUS.CANCELLED) {
    return api.fail(4018, '调酒师不能取消订单，请提交异常说明');
  }
  if (by === 'customer') {
    return api.fail(4019, '顾客不能推进订单状态');
  }

  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (allowed.indexOf(nextStatus) < 0) {
    return api.fail(4006, '订单状态不可变更');
  }

  const updatedAt = Date.now();
  order.status = nextStatus;
  order.updatedAt = updatedAt;
  order.statusLogs = order.statusLogs || [];
  order.statusLogs.push({ status: nextStatus, at: updatedAt, by });
  saveAll(list);
  return api.success(api.clone(order));
}

// 取消订单：顾客只能在「待接单」取消；老板（M3）可在制作中取消
function cancelOrder(orderId, options = {}) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === orderId);
  if (index < 0) return api.fail(4040, '订单不存在');

  const order = list[index];
  if (order.status === ORDER_STATUS.CANCELLED) return api.fail(4008, '订单已取消');
  if (order.status === ORDER_STATUS.COMPLETED) return api.fail(4009, '订单已完成，无法取消');

  const by = options.by || 'customer';
  if (by === 'bartender') return api.fail(4021, '调酒师不能取消订单，请提交异常说明');
  const isOwner = by === 'owner' || by === 'admin';
  const allowed = isOwner ? [ORDER_STATUS.PENDING, ORDER_STATUS.MAKING] : [ORDER_STATUS.PENDING];
  if (allowed.indexOf(order.status) < 0) {
    return api.fail(4007, isOwner ? '已完成或已取消的订单不能取消' : '已开始制作，请联系店员取消');
  }

  const at = Date.now();
  const reason = String(options.reason || '').trim().slice(0, REMARK_MAX);
  // 老板取消属于管理动作，必须留下原因，避免无据可查
  if (isOwner && !reason) return api.fail(4011, '请填写取消原因');

  order.status = ORDER_STATUS.CANCELLED;
  order.updatedAt = at;
  order.cancelReason = reason;
  order.statusLogs = order.statusLogs || [];
  order.statusLogs.push({
    status: ORDER_STATUS.CANCELLED,
    at,
    by,
    note: reason ? `取消原因：${reason}` : ''
  });
  saveAll(list);
  return api.success(api.clone(order));
}

// ---------- 订单异常（旁挂标记，老板处理） ----------

// 标记异常：缺货、无法制作等。不改变订单状态，只做标记并写时间线，
// 这样顾客端状态不会出现第五种枚举值，三端共用同一套状态机。
function markOrderException(orderId, options = {}) {
  const reason = String(options.reason || '').trim().slice(0, REMARK_MAX);
  const note = String(options.note || '').trim().slice(0, REMARK_MAX);
  if (!reason) return api.fail(4012, '请选择或填写异常原因');

  const list = loadAll();
  const index = list.findIndex((item) => item.id === orderId);
  if (index < 0) return api.fail(4040, '订单不存在');

  const order = list[index];
  if (order.status === ORDER_STATUS.COMPLETED || order.status === ORDER_STATUS.CANCELLED) {
    return api.fail(4013, '已结束的订单不能标记异常');
  }
  if (order.exception && order.exception.status === EXCEPTION_STATUS.OPEN) {
    return api.fail(4014, '该订单已有待处理的异常');
  }

  const at = Date.now();
  const by = options.by || 'owner';
  order.exception = {
    status: EXCEPTION_STATUS.OPEN,
    reason,
    note,
    by,
    createdAt: at,
    resolvedAt: 0,
    resolvedBy: '',
    resolution: ''
  };
  order.updatedAt = at;
  order.statusLogs = order.statusLogs || [];
  order.statusLogs.push({
    status: order.status,
    at,
    by,
    note: `标记异常：${reason}${note ? `（${note}）` : ''}`
  });
  saveAll(list);
  return api.success(api.clone(order));
}

function resolveOrderException(orderId, options = {}) {
  const resolution = String(options.resolution || options.note || '').trim().slice(0, REMARK_MAX);
  if (!resolution) return api.fail(4015, '请填写处理说明');
  if (options.by === 'bartender') return api.fail(4020, '异常由老板处理，调酒师只能提交说明');

  const list = loadAll();
  const index = list.findIndex((item) => item.id === orderId);
  if (index < 0) return api.fail(4040, '订单不存在');

  const order = list[index];
  if (!order.exception || order.exception.status !== EXCEPTION_STATUS.OPEN) {
    return api.fail(4016, '该订单没有待处理的异常');
  }

  const at = Date.now();
  const by = options.by || 'owner';
  order.exception.status = EXCEPTION_STATUS.RESOLVED;
  order.exception.resolvedAt = at;
  order.exception.resolvedBy = by;
  order.exception.resolution = resolution;
  order.updatedAt = at;
  order.statusLogs = order.statusLogs || [];
  order.statusLogs.push({ status: order.status, at, by, note: `异常已处理：${resolution}` });
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

// 调酒师工作台：只看未取消的订单（待接单/制作中/已完成），支持状态、桌号关键词与时间排序。
// 与顾客端/老板端读同一份 orders 数据，不另存副本；工作台不暴露已取消单。
const WORKBENCH_STATUSES = [ORDER_STATUS.PENDING, ORDER_STATUS.MAKING, ORDER_STATUS.COMPLETED];

function listWorkbenchOrders(filter = {}) {
  const status = filter.status || '';
  // 工作台不接受「已取消」等状态：传了非法状态就返回空，避免悄悄退化成全量
  if (status && WORKBENCH_STATUSES.indexOf(status) < 0) {
    return api.success({ list: [], total: 0, page: 1, pageSize: 0 });
  }
  const keyword = String(filter.keyword || '').trim().toLowerCase();
  // asc = 先到先做（默认）；desc = 最新下单在前
  const direction = filter.sort === 'desc' ? -1 : 1;
  const page = Math.max(1, parseInt(filter.page, 10) || 1);
  const pageSize = Math.max(1, parseInt(filter.pageSize, 10) || 100);

  let list = loadAll().filter((item) => item.status !== ORDER_STATUS.CANCELLED);

  if (status) list = list.filter((item) => item.status === status);
  if (keyword) {
    list = list.filter((item) =>
      `${item.tableName || ''} ${item.tableArea || ''} ${item.tableId || ''} ${item.orderNo || ''}`
        .toLowerCase()
        .indexOf(keyword) >= 0
    );
  }

  list.sort((a, b) => (a.createdAt - b.createdAt) * direction);

  const total = list.length;
  const start = (page - 1) * pageSize;
  return api.success({
    list: api.clone(list.slice(start, start + pageSize)),
    total,
    page,
    pageSize
  });
}

// 待接单轻量列表：工作台轮询用它做「新单」识别，不受当前筛选 tab 影响。
// 只返回识别所需字段，避免每次轮询搬运整单明细。
function listPendingOrders() {
  const list = loadAll()
    .filter((item) => item.status === ORDER_STATUS.PENDING)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((item) => ({
      id: item.id,
      orderNo: item.orderNo,
      tableName: item.tableName,
      createdAt: item.createdAt
    }));

  return api.success(list);
}

function adminListOrders(filter = {}) {
  const status = filter.status || '';
  const dateFrom = String(filter.dateFrom || '').replace(/-/g, '');
  const dateTo = String(filter.dateTo || '').replace(/-/g, '');
  const keyword = String(filter.keyword || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(filter.page, 10) || 1);
  const pageSize = Math.max(1, parseInt(filter.pageSize, 10) || 20);
  // 本阶段没有支付，默认统计全部（含未支付）；M5 再按 payStatus 过滤
  const onlyPaid = filter.onlyPaid === true;

  let list = loadAll().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (onlyPaid) list = list.filter((item) => item.payStatus === PAY_STATUS.MOCK_PAID);
  if (status) list = list.filter((item) => item.status === status);
  if (dateFrom) list = list.filter((item) => format.dateKey(item.createdAt) >= dateFrom);
  if (dateTo) list = list.filter((item) => format.dateKey(item.createdAt) <= dateTo);
  if (keyword) {
    list = list.filter((item) =>
      `${item.orderNo || ''} ${item.tableName || ''}`.toLowerCase().indexOf(keyword) >= 0
    );
  }

  const total = list.length;
  const start = (page - 1) * pageSize;
  return api.success({
    list: api.clone(list.slice(start, start + pageSize)),
    total,
    page,
    pageSize
  });
}

// 管理端各状态订单数：给筛选条与概览用，页面不用自己遍历
function adminOrderCounts() {
  const list = loadAll();
  const counts = { all: list.length, pending: 0, making: 0, completed: 0, cancelled: 0, openExceptions: 0 };

  list.forEach((order) => {
    if (order.status === ORDER_STATUS.PENDING) counts.pending += 1;
    else if (order.status === ORDER_STATUS.MAKING) counts.making += 1;
    else if (order.status === ORDER_STATUS.COMPLETED) counts.completed += 1;
    else if (order.status === ORDER_STATUS.CANCELLED) counts.cancelled += 1;
    if (order.exception && order.exception.status === EXCEPTION_STATUS.OPEN) counts.openExceptions += 1;
  });

  return api.success(api.clone(counts));
}

module.exports = {
  createOrder,
  cancelOrder,
  markMockPaid,
  updateOrderStatus,
  markOrderException,
  resolveOrderException,
  getOrder,
  listOrders,
  listWorkbenchOrders,
  listPendingOrders,
  adminListOrders,
  adminOrderCounts
};