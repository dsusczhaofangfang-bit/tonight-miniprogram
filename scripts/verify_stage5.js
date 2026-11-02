// 第五阶段（订单确认 + 顾客订单管理）离线校验脚本。
// 不依赖微信开发者工具：用内存 storage 与 wx 桩件跑 services / 页面逻辑，并静态检查 WXML/JSON/文案。
// 运行：node scripts/verify_stage5.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  [FAIL] ${name}`);
    console.log(`         ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------- wx / getApp 桩件 ----------
const store = new Map();
let appStub = { globalData: {} };
let lastNavUrl = '';
let lastRedirectUrl = '';
let lastSwitchUrl = '';
let lastBadge = '';
let lastToast = '';
let modalConfirmed = true;
let modalCount = 0;

global.wx = {
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => {
    store.set(key, value);
  },
  removeStorageSync: (key) => {
    store.delete(key);
  },
  getWindowInfo: () => ({ statusBarHeight: 20, windowHeight: 700, windowWidth: 375 }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  // 模拟 iPhone 6 胶囊：右上角 87×32，下沿 y=56
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 281, right: 368, width: 87, height: 32 }),
  setTabBarBadge: (options) => {
    lastBadge = String(options.text);
  },
  removeTabBarBadge: () => {
    lastBadge = '';
  },
  showToast: (options) => {
    lastToast = options.title || '';
  },
  showModal: (options) => {
    modalCount += 1;
    if (options.success) options.success({ confirm: modalConfirmed, cancel: !modalConfirmed });
  },
  pageScrollTo: () => {},
  navigateTo: (options) => {
    lastNavUrl = options.url;
  },
  redirectTo: (options) => {
    lastRedirectUrl = options.url;
  },
  switchTab: (options) => {
    lastSwitchUrl = options.url;
  },
  navigateBack: () => {},
  stopPullDownRefresh: () => {},
  setNavigationBarTitle: () => {}
};
global.getApp = () => appStub;

let config = require(path.join(ROOT, 'config/index'));
config.mockDelay = [0, 0];

// 用 app.js 的真实配置构造 app 实例：扫码桌号校验、setTable/clearTable 与线上同一套逻辑
function loadAppConfig() {
  const file = path.join(ROOT, 'app.js');
  let captured = null;
  const previous = global.App;
  global.App = (appConfig) => {
    captured = appConfig;
  };
  delete require.cache[require.resolve(file)];
  try {
    require(file);
  } finally {
    global.App = previous;
  }
  if (!captured) throw new Error('app.js 没有调用 App()');
  return captured;
}

function bindApp(appConfig) {
  Object.keys(appConfig).forEach((key) => {
    if (typeof appConfig[key] === 'function') appStub[key] = appConfig[key].bind(appStub);
  });
}

let appConfig = loadAppConfig();
bindApp(appConfig);
appStub.globalData = JSON.parse(JSON.stringify(appConfig.globalData));

let categoryService = require(path.join(ROOT, 'services/categories'));
let productService = require(path.join(ROOT, 'services/products'));
let cartService = require(path.join(ROOT, 'services/cart'));
let orderService = require(path.join(ROOT, 'services/orders'));
let tableService = require(path.join(ROOT, 'services/tables'));
let constants = require(path.join(ROOT, 'utils/constants'));

const {
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_STATUS_LIST,
  ORDER_STATUS_TONE,
  ORDER_TRANSITIONS,
  STORAGE_KEYS,
  PAY_STATUS
} = constants;

const TABLE_ID = require(path.join(ROOT, 'utils/mock-data/tables'))[0].id;

// 模拟「重新打开小程序」：清掉项目模块缓存，storage 保留
function reloadProject() {
  Object.keys(require.cache).forEach((key) => {
    if (key.indexOf(ROOT) === 0) delete require.cache[key];
  });
  config = require(path.join(ROOT, 'config/index'));
  config.mockDelay = [0, 0];

  categoryService = require(path.join(ROOT, 'services/categories'));
  productService = require(path.join(ROOT, 'services/products'));
  cartService = require(path.join(ROOT, 'services/cart'));
  orderService = require(path.join(ROOT, 'services/orders'));
  tableService = require(path.join(ROOT, 'services/tables'));
  constants = require(path.join(ROOT, 'utils/constants'));

  appConfig = loadAppConfig();
  bindApp(appConfig);
}

// ---------- 静态检查工具 ----------
function walk(dir, exts, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') return;
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  });
  return out;
}

function checkWxmlBalance(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack = [];
  let match;
  while ((match = re.exec(raw))) {
    const closing = match[1] === '/';
    const tag = match[2];
    const selfClosing = match[4] === '/';
    if (selfClosing) continue;
    if (closing) {
      const open = stack.pop();
      if (open !== tag) {
        throw new Error(`${path.relative(ROOT, file)} 标签不匹配：</${tag}> 对应 <${open}>`);
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) {
    throw new Error(`${path.relative(ROOT, file)} 存在未闭合标签：${stack.join(', ')}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 页面逻辑桩件：截获 Page() 配置，构造一个带 setData 的实例
function loadPage(relPath) {
  const file = path.join(ROOT, relPath);
  let captured = null;
  const previous = global.Page;
  global.Page = (pageConfig) => {
    captured = pageConfig;
  };
  delete require.cache[require.resolve(file)];
  try {
    require(file);
  } finally {
    global.Page = previous;
  }
  if (!captured) throw new Error(`页面没有调用 Page()：${relPath}`);
  return captured;
}

function createPage(pageConfig) {
  const page = Object.create(pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function setData(patch, callback) {
    Object.keys(patch).forEach((key) => {
      const match = /^([\w$]+)\[(\d+)\]\.([\w$]+)$/.exec(key);
      if (match) {
        this.data[match[1]][Number(match[2])][match[3]] = patch[key];
        return;
      }
      this.data[key] = patch[key];
    });
    if (typeof callback === 'function') callback();
  };
  return page;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    (function poll() {
      let ok = false;
      try {
        ok = Boolean(predicate());
      } catch (error) {
        ok = false;
      }
      if (ok) return resolve();
      if (Date.now() - startedAt > timeout) return reject(new Error('等待页面状态超时'));
      setTimeout(poll, 5);
    })();
  });
}

function orderCount() {
  const list = store.get(STORAGE_KEYS.ORDERS);
  return Array.isArray(list) ? list.length : 0;
}

async function resetDemoData() {
  store.delete(STORAGE_KEYS.ORDERS);
  store.delete(STORAGE_KEYS.ORDER_SEQ);
  store.delete(STORAGE_KEYS.CART);
  appStub.globalData.table = { id: TABLE_ID, name: 'A1', area: '吧台区' };
  await orderService.listOrders({});
}

async function main() {
  section('一、购物车勾选与结算范围');

  await check('旧购物车缓存没有 selected 字段时默认勾选', async () => {
    store.set(STORAGE_KEYS.CART, [{ productId: 'p_traditional_01', qty: 2 }]);
    const res = await cartService.getCart();
    assert.strictEqual(res.data.items.length, 1);
    assert.strictEqual(res.data.items[0].selected, true);
    assert.strictEqual(res.data.selectedQty, 2);
  });

  await check('取消勾选后只统计已选商品', async () => {
    await cartService.clear();
    await cartService.addItem('p_traditional_01', 2); // 5800
    await cartService.addItem('p_snacks_01', 1); // 2800
    let res = await cartService.getCart();
    assert.strictEqual(res.data.selectedQty, 3);
    assert.strictEqual(res.data.selectedAmount, 5800 * 2 + 2800);
    assert.strictEqual(res.data.allSelected, true);

    res = await cartService.toggleSelected('p_snacks_01', false);
    assert.strictEqual(res.data.selectedQty, 2);
    assert.strictEqual(res.data.selectedAmount, 5800 * 2);
    assert.strictEqual(res.data.totalQty, 3, '未勾选商品仍应留在购物车');
    assert.strictEqual(res.data.allSelected, false);
  });

  await check('全选 / 全不选同步已选件数与金额', async () => {
    let res = await cartService.setAllSelected(false);
    assert.strictEqual(res.data.selectedQty, 0);
    assert.strictEqual(res.data.selectedAmount, 0);
    assert.strictEqual(res.data.allSelected, false);

    res = await cartService.setAllSelected(true);
    assert.strictEqual(res.data.selectedQty, 3);
    assert.strictEqual(res.data.allSelected, true);
  });

  await check('改数量保留勾选状态', async () => {
    await cartService.toggleSelected('p_snacks_01', false);
    const res = await cartService.updateItemQty('p_snacks_01', 4);
    const item = res.data.items.find((entry) => entry.productId === 'p_snacks_01');
    assert.strictEqual(item.qty, 4);
    assert.strictEqual(item.selected, false, '改数量不应把未勾选的商品重新勾上');
  });

  await check('下单后只移除已提交商品，未勾选商品保留', async () => {
    await cartService.clear();
    await cartService.addItem('p_traditional_01', 1);
    await cartService.addItem('p_snacks_01', 1);
    await cartService.toggleSelected('p_snacks_01', false);

    const res = await cartService.removeItems(['p_traditional_01']);
    assert.strictEqual(res.data.items.length, 1);
    assert.strictEqual(res.data.items[0].productId, 'p_snacks_01');
    assert.strictEqual(res.data.items[0].selected, false);
  });

  section('二、下单：桌号、核价与快照');

  await check('缺少桌号时拒绝下单（不自动生成桌号）', async () => {
    const res = await orderService.createOrder({ items: [{ productId: 'p_traditional_01', qty: 1 }] });
    assert.strictEqual(res.code, 4002);
    assert.ok(res.message.indexOf('桌号') >= 0);
  });

  await check('不存在的桌号被拒绝', async () => {
    const res = await orderService.createOrder({
      tableId: 't_not_exist',
      items: [{ productId: 'p_traditional_01', qty: 1 }]
    });
    assert.strictEqual(res.code, 4003);
  });

  await check('空商品列表被拒绝', async () => {
    const res = await orderService.createOrder({ tableId: TABLE_ID, items: [] });
    assert.strictEqual(res.code, 4001);
  });

  await check('金额按商品表重新核算，忽略页面传入的金额', async () => {
    const res = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_01', qty: 2, price: 1, subtotal: 2, totalAmount: 2 }],
      totalAmount: 2
    });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.totalAmount, 5800 * 2);
    assert.strictEqual(res.data.items[0].price, 5800);
  });

  await check('订单保存商品名称/单价/数量/分类等历史快照', async () => {
    const res = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [
        { productId: 'p_signature_01', qty: 1 },
        { productId: 'p_non_alcoholic_03', qty: 2 }
      ]
    });
    assert.strictEqual(res.code, 0);
    const order = res.data;
    assert.strictEqual(order.items.length, 2);
    order.items.forEach((item) => {
      ['productId', 'name', 'nameEn', 'category', 'categoryName', 'image', 'price', 'qty', 'subtotal'].forEach(
        (field) => {
          assert.ok(Object.prototype.hasOwnProperty.call(item, field), `快照缺少字段 ${field}`);
        }
      );
      assert.strictEqual(item.subtotal, item.price * item.qty);
      assert.ok(item.name.indexOf('示例·') === 0);
    });
    assert.strictEqual(order.totalQty, 3);
    assert.strictEqual(
      order.totalAmount,
      order.items.reduce((sum, item) => sum + item.subtotal, 0)
    );
    assert.strictEqual(order.status, ORDER_STATUS.PENDING);
    assert.strictEqual(order.payStatus, PAY_STATUS.UNPAID);
  });

  await check('重复商品合并数量且不超过 99', async () => {
    const res = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [
        { productId: 'p_snacks_02', qty: 60 },
        { productId: 'p_snacks_02', qty: 60 }
      ]
    });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.items.length, 1);
    assert.strictEqual(res.data.items[0].qty, 99);
  });

  await check('订单编号唯一，格式为 日期-四位序号', async () => {
    const first = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_02', qty: 1 }]
    });
    const second = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_02', qty: 1 }]
    });
    assert.ok(/^\d{8}-\d{4}$/.test(first.data.orderNo), `编号格式不对：${first.data.orderNo}`);
    assert.notStrictEqual(first.data.orderNo, second.data.orderNo);

    const nos = (store.get(STORAGE_KEYS.ORDERS) || []).map((item) => item.orderNo);
    assert.strictEqual(new Set(nos).size, nos.length, '存在重复订单编号');
  });

  await check('商品改价不影响历史订单金额', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_03', qty: 1 }]
    });
    const originalTotal = created.data.totalAmount;

    await productService.updateProduct('p_traditional_03', { price: 99900 });
    const after = await orderService.getOrder(created.data.id);
    assert.strictEqual(after.data.totalAmount, originalTotal);
    assert.strictEqual(after.data.items[0].price, originalTotal);

    await productService.updateProduct('p_traditional_03', { price: originalTotal });
  });

  await check('备注超过 100 字被截断', async () => {
    const res = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_04', qty: 1 }],
      remark: '很'.repeat(120)
    });
    assert.strictEqual(res.data.remark.length, 100);
  });

  await check('下架商品不可下单', async () => {
    await productService.toggleProductAvailability('p_non_alcoholic_06');
    const res = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_non_alcoholic_06', qty: 1 }]
    });
    assert.strictEqual(res.code, 4004);
    await productService.toggleProductAvailability('p_non_alcoholic_06');
  });

  section('三、状态机：待接单 → 制作中 → 已完成');

  await check('状态常量与筛选顺序符合本阶段约定', () => {
    // 顾客端只有 4 个状态筛选，不设「全部」
    assert.deepStrictEqual(ORDER_STATUS_LIST.map((item) => item.text), [
      '待接单',
      '制作中',
      '已完成',
      '已取消'
    ]);
    assert.ok(
      ORDER_STATUS_LIST.every((item) => item.value),
      '筛选不应再包含「全部」（空 value）'
    );
    assert.deepStrictEqual(Object.keys(ORDER_STATUS_TEXT).sort(), [
      'cancelled',
      'completed',
      'making',
      'pending'
    ]);
    assert.ok(!('accepted' in ORDER_STATUS_TEXT), '已接单状态应已移除');
    assert.ok(!('ready' in ORDER_STATUS_TEXT), '待取餐状态应已移除');
    assert.deepStrictEqual(ORDER_TRANSITIONS.pending, ['making', 'cancelled']);
    assert.deepStrictEqual(ORDER_TRANSITIONS.making, ['completed']);
    assert.deepStrictEqual(ORDER_TRANSITIONS.completed, []);
    assert.strictEqual(ORDER_STATUS_TONE.making, 'rose');
  });

  await check('新订单为待接单并写入首条状态记录', async () => {
    const res = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_signature_02', qty: 1 }]
    });
    assert.strictEqual(res.data.status, ORDER_STATUS.PENDING);
    assert.strictEqual(res.data.statusLogs.length, 1);
    assert.strictEqual(res.data.statusLogs[0].by, 'customer');
  });

  await check('待接单 → 制作中 → 已完成', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_signature_04', qty: 1 }]
    });
    const id = created.data.id;

    let res = await orderService.updateOrderStatus(id, ORDER_STATUS.MAKING, 'demo');
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.status, ORDER_STATUS.MAKING);

    res = await orderService.updateOrderStatus(id, ORDER_STATUS.COMPLETED, 'demo');
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.status, ORDER_STATUS.COMPLETED);
    assert.strictEqual(res.data.statusLogs.length, 3);
  });

  await check('不能跳级、不能回退', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_signature_05', qty: 1 }]
    });
    const id = created.data.id;

    let res = await orderService.updateOrderStatus(id, ORDER_STATUS.COMPLETED);
    assert.strictEqual(res.code, 4006, '待接单不能直接跳到已完成');

    await orderService.updateOrderStatus(id, ORDER_STATUS.MAKING);
    res = await orderService.updateOrderStatus(id, ORDER_STATUS.PENDING);
    assert.strictEqual(res.code, 4006, '不能回退到待接单');
  });

  await check('顾客取消：待接单可取消，制作中与已完成不可', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_06', qty: 1 }]
    });
    const id = created.data.id;

    let res = await orderService.cancelOrder(id, { by: 'customer', reason: '临时有事' });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.status, ORDER_STATUS.CANCELLED);
    assert.strictEqual(res.data.cancelReason, '临时有事');
    assert.strictEqual(res.data.statusLogs[res.data.statusLogs.length - 1].status, ORDER_STATUS.CANCELLED);

    res = await orderService.cancelOrder(id, { by: 'customer' });
    assert.strictEqual(res.code, 4008, '已取消订单不能重复取消');

    const making = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_06', qty: 1 }]
    });
    await orderService.updateOrderStatus(making.data.id, ORDER_STATUS.MAKING);
    res = await orderService.cancelOrder(making.data.id, { by: 'customer' });
    assert.strictEqual(res.code, 4007, '制作中不允许顾客自助取消');
    res = await orderService.cancelOrder(making.data.id, { by: 'admin' });
    assert.strictEqual(res.code, 4011, '老板取消必须填写原因（第六阶段收紧）');
    res = await orderService.cancelOrder(making.data.id, { by: 'admin', reason: '缺货，无法制作' });
    assert.strictEqual(res.code, 0, '老板侧（M3）应可在制作中取消');
    assert.strictEqual(res.data.cancelReason, '缺货，无法制作');

    const completed = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_06', qty: 1 }]
    });
    await orderService.updateOrderStatus(completed.data.id, ORDER_STATUS.MAKING);
    await orderService.updateOrderStatus(completed.data.id, ORDER_STATUS.COMPLETED);
    res = await orderService.cancelOrder(completed.data.id, { by: 'admin' });
    assert.strictEqual(res.code, 4009, '已完成订单不可取消');
  });

  section('四、列表、筛选与订单读取');

  await check('订单列表按时间倒序，并支持状态筛选', async () => {
    const all = await orderService.listOrders({});
    assert.ok(all.data.length >= 4);
    for (let i = 1; i < all.data.length; i += 1) {
      assert.ok(all.data[i - 1].createdAt >= all.data[i].createdAt, '列表未按时间倒序');
    }

    for (const filter of ORDER_STATUS_LIST.filter((item) => item.value)) {
      const res = await orderService.listOrders({ status: filter.value });
      assert.ok(res.data.every((item) => item.status === filter.value), `${filter.text} 筛出了其他状态`);
      const expected = all.data.filter((item) => item.status === filter.value).length;
      assert.strictEqual(res.data.length, expected, `${filter.text} 数量不符`);
    }
  });

  await check('列表与详情读取同一份订单数据', async () => {
    const list = await orderService.listOrders({});
    const target = list.data[0];
    const detail = await orderService.getOrder(target.id);
    assert.strictEqual(detail.data.orderNo, target.orderNo);
    assert.strictEqual(detail.data.totalAmount, target.totalAmount);
    assert.deepStrictEqual(detail.data.items, target.items);
  });

  await check('不存在的订单返回 4040', async () => {
    const res = await orderService.getOrder('o_not_exist');
    assert.strictEqual(res.code, 4040);
  });

  section('五、持久化与旧数据迁移');

  await check('重新打开小程序后订单仍然存在', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_01', qty: 3 }],
      remark: '持久化用例'
    });
    const totalBefore = orderCount();

    reloadProject();

    const res = await orderService.getOrder(created.data.id);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.remark, '持久化用例');
    assert.strictEqual(res.data.orderNo, created.data.orderNo);
    assert.strictEqual(orderCount(), totalBefore);
  });

  await check('旧本地订单（已接单/待取餐）自动迁移且补齐快照字段', async () => {
    const backup = store.get(STORAGE_KEYS.ORDERS);
    const legacyBase = {
      orderNo: '20260101-0001',
      tableId: 't_a1',
      tableName: 'A1',
      totalQty: 2,
      totalAmount: 11600,
      payStatus: 'mock_paid',
      payMode: 'mock',
      remark: '',
      createdAt: Date.now() - 10 * 60 * 60 * 1000,
      items: [{ productId: 'p_traditional_01', name: '示例·传统饮品 01', price: 5800, qty: 2 }]
    };

    store.set(STORAGE_KEYS.ORDERS, [
      Object.assign({}, legacyBase, {
        id: 'o_legacy_accepted',
        status: 'accepted',
        updatedAt: legacyBase.createdAt,
        statusLogs: [{ status: 'pending', at: legacyBase.createdAt, by: 'customer' }]
      }),
      Object.assign({}, legacyBase, {
        id: 'o_legacy_ready',
        orderNo: '20260101-0002',
        status: 'ready',
        updatedAt: legacyBase.createdAt,
        statusLogs: [{ status: 'pending', at: legacyBase.createdAt, by: 'customer' }]
      })
    ]);

    reloadProject();

    const accepted = await orderService.getOrder('o_legacy_accepted');
    assert.strictEqual(accepted.data.status, ORDER_STATUS.MAKING, 'accepted 应迁移为 making');
    assert.strictEqual(accepted.data.items[0].category, 'traditional');
    assert.strictEqual(accepted.data.items[0].categoryName, '传统饮品');
    assert.strictEqual(accepted.data.items[0].image, '');
    assert.strictEqual(accepted.data.items[0].subtotal, 11600);

    const ready = await orderService.getOrder('o_legacy_ready');
    assert.strictEqual(ready.data.status, ORDER_STATUS.COMPLETED, 'ready 应迁移为 completed');

    store.set(STORAGE_KEYS.ORDERS, backup);
    reloadProject();
  });

  await check('删除订单后订单编号不会复用', async () => {
    const first = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_02', qty: 1 }]
    });
    const list = store.get(STORAGE_KEYS.ORDERS).filter((item) => item.id !== first.data.id);
    store.set(STORAGE_KEYS.ORDERS, list);

    const second = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_traditional_02', qty: 1 }]
    });
    assert.notStrictEqual(second.data.orderNo, first.data.orderNo);

    const nos = store.get(STORAGE_KEYS.ORDERS).map((item) => item.orderNo);
    assert.strictEqual(new Set(nos).size, nos.length, '订单编号重复');
  });

  section('六、桌号：种子重建、启动校验与调试选择');

  await check('桌号表种子版本变化后自动重建', async () => {
    store.set(STORAGE_KEYS.SEED_TABLES, 'stale');
    store.set(STORAGE_KEYS.TABLES, [{ id: 't_gone', name: 'X', area: '', sort: 1, enabled: true }]);

    const res = await tableService.listTables();
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.length, 8);
    assert.strictEqual(store.get(STORAGE_KEYS.SEED_TABLES), config.tableSeedVersion);
  });

  await check('启动时校验本地桌号：合法保留、失效清空', async () => {
    store.set(STORAGE_KEYS.TABLE, { id: 't_a2', name: 'A2', area: '吧台区' });
    appStub.onLaunch({});
    assert.strictEqual(appStub.globalData.table.id, 't_a2');

    store.set(STORAGE_KEYS.TABLE, { id: 't_gone', name: 'X', area: '' });
    appStub.onLaunch({});
    assert.strictEqual(appStub.globalData.table, null, '失效桌号不应继续展示');
    assert.strictEqual(store.has(STORAGE_KEYS.TABLE), false, '失效桌号应清掉本地缓存');
  });

  await check('扫码参数写入桌号，非法桌号不覆盖（含 scene）', async () => {
    appStub.onLaunch({ query: { table: 't_b2' } });
    assert.strictEqual(appStub.globalData.table.name, 'B2');
    assert.strictEqual(store.get(STORAGE_KEYS.TABLE).id, 't_b2');

    appStub.onLaunch({ query: { table: 't_zzz' } });
    assert.strictEqual(appStub.globalData.table.name, 'B2');

    appStub.onLaunch({ query: { scene: 'table%3Dt_a3' } });
    assert.strictEqual(appStub.globalData.table.name, 'A3');
  });

  await check('setTable / clearTable 与扫码走同一套校验', async () => {
    assert.strictEqual(appStub.setTable('t_zzz'), null);
    assert.strictEqual(appStub.globalData.table.name, 'A3');

    const table = appStub.setTable('t_a1');
    assert.strictEqual(table.name, 'A1');
    assert.strictEqual(store.get(STORAGE_KEYS.TABLE).id, 't_a1');

    appStub.clearTable();
    assert.strictEqual(appStub.globalData.table, null);
    assert.strictEqual(store.has(STORAGE_KEYS.TABLE), false);
  });

  await check('开发自检页：选择桌号替代扫码，也可清除', async () => {
    appStub.clearTable();
    const devConfig = loadPage('pages/dev-check/dev-check.js');
    const page = createPage(devConfig);
    page.onLoad();
    await waitFor(() => page.data.tableOptions.length === 9);

    assert.strictEqual(page.data.tableOptions[0].label, '清除当前桌号');
    assert.strictEqual(page.data.tableOptions[2].label, 'A2 · 吧台区');
    assert.strictEqual(page.data.tableName, '');

    page.onTablePick({ detail: { value: 2 } });
    await waitFor(() => page.data.tableName === 'A2');
    assert.strictEqual(appStub.globalData.table.id, 't_a2');
    assert.strictEqual(store.get(STORAGE_KEYS.TABLE).id, 't_a2');
    assert.ok(lastToast.indexOf('已设为 A2') >= 0);

    page.onTablePick({ detail: { value: 0 } });
    await waitFor(() => page.data.tableName === '');
    assert.strictEqual(appStub.globalData.table, null);
    assert.strictEqual(store.has(STORAGE_KEYS.TABLE), false);
  });

  section('七、页面逻辑（购物车 / 确认 / 列表 / 详情）');

  await resetDemoData();

  const cartConfig = loadPage('pages/cart/cart.js');
  const confirmConfig = loadPage('pages/order-confirm/order-confirm.js');
  const ordersConfig = loadPage('pages/orders/orders.js');
  const detailConfig = loadPage('pages/order-detail/order-detail.js');

  await check('购物车页：勾选、全选与未勾选时禁止结算', async () => {
    await cartService.clear();
    await cartService.addItem('p_traditional_01', 2);
    await cartService.addItem('p_snacks_01', 1);

    const page = createPage(cartConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false && page.data.items.length === 2);
    assert.strictEqual(page.data.items[0].selected, true);
    assert.strictEqual(page.data.selectedQty, 3);
    assert.strictEqual(page.data.selectedText, '144.00');

    page.onToggle({ currentTarget: { dataset: { id: 'p_snacks_01' } } });
    await waitFor(() => page.data.selectedQty === 2);
    assert.strictEqual(page.data.allSelected, false);

    // 第一次「全选」把未勾选的补上
    page.onToggleAll();
    await waitFor(() => page.data.selectedQty === 3);
    assert.strictEqual(page.data.allSelected, true);

    // 再点一次取消全选
    page.onToggleAll();
    await waitFor(() => page.data.selectedQty === 0);
    assert.strictEqual(page.data.allSelected, false);

    lastNavUrl = '';
    page.onCheckout();
    assert.strictEqual(lastNavUrl, '', '未勾选时不应跳转');
    assert.ok(lastToast.indexOf('勾选') >= 0);

    page.onToggleAll();
    await waitFor(() => page.data.selectedQty === 3);
    page.onCheckout();
    assert.strictEqual(lastNavUrl, '/pages/order-confirm/order-confirm');
  });

  await check('订单确认页：只读已勾选商品并显示桌号', async () => {
    appStub.globalData.table = { id: TABLE_ID, name: 'A1', area: '吧台区' };
    const page = createPage(confirmConfig);
    page.onLoad();
    await waitFor(() => page.data.loading === false);

    assert.strictEqual(page.data.empty, false);
    assert.strictEqual(page.data.items.length, 2);
    assert.strictEqual(page.data.totalQty, 3);
    assert.strictEqual(page.data.totalText, '144.00');
    assert.strictEqual(page.data.table.name, 'A1');
    assert.strictEqual(page.data.table.area, '吧台区');
  });

  await check('订单确认页：改数量即时重算并写回购物车', async () => {
    const page = createPage(confirmConfig);
    page.onLoad();
    await waitFor(() => page.data.loading === false);

    page.onQtyChange({ currentTarget: { dataset: { id: 'p_traditional_01' } }, detail: { value: 3 } });
    await waitFor(() => page.data.totalText === '202.00');

    const cart = await cartService.getCart();
    const item = cart.data.items.find((entry) => entry.productId === 'p_traditional_01');
    assert.strictEqual(item.qty, 3);
    assert.strictEqual(cart.data.selectedAmount, 5800 * 3 + 2800);
  });

  await check('订单确认页：备注输入与长度统计', async () => {
    const page = createPage(confirmConfig);
    page.onLoad();
    await waitFor(() => page.data.loading === false);

    page.onRemarkInput({ detail: { value: '少冰，不要柠檬皮' } });
    assert.strictEqual(page.data.remark, '少冰，不要柠檬皮');
    assert.strictEqual(page.data.remarkLen, 8);
    assert.strictEqual(page.data.remarkMax, 100);
  });

  await check('桌号缺失时确认页给出提示且不生成桌号', async () => {
    appStub.globalData.table = null;
    const page = createPage(confirmConfig);
    page.onLoad();
    await waitFor(() => page.data.loading === false);
    assert.strictEqual(page.data.table, null);

    lastRedirectUrl = '';
    lastToast = '';
    page.onSubmit();
    await delay(50);
    assert.strictEqual(lastRedirectUrl, '');
    assert.ok(lastToast.indexOf('桌号') >= 0);

    appStub.globalData.table = { id: TABLE_ID, name: 'A1', area: '吧台区' };
  });

  await check('确认页调试入口：开发版可见，设置桌号后同步', async () => {
    appStub.globalData.table = null;
    const page = createPage(confirmConfig);
    page.onLoad();
    await waitFor(() => page.data.loading === false);

    assert.strictEqual(page.data.isDev, true, '开发版应显示调试入口');
    assert.strictEqual(page.data.table, null);

    lastNavUrl = '';
    page.onGoDevCheck();
    assert.strictEqual(lastNavUrl, '/pages/dev-check/dev-check');

    appStub.setTable('t_a1');
    page.onShow();
    assert.strictEqual(page.data.table.id, 't_a1');
    assert.strictEqual(page.data.table.name, 'A1');
  });

  await check('首页：「我的」避开微信胶囊，不再被退出按钮覆盖', async () => {
    const homeConfig = loadPage('pages/home/home.js');
    const page = createPage(homeConfig);
    page.onLoad();

    assert.strictEqual(page.data.topInset, 32);
    assert.strictEqual(page.data.profileTop, 64, '应位于胶囊下沿 + 8px');
    assert.ok(page.data.profileTop > 56, '「我的」不能落进胶囊热区');
  });

  await check('提交订单：生成唯一编号、清空已提交商品并跳转详情', async () => {
    // 再放一件未勾选商品，验证不会被清掉
    await cartService.addItem('p_non_alcoholic_01', 1);
    await cartService.toggleSelected('p_non_alcoholic_01', false);

    const before = orderCount();
    const page = createPage(confirmConfig);
    page.onLoad();
    await waitFor(() => page.data.loading === false);
    page.onRemarkInput({ detail: { value: '靠窗的位置' } });

    lastRedirectUrl = '';
    lastToast = '';
    page.onSubmit();
    await waitFor(() => lastRedirectUrl.indexOf('/pages/order-detail/order-detail?id=') === 0);

    assert.strictEqual(lastToast, '下单成功');
    assert.strictEqual(orderCount(), before + 1);

    const createdId = lastRedirectUrl.split('id=')[1];
    const order = await orderService.getOrder(createdId);
    assert.strictEqual(order.code, 0);
    assert.strictEqual(order.data.status, ORDER_STATUS.PENDING);
    assert.strictEqual(order.data.remark, '靠窗的位置');
    assert.strictEqual(order.data.tableName, 'A1');
    assert.strictEqual(order.data.totalQty, 4, '3 件传统饮品 + 1 件小吃');
    assert.ok(/^\d{8}-\d{4}$/.test(order.data.orderNo));
    assert.strictEqual(order.data.statusLogs.length, 1);

    const cart = await cartService.getCart();
    assert.strictEqual(cart.data.items.length, 1, '未勾选的商品应保留');
    assert.strictEqual(cart.data.items[0].productId, 'p_non_alcoholic_01');
    assert.strictEqual(lastBadge, '1', '角标应为剩余 1 件');
  });

  await check('我的订单页：4 个状态筛选、默认待接单与卡片数据', async () => {
    const page = createPage(ordersConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);

    assert.strictEqual(page.data.filters.length, 4);
    assert.deepStrictEqual(page.data.filters.map((item) => item.text), ['待接单', '制作中', '已完成', '已取消']);
    assert.strictEqual(page.data.activeStatus, ORDER_STATUS.PENDING, '进页面应默认「待接单」');
    assert.strictEqual(page.data.activeText, '待接单');
    assert.ok(page.data.orders.length > 0, '默认「待接单」应有订单');
    assert.strictEqual(page.data.orders.length, page.data.total);
    assert.ok(page.data.orders.every((item) => item.status === ORDER_STATUS.PENDING));

    const card = page.data.orders[0];
    ['id', 'orderNo', 'status', 'statusText', 'timeText', 'tableText', 'summary', 'totalQty', 'amountText'].forEach(
      (field) => assert.ok(Object.prototype.hasOwnProperty.call(card, field), `卡片缺少 ${field}`)
    );

    lastNavUrl = '';
    page.onOrderTap({ currentTarget: { dataset: { id: card.id } } });
    assert.strictEqual(lastNavUrl, `/pages/order-detail/order-detail?id=${card.id}`);

    page.onFilterTap({ currentTarget: { dataset: { status: ORDER_STATUS.MAKING } } });
    await waitFor(() => page.data.loading === false && page.data.activeStatus === ORDER_STATUS.MAKING);
    assert.strictEqual(page.data.activeText, '制作中');
    assert.ok(page.data.orders.every((item) => item.status === ORDER_STATUS.MAKING));

    page.onFilterTap({ currentTarget: { dataset: { status: ORDER_STATUS.CANCELLED } } });
    await waitFor(() => page.data.loading === false && page.data.activeStatus === ORDER_STATUS.CANCELLED);
    assert.strictEqual(page.data.activeText, '已取消');
    assert.ok(page.data.orders.every((item) => item.status === ORDER_STATUS.CANCELLED));

    // 空状态（相当于旧的「全部」）不再被接受，避免误退回不限状态的列表
    page.onFilterTap({ currentTarget: { dataset: { status: '' } } });
    assert.strictEqual(page.data.activeStatus, ORDER_STATUS.CANCELLED, '空状态不应切换筛选');
  });

  await check('订单详情页：编号/时间/桌号/清单/备注/状态记录', async () => {
    const list = await orderService.listOrders({ status: ORDER_STATUS.PENDING });
    const target = list.data.find((item) => item.remark === '靠窗的位置') || list.data[0];

    const page = createPage(detailConfig);
    page.onLoad({ id: target.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    assert.strictEqual(page.data.order.orderNo, target.orderNo);
    assert.strictEqual(page.data.statusText, '待接单');
    assert.ok(page.data.timeText.indexOf('.') > 0);
    assert.strictEqual(page.data.order.tableName, 'A1');
    assert.strictEqual(page.data.items.length, target.items.length);
    assert.strictEqual(page.data.totalText, (target.totalAmount / 100).toFixed(2));
    assert.strictEqual(page.data.canCancel, true);
    assert.strictEqual(page.data.nextStatus, ORDER_STATUS.MAKING);
    assert.strictEqual(page.data.logs.length, 1);
    assert.strictEqual(page.data.logs[0].statusText, '待接单');
    assert.strictEqual(page.data.logs[0].actorText, '顾客');
  });

  await check('订单详情页：顾客取消后状态与按钮同步', async () => {
    const list = await orderService.listOrders({ status: ORDER_STATUS.PENDING });
    const target = list.data[0];

    const page = createPage(detailConfig);
    page.onLoad({ id: target.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    modalConfirmed = true;
    page.onCancel();
    await waitFor(() => page.data.order.status === ORDER_STATUS.CANCELLED);

    assert.strictEqual(page.data.statusText, '已取消');
    assert.strictEqual(page.data.canCancel, false);
    assert.strictEqual(page.data.nextStatus, '');

    const all = await orderService.listOrders({ status: ORDER_STATUS.CANCELLED });
    assert.ok(all.data.some((item) => item.id === target.id));
  });

  await check('订单详情页：演示推进状态（待接单→制作中→已完成）', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: 'p_signature_06', qty: 1 }]
    });

    const page = createPage(detailConfig);
    page.onLoad({ id: created.data.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    assert.strictEqual(page.data.nextStatus, ORDER_STATUS.MAKING);
    page.onAdvance();
    await waitFor(() => page.data.order.status === ORDER_STATUS.MAKING);
    assert.strictEqual(page.data.statusText, '制作中');
    assert.strictEqual(page.data.nextStatus, ORDER_STATUS.COMPLETED);

    page.onAdvance();
    await waitFor(() => page.data.order.status === ORDER_STATUS.COMPLETED);
    assert.strictEqual(page.data.statusText, '已完成');
    assert.strictEqual(page.data.nextStatus, '');
    assert.strictEqual(page.data.canCancel, false);
    assert.strictEqual(page.data.logs.length, 3);
  });

  await check('订单详情页：不存在的订单显示空态文案', async () => {
    const page = createPage(detailConfig);
    page.onLoad({ id: 'o_missing' });
    await waitFor(() => page.data.loading === false);
    assert.strictEqual(page.data.order, null);
    assert.ok(page.data.error.indexOf('订单') >= 0);
  });

  section('八、静态检查（路由 / 组件 / 文案）');

  const appJson = readJson(path.join(ROOT, 'app.json'));

  await check('app.json 注册订单确认与订单详情页，文件齐全', () => {
    ['pages/order-confirm/order-confirm', 'pages/order-detail/order-detail'].forEach((page) => {
      assert.ok(appJson.pages.indexOf(page) >= 0, `app.json 缺少 ${page}`);
      ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
        assert.ok(fs.existsSync(path.join(ROOT, `${page}.${ext}`)), `缺少 ${page}.${ext}`);
      });
    });
  });

  await check('新页面 JSON 可解析且注册的组件都存在', () => {
    ['pages/order-confirm/order-confirm.json', 'pages/order-detail/order-detail.json', 'pages/orders/orders.json'].forEach(
      (rel) => {
        const json = readJson(path.join(ROOT, rel));
        Object.values(json.usingComponents || {}).forEach((componentPath) => {
          const base = path.join(ROOT, componentPath.replace(/^\//, ''));
          assert.ok(fs.existsSync(`${base}.js`), `${rel} 引用的组件缺少 js：${componentPath}`);
          assert.ok(fs.existsSync(`${base}.wxml`), `${rel} 引用的组件缺少 wxml：${componentPath}`);
        });
      }
    );
  });

  await check('底部导航仍为 4 个 Tab，我的订单在 index 3', () => {
    assert.strictEqual(appJson.tabBar.list.length, 4);
    assert.strictEqual(appJson.tabBar.list[3].pagePath, 'pages/orders/orders');
    appJson.tabBar.list.forEach((tab) => {
      assert.ok(fs.existsSync(path.join(ROOT, tab.iconPath)), `缺少图标 ${tab.iconPath}`);
    });
  });

  const wxmlFiles = walk(path.join(ROOT, 'pages'), ['.wxml']).concat(
    walk(path.join(ROOT, 'components'), ['.wxml'])
  );

  await check(`WXML 标签闭合与配对（${wxmlFiles.length} 个文件）`, () => {
    wxmlFiles.forEach((file) => {
      if (file.indexOf('rose-stage') >= 0 || file.indexOf('petal-') >= 0) return;
      checkWxmlBalance(file);
    });
  });

  await check('页面与 services 不再出现已移除的状态（已接单 / 待取餐）', () => {
    const files = walk(path.join(ROOT, 'pages'), ['.js', '.wxml'])
      .concat(walk(path.join(ROOT, 'services'), ['.js']))
      .concat(walk(path.join(ROOT, 'components'), ['.js']));

    files.forEach((file) => {
      if (file.indexOf('verify_stage') >= 0) return;
      const source = fs.readFileSync(file, 'utf8');
      ['已接单', '待取餐', "'accepted'", 'ORDER_STATUS.ACCEPTED'].forEach((word) => {
        assert.ok(source.indexOf(word) < 0, `${path.relative(ROOT, file)} 仍包含「${word}」`);
      });
    });
  });

  await check('关键文案与演示标注存在', () => {
    const confirm = fs.readFileSync(path.join(ROOT, 'pages/order-confirm/order-confirm.wxml'), 'utf8');
    assert.ok(confirm.indexOf('未识别到桌号') >= 0, '确认页缺少桌号警示');
    assert.ok(confirm.indexOf('不会自动生成桌号') >= 0, '确认页缺少「不自动生成桌号」说明');
    assert.ok(confirm.indexOf('备注') >= 0);

    const detail = fs.readFileSync(path.join(ROOT, 'pages/order-detail/order-detail.wxml'), 'utf8');
    assert.ok(detail.indexOf('订单编号') >= 0);
    assert.ok(detail.indexOf('状态记录') >= 0);
    assert.ok(detail.indexOf('模拟推进') >= 0);
    assert.ok(detail.indexOf('演示') >= 0, '详情页缺少演示标注');

    const cart = fs.readFileSync(path.join(ROOT, 'pages/cart/cart.wxml'), 'utf8');
    assert.ok(cart.indexOf('全选') >= 0);
    assert.ok(cart.indexOf('去结算') >= 0);
    assert.ok(cart.indexOf('已选') >= 0);

    const orders = fs.readFileSync(path.join(ROOT, 'pages/orders/orders.wxml'), 'utf8');
    assert.ok(orders.indexOf('filter-bar') >= 0);
    assert.ok(orders.indexOf('status-tag') >= 0);
  });

  await check('dev-check 重置演示数据会清空订单序号', () => {
    const source = fs.readFileSync(path.join(ROOT, 'pages/dev-check/dev-check.js'), 'utf8');
    assert.ok(source.indexOf('STORAGE_KEYS.ORDER_SEQ') >= 0);
    assert.ok(source.indexOf('STORAGE_KEYS.SEED_TABLES') >= 0);
  });

  await check('桌号调试入口：开发自检可选桌号，确认页有调试链接', () => {
    const devWxml = fs.readFileSync(path.join(ROOT, 'pages/dev-check/dev-check.wxml'), 'utf8');
    assert.ok(devWxml.indexOf('当前桌号（调试）') >= 0);
    assert.ok(devWxml.indexOf('picker') >= 0);

    const devJs = fs.readFileSync(path.join(ROOT, 'pages/dev-check/dev-check.js'), 'utf8');
    assert.ok(devJs.indexOf('onTablePick') >= 0);
    assert.ok(devJs.indexOf('setTable') >= 0);

    const confirmWxml = fs.readFileSync(path.join(ROOT, 'pages/order-confirm/order-confirm.wxml'), 'utf8');
    assert.ok(confirmWxml.indexOf('onGoDevCheck') >= 0);
    assert.ok(confirmWxml.indexOf('isDev') >= 0, '调试链接必须仅开发版展示');

    const configSource = fs.readFileSync(path.join(ROOT, 'config/index.js'), 'utf8');
    assert.ok(configSource.indexOf('tableSeedVersion') >= 0);
  });

  await check('首页「我的」独立定位在胶囊下方（自定义导航）', () => {
    const homeWxml = fs.readFileSync(path.join(ROOT, 'pages/home/home.wxml'), 'utf8');
    assert.ok(homeWxml.indexOf('top: {{profileTop}}px') >= 0, '「我的」应按 profileTop 定位');
    assert.ok(homeWxml.indexOf('padding-right: {{capsuleSpace}}px') < 0, '旧的右侧挤占方案应移除');

    const homeWxss = fs.readFileSync(path.join(ROOT, 'pages/home/home.wxss'), 'utf8');
    assert.ok(/\.profile-entry\s*\{[^}]*position:\s*absolute/.test(homeWxss), '「我的」需要绝对定位');

    const homeJs = fs.readFileSync(path.join(ROOT, 'pages/home/home.js'), 'utf8');
    assert.ok(homeJs.indexOf('getMenuButtonBoundingClientRect') >= 0, '应读取胶囊位置');
  });

  section('结果');
  console.log(`  通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    failures.forEach((item) => console.log(`  - ${item.name}: ${item.message}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('校验脚本异常：', error);
  process.exitCode = 1;
});