// 第六阶段（老板管理端）离线校验脚本。
// 不依赖微信开发者工具：内存 storage + wx/Page 桩件，跑 services 与页面逻辑，并做静态检查。
// 运行：node scripts/verify_stage6.js
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
const appStub = { globalData: {} };
let lastNavUrl = '';
let lastRedirectUrl = '';
let lastSwitchUrl = '';
let lastToast = '';
let backCount = 0;
let modalConfirmed = true;
let titleSet = '';

global.wx = {
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => {
    store.set(key, value);
  },
  removeStorageSync: (key) => {
    store.delete(key);
  },
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  getWindowInfo: () => ({ statusBarHeight: 20, windowHeight: 700, windowWidth: 375 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 281, right: 368, width: 87, height: 32 }),
  showToast: (options) => {
    lastToast = options.title || '';
  },
  showModal: (options) => {
    if (options.success) options.success({ confirm: modalConfirmed, cancel: !modalConfirmed });
  },
  navigateTo: (options) => {
    lastNavUrl = options.url;
  },
  redirectTo: (options) => {
    lastRedirectUrl = options.url;
  },
  switchTab: (options) => {
    lastSwitchUrl = options.url;
  },
  navigateBack: () => {
    backCount += 1;
  },
  stopPullDownRefresh: () => {},
  setNavigationBarTitle: (options) => {
    titleSet = options.title || '';
  },
  pageScrollTo: () => {}
};
global.getApp = () => appStub;

// Mock 延迟归零，测试才等得起
let config = require(path.join(ROOT, 'config/index'));
config.mockDelay = [0, 0];

const load = (rel) => require(path.join(ROOT, rel));

let authService = load('services/auth');
let orderService = load('services/orders');
let productService = load('services/products');
let categoryService = load('services/categories');
let cartService = load('services/cart');
let statsService = load('services/stats');
let mediaService = load('services/media');
const format = load('utils/format');
const constants = load('utils/constants');

const { ORDER_STATUS, ORDER_STATUS_TEXT, STORAGE_KEYS, EXCEPTION_STATUS, ORDER_LOG_ACTOR } = constants;
const TABLE_ID = load('utils/mock-data/tables')[0].id;
const SEED_PRODUCT_ID = 'p_traditional_01';

// ---------- 工具 ----------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

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
      // 支持 'form.name' / 'list[0].id' 这类路径，和微信 setData 的写法保持一致
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = this.data;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const name = parts[i];
        if (target[name] === undefined || target[name] === null) target[name] = {};
        target = target[name];
      }
      target[parts[parts.length - 1]] = patch[key];
    });
    if (typeof callback === 'function') callback();
  };
  return page;
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
    const tag = match[2];
    if (match[4] === '/') continue;
    if (match[1] === '/') {
      const open = stack.pop();
      if (open !== tag) throw new Error(`${path.relative(ROOT, file)} 标签不匹配：</${tag}> 对应 <${open}>`);
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) throw new Error(`${path.relative(ROOT, file)} 存在未闭合标签：${stack.join(', ')}`);
}

function readOrders() {
  const list = store.get(STORAGE_KEYS.ORDERS);
  return Array.isArray(list) ? list : [];
}

function expectedOverview() {
  const list = readOrders();
  const products = productService.listAllSync();
  const todayKey = format.dateKey();
  const valid = list.filter((order) => order.status !== ORDER_STATUS.CANCELLED);
  const todayValid = valid.filter((order) => format.dateKey(order.createdAt) === todayKey);

  return {
    todayOrderCount: todayValid.length,
    todayRevenue: todayValid.reduce((sum, order) => sum + (order.totalAmount || 0), 0),
    handlingCount: valid.filter(
      (order) => order.status === ORDER_STATUS.PENDING || order.status === ORDER_STATUS.MAKING
    ).length,
    onSaleCount: products.filter((item) => item.isAvailable !== false).length
  };
}

async function resetAll() {
  Object.keys(STORAGE_KEYS).forEach((name) => {
    store.delete(STORAGE_KEYS[name]);
  });
  appStub.globalData = {};
  // 触发订单与商品种子
  await orderService.listOrders({});
  productService.listAllSync();
}

function currentConfigs() {
  return {
    login: loadPage('pages/admin-login/admin-login.js'),
    overview: loadPage('pages/admin-overview/admin-overview.js'),
    orders: loadPage('pages/admin-orders/admin-orders.js'),
    detail: loadPage('pages/admin-order-detail/admin-order-detail.js'),
    products: loadPage('pages/admin-products/admin-products.js'),
    edit: loadPage('pages/admin-product-edit/admin-product-edit.js'),
    my: loadPage('pages/my/my.js')
  };
}

function reloadProject() {
  Object.keys(require.cache).forEach((key) => {
    if (key.indexOf(path.join(ROOT, 'services')) === 0) delete require.cache[key];
    if (key.indexOf(path.join(ROOT, 'utils')) === 0) delete require.cache[key];
  });
  config = require(path.join(ROOT, 'config/index'));
  config.mockDelay = [0, 0];
  authService = load('services/auth');
  orderService = load('services/orders');
  productService = load('services/products');
  categoryService = load('services/categories');
  cartService = load('services/cart');
  statsService = load('services/stats');
  mediaService = load('services/media');
}

async function main() {
  await resetAll();
  const pages = currentConfigs();

  section('一、权限与入口');

  await check('口令错误被拒绝，不写入会话', async () => {
    const res = await authService.login('0000');
    assert.strictEqual(res.code, 4002);
    assert.strictEqual(store.get(STORAGE_KEYS.ADMIN_SESSION), undefined);
  });

  await check('调酒师角色暂未开放（本阶段只做老板端）', async () => {
    const res = await authService.login('8888', authService.ROLES.BARTENDER);
    assert.strictEqual(res.code, 4031);
  });

  await check('正确口令登录：role=owner、mock=true、写入会话', async () => {
    const res = await authService.login(config.demoOwnerPassword);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.role, authService.ROLES.OWNER);
    assert.strictEqual(res.data.mock, true);
    assert.strictEqual(res.data.roleText, '老板');
    assert.ok(store.get(STORAGE_KEYS.ADMIN_SESSION).loginAt > 0);
  });

  await check('requireOwner 放行已登录老板；退出后拦截', async () => {
    const ok = await authService.requireOwner();
    assert.strictEqual(ok.code, 0);
    assert.strictEqual(ok.data.role, authService.ROLES.OWNER);

    await authService.logout();
    const fail = await authService.requireOwner();
    assert.strictEqual(fail.code, 4010);
  });

  await check('旧会话 role=admin 自动归一为 owner（兼容第五阶段）', async () => {
    store.set(STORAGE_KEYS.ADMIN_SESSION, { role: 'admin', name: '店主', loginAt: 1 });
    const session = authService.getSessionSync();
    assert.strictEqual(session.role, authService.ROLES.OWNER);
    assert.strictEqual(session.roleText, '老板');
    const res = await authService.requireOwner();
    assert.strictEqual(res.code, 0);
  });

  await check('未登录进管理页：被重定向到登录页且不加载数据', async () => {
    await authService.logout();
    const page = createPage(pages.overview);
    lastRedirectUrl = '';
    page.onLoad();
    await waitFor(() => lastRedirectUrl.indexOf('/pages/admin-login/admin-login') === 0);

    assert.strictEqual(page.data.session, null);
    assert.ok(page.data.recentOrders.length === 0, '未授权不应加载订单');
  });

  await check('登录页：未登录可提交，成功后跳概览', async () => {
    const page = createPage(pages.login);
    page.onLoad();
    await waitFor(() => page.data.demoPassword.length > 0);
    page.onPasswordInput({ detail: { value: '0000' } });
    lastRedirectUrl = '';
    page.onSubmit();
    await waitFor(() => page.data.error.length > 0);
    assert.ok(page.data.error.indexOf('口令') >= 0);

    page.onPasswordInput({ detail: { value: config.demoOwnerPassword } });
    page.onSubmit();
    await waitFor(() => lastRedirectUrl.indexOf('/pages/admin-overview/admin-overview') === 0);
  });

  await check('登录页：已登录时直接跳概览，不重复登录', async () => {
    const page = createPage(pages.login);
    lastRedirectUrl = '';
    page.onLoad();
    await waitFor(() => lastRedirectUrl.indexOf('/pages/admin-overview/admin-overview') === 0);
  });

  await check('「我的」页：未登录显示「需口令」，登录后显示老板身份并可退出', async () => {
    await authService.logout();
    const page = createPage(pages.my);
    page.onLoad();
    page.onShow();
    assert.strictEqual(page.data.isOwner, false);
    assert.strictEqual(page.data.ownerText, '需口令');

    lastNavUrl = '';
    page.onAdminTap();
    assert.strictEqual(lastNavUrl, '/pages/admin-login/admin-login');

    await authService.login(config.demoOwnerPassword);
    page.onShow();
    assert.strictEqual(page.data.isOwner, true);
    assert.ok(page.data.ownerText.indexOf('老板') >= 0);

    lastNavUrl = '';
    page.onAdminTap();
    assert.strictEqual(lastNavUrl, '/pages/admin-overview/admin-overview');

    modalConfirmed = true;
    page.onLogout();
    await waitFor(() => page.data.isOwner === false);
    assert.strictEqual(store.get(STORAGE_KEYS.ADMIN_SESSION), undefined);
  });

  section('二、经营概览');

  await check('概览口径：今日订单/营业额/待处理/在售商品与订单商品数据一致', async () => {
    await authService.login(config.demoOwnerPassword);
    const res = await statsService.getAdminOverview();
    assert.strictEqual(res.code, 0);

    const expected = expectedOverview();
    assert.strictEqual(res.data.todayOrderCount, expected.todayOrderCount);
    assert.strictEqual(res.data.todayRevenue, expected.todayRevenue);
    assert.strictEqual(res.data.handlingCount, expected.handlingCount);
    assert.strictEqual(res.data.onSaleCount, expected.onSaleCount);
    assert.ok(res.data.todayOrderCount > 0, '演示数据里今日应有订单');
  });

  await check('已取消订单不计入今日订单数与营业额', async () => {
    const before = await statsService.getAdminOverview();
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }],
      remark: '概览口径测试'
    });
    const amount = created.data.totalAmount;

    const afterCreate = await statsService.getAdminOverview();
    assert.strictEqual(afterCreate.data.todayOrderCount, before.data.todayOrderCount + 1);
    assert.strictEqual(afterCreate.data.todayRevenue, before.data.todayRevenue + amount);

    await orderService.cancelOrder(created.data.id, { by: 'customer', reason: '口径测试' });
    const afterCancel = await statsService.getAdminOverview();
    assert.strictEqual(afterCancel.data.todayOrderCount, before.data.todayOrderCount, '取消后不计入订单数');
    assert.strictEqual(afterCancel.data.todayRevenue, before.data.todayRevenue, '取消后不计入营业额');
    assert.strictEqual(afterCancel.data.todayCancelledCount, before.data.todayCancelledCount + 1);
  });

  await check('概览页渲染：四个指标、最近订单与日期', async () => {
    const page = createPage(pages.overview);
    page.onLoad();
    await waitFor(() => page.data.loading === false && page.data.session);

    const expected = expectedOverview();
    assert.strictEqual(page.data.overview.todayOrderCount, expected.todayOrderCount);
    assert.strictEqual(page.data.overview.handlingCount, expected.handlingCount);
    assert.strictEqual(page.data.overview.onSaleCount, expected.onSaleCount);
    assert.ok(/^\d+\.\d{2}$/.test(page.data.overview.todayRevenueText), '营业额应保留两位小数');
    assert.ok(/^\d{4}\.\d{2}\.\d{2}$/.test(page.data.dateText), '日期格式应为 YYYY.MM.DD');
    assert.ok(page.data.recentOrders.length > 0 && page.data.recentOrders.length <= 5);
    assert.ok(page.data.updatedText.indexOf('更新于') >= 0);

    const card = page.data.recentOrders[0];
    ['id', 'orderNo', 'status', 'statusText', 'tableText', 'timeText', 'amountText'].forEach((field) => {
      assert.ok(Object.prototype.hasOwnProperty.call(card, field), `最近订单缺少 ${field}`);
    });

    lastNavUrl = '';
    page.onOrderTap({ currentTarget: { dataset: { id: card.id } } });
    assert.strictEqual(lastNavUrl, `/pages/admin-order-detail/admin-order-detail?id=${card.id}`);

    lastRedirectUrl = '';
    page.onGoOrders();
    assert.strictEqual(lastRedirectUrl, '/pages/admin-orders/admin-orders');
    page.onGoProducts();
    assert.strictEqual(lastRedirectUrl, '/pages/admin-products/admin-products');
  });

  section('三、订单管理');

  await check('订单列表：全部订单含四种状态，计数与列表一致', async () => {
    // 造一单已完成、保证四种状态都有
    const done = await orderService.createOrder({ tableId: TABLE_ID, items: [{ productId: SEED_PRODUCT_ID, qty: 1 }] });
    await orderService.updateOrderStatus(done.data.id, ORDER_STATUS.MAKING, 'owner');
    await orderService.updateOrderStatus(done.data.id, ORDER_STATUS.COMPLETED, 'owner');

    const page = createPage(pages.orders);
    page.onLoad();
    await waitFor(() => page.data.loading === false && page.data.orders.length > 0);

    assert.strictEqual(page.data.filters.length, 5, '应为「全部」+ 四个状态');
    assert.strictEqual(page.data.filters[0].value, '');
    assert.strictEqual(page.data.filters[0].text, '全部');
    assert.strictEqual(page.data.activeStatus, '', '管理端默认看全部');
    assert.strictEqual(page.data.counts.all, page.data.total);

    const counts = await orderService.adminOrderCounts();
    assert.strictEqual(page.data.counts.pending, counts.data.pending);
    assert.strictEqual(page.data.counts.making, counts.data.making);
    assert.strictEqual(page.data.counts.completed, counts.data.completed);
    assert.strictEqual(page.data.counts.cancelled, counts.data.cancelled);
    assert.ok(page.data.counts.pending > 0 && page.data.counts.completed > 0);
  });

  await check('按状态筛选：列表只保留该状态，切回「全部」恢复', async () => {
    const page = createPage(pages.orders);
    page.onLoad();
    await waitFor(() => page.data.loading === false);

    page.onFilterTap({ currentTarget: { dataset: { status: ORDER_STATUS.MAKING } } });
    await waitFor(() => page.data.loading === false && page.data.activeStatus === ORDER_STATUS.MAKING);
    assert.ok(page.data.orders.length > 0);
    assert.ok(page.data.orders.every((item) => item.status === ORDER_STATUS.MAKING));
    assert.strictEqual(page.data.activeText, '制作中');

    page.onFilterTap({ currentTarget: { dataset: { status: ORDER_STATUS.CANCELLED } } });
    await waitFor(() => page.data.loading === false && page.data.activeStatus === ORDER_STATUS.CANCELLED);
    assert.ok(page.data.orders.every((item) => item.status === ORDER_STATUS.CANCELLED));

    page.onFilterTap({ currentTarget: { dataset: { status: '' } } });
    await waitFor(() => page.data.loading === false && page.data.activeStatus === '');
    assert.strictEqual(page.data.activeText, '全部');
    assert.strictEqual(page.data.total, page.data.counts.all);
  });

  await check('订单详情：编号/桌号/时间/单价/数量/小计/备注/总额', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [
        { productId: SEED_PRODUCT_ID, qty: 2 },
        { productId: 'p_snacks_01', qty: 1 }
      ],
      remark: '不要冰块'
    });

    const page = createPage(pages.detail);
    page.onLoad({ id: created.data.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    assert.strictEqual(page.data.order.orderNo, created.data.orderNo);
    assert.strictEqual(page.data.order.tableName, 'A1');
    assert.ok(page.data.timeText.indexOf('.') > 0);
    assert.strictEqual(page.data.items.length, 2);
    assert.strictEqual(page.data.items[0].priceText, '58.00');
    assert.strictEqual(page.data.items[0].subtotalText, '116.00');
    assert.strictEqual(page.data.totalText, (created.data.totalAmount / 100).toFixed(2));
    assert.strictEqual(page.data.order.remark, '不要冰块');
    assert.strictEqual(page.data.statusText, '待接单');
    assert.strictEqual(page.data.canAdvance, true);
    assert.strictEqual(page.data.canCancel, true);
    assert.strictEqual(page.data.canMarkException, true);
    assert.strictEqual(page.data.canResolveException, false);
    assert.ok(titleSet.indexOf(created.data.orderNo) > 0, '导航标题应带订单编号');
  });

  await check('老板改状态后顾客端列表同步（同一份订单数据）', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });

    const adminPage = createPage(pages.detail);
    adminPage.onLoad({ id: created.data.id });
    await waitFor(() => adminPage.data.loading === false && adminPage.data.order);

    modalConfirmed = true;
    adminPage.onAdvance();
    await waitFor(() => adminPage.data.order.status === ORDER_STATUS.MAKING);
    assert.strictEqual(adminPage.data.statusText, '制作中');

    // 顾客端页面：同一 services，应该看到「制作中」
    const customerPage = createPage(loadPage('pages/orders/orders.js'));
    customerPage.onShow();
    await waitFor(() => customerPage.data.loading === false);
    customerPage.onFilterTap({ currentTarget: { dataset: { status: ORDER_STATUS.MAKING } } });
    await waitFor(
      () => customerPage.data.loading === false && customerPage.data.activeStatus === ORDER_STATUS.MAKING
    );
    assert.ok(
      customerPage.data.orders.some((item) => item.id === created.data.id),
      '顾客端「制作中」应包含该订单'
    );

    // 顾客端详情页看到的时间线操作人是老板
    const customerDetail = createPage(loadPage('pages/order-detail/order-detail.js'));
    customerDetail.onLoad({ id: created.data.id });
    await waitFor(() => customerDetail.data.loading === false && customerDetail.data.order);
    assert.strictEqual(customerDetail.data.statusText, '制作中');
    const lastLog = customerDetail.data.logs[customerDetail.data.logs.length - 1];
    assert.strictEqual(lastLog.actorText, ORDER_LOG_ACTOR.owner);
  });

  await check('状态推进只能前进：待接单 → 制作中 → 已完成，不可跳过', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });

    const jump = await orderService.updateOrderStatus(created.data.id, ORDER_STATUS.COMPLETED, 'owner');
    assert.notStrictEqual(jump.code, 0, '不允许从待接单直接到已完成');

    const page = createPage(pages.detail);
    page.onLoad({ id: created.data.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    modalConfirmed = true;
    page.onAdvance();
    await waitFor(() => page.data.order.status === ORDER_STATUS.MAKING);
    assert.strictEqual(page.data.canMarkException, true);
    assert.strictEqual(page.data.canResolveException, false);

    page.onAdvance();
    await waitFor(() => page.data.order.status === ORDER_STATUS.COMPLETED);
    assert.strictEqual(page.data.canAdvance, false);
    assert.strictEqual(page.data.canCancel, false);
    assert.strictEqual(page.data.canMarkException, false);
    assert.strictEqual(page.data.logs.length, 3);
  });

  await check('老板取消：必须填原因，取消后顾客端同步为已取消', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });
    await orderService.updateOrderStatus(created.data.id, ORDER_STATUS.MAKING, 'owner');

    const noReason = await orderService.cancelOrder(created.data.id, { by: 'owner' });
    assert.strictEqual(noReason.code, 4011);

    const page = createPage(pages.detail);
    page.onLoad({ id: created.data.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    page.onOpenCancel();
    assert.strictEqual(page.data.panel, 'cancel');
    lastToast = '';
    page.onSubmitPanel();
    assert.ok(lastToast.indexOf('原因') >= 0, '空原因应被页面拦下');

    page.onReasonInput({ detail: { value: '顾客临时离店' } });
    page.onSubmitPanel();
    await waitFor(() => page.data.order && page.data.order.status === ORDER_STATUS.CANCELLED);
    assert.strictEqual(page.data.canCancel, false);
    assert.ok(page.data.order.cancelReason.indexOf('顾客临时离店') >= 0);

    const customer = await orderService.getOrder(created.data.id);
    assert.strictEqual(customer.data.status, ORDER_STATUS.CANCELLED);
  });

  await check('已完成订单不可取消', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });
    await orderService.updateOrderStatus(created.data.id, ORDER_STATUS.MAKING, 'owner');
    await orderService.updateOrderStatus(created.data.id, ORDER_STATUS.COMPLETED, 'owner');
    const res = await orderService.cancelOrder(created.data.id, { by: 'owner', reason: '试试' });
    assert.strictEqual(res.code, 4009);
  });

  await check('异常：必须填原因，标记后状态不变且进入待处理', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });

    const noReason = await orderService.markOrderException(created.data.id, { reason: '' });
    assert.strictEqual(noReason.code, 4012);

    const res = await orderService.markOrderException(created.data.id, { reason: '缺货', by: 'owner' });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.exception.status, EXCEPTION_STATUS.OPEN);
    assert.strictEqual(res.data.exception.reason, '缺货');
    assert.strictEqual(res.data.status, ORDER_STATUS.PENDING, '异常不改变订单状态');

    const again = await orderService.markOrderException(created.data.id, { reason: '再标一次' });
    assert.strictEqual(again.code, 4014);

    const counts = await orderService.adminOrderCounts();
    assert.ok(counts.data.openExceptions >= 1);
  });

  await check('异常：处理需说明，处理后转为已处理并写时间线', async () => {
    const open = readOrders().find((order) => order.exception && order.exception.status === EXCEPTION_STATUS.OPEN);
    assert.ok(open, '需要一条待处理异常');

    const noNote = await orderService.resolveOrderException(open.id, { resolution: '' });
    assert.strictEqual(noNote.code, 4015);

    const res = await orderService.resolveOrderException(open.id, { resolution: '已补货并重新出品' });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.exception.status, EXCEPTION_STATUS.RESOLVED);
    assert.strictEqual(res.data.exception.resolution, '已补货并重新出品');
    assert.ok(res.data.statusLogs[res.data.statusLogs.length - 1].note.indexOf('异常已处理') >= 0);

    const counts = await orderService.adminOrderCounts();
    assert.ok(counts.data.openExceptions >= 0);
  });

  await check('已完成/已取消订单不能标记异常', async () => {
    const done = readOrders().find((order) => order.status === ORDER_STATUS.COMPLETED);
    assert.ok(done, '需要一条已完成订单');
    const res = await orderService.markOrderException(done.id, { reason: '缺货' });
    assert.strictEqual(res.code, 4013);
  });

  await check('详情页异常流程：快捷原因 → 提交 → 解除', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 2 }]
    });

    const page = createPage(pages.detail);
    page.onLoad({ id: created.data.id });
    await waitFor(() => page.data.loading === false && page.data.order);

    page.onOpenException();
    assert.strictEqual(page.data.panel, 'exception');
    page.onQuickReason({ currentTarget: { dataset: { reason: '无法制作' } } });
    assert.strictEqual(page.data.reason, '无法制作');
    page.onSubmitPanel();
    await waitFor(() => page.data.order.exception && page.data.order.exception.status === EXCEPTION_STATUS.OPEN);
    assert.strictEqual(page.data.canMarkException, false);
    assert.strictEqual(page.data.canResolveException, true);

    page.onOpenResolve();
    assert.strictEqual(page.data.panel, 'resolve');
    page.onReasonInput({ detail: { value: '换成同价位另一款' } });
    page.onSubmitPanel();
    await waitFor(
      () => page.data.order.exception && page.data.order.exception.status === EXCEPTION_STATUS.RESOLVED
    );
    assert.strictEqual(page.data.canResolveException, false);
    assert.strictEqual(page.data.exceptionText, '异常已处理');
  });

  await check('列表卡片展示待处理异常', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });
    await orderService.markOrderException(created.data.id, { reason: '缺货', by: 'owner' });

    const page = createPage(pages.orders);
    page.onLoad();
    await waitFor(() => page.data.loading === false && page.data.orders.length > 0);

    const hit = page.data.orders.find((item) => item.id === created.data.id);
    assert.ok(hit, '列表应包含该订单');
    assert.strictEqual(hit.hasException, true);
    assert.strictEqual(hit.exceptionReason, '缺货');
  });

  section('四、商品管理');

  await check('商品列表：包含下架商品，分类与搜索筛选正确', async () => {
    const page = createPage(pages.products);
    page.onLoad();
    await waitFor(() => page.data.loading === false && page.data.products.length > 0);

    assert.strictEqual(page.data.categories.length, 5, '「全部」+ 四个分类');
    assert.strictEqual(page.data.products.length, page.data.counts.total);
    assert.ok(page.data.products.every((item) => item.categoryName && item.priceText));

    page.onCategoryTap({ currentTarget: { dataset: { id: 'signature' } } });
    await waitFor(() => page.data.loading === false && page.data.activeCategory === 'signature');
    assert.ok(page.data.products.length > 0);
    assert.ok(page.data.products.every((item) => item.categoryName === '特调饮品'));

    page.onCategoryTap({ currentTarget: { dataset: { id: '' } } });
    await waitFor(() => page.data.loading === false && page.data.activeCategory === '');
    page.onKeywordInput({ detail: { value: 'zzz-not-exist' } });
    page.onSearchConfirm();
    await waitFor(() => page.data.loading === false && page.data.products.length === 0);
    page.onClearKeyword();
    await waitFor(() => page.data.loading === false && page.data.products.length > 0);
  });

  await check('新增商品：页面输入元，服务层存整数分', async () => {
    const page = createPage(pages.edit);
    page.onLoad({});
    await waitFor(() => page.data.loading === false && page.data.categories.length > 0);

    page.onNameInput({ detail: { value: '示例·测试特调 07' } });
    page.onNameEnInput({ detail: { value: 'Demo Test 07' } });
    page.onPriceInput({ detail: { value: '58.5' } });
    page.onDescInput({ detail: { value: '测试用示例商品' } });
    page.onSave();
    await waitFor(() => productService.listAllSync().some((item) => item.name === '示例·测试特调 07'));

    const created = productService.listAllSync().find((item) => item.name === '示例·测试特调 07');
    assert.strictEqual(created.price, 5850, '58.5 元应为 5850 分');
    assert.strictEqual(created.isAvailable, true);
    assert.strictEqual(created.image, '', '新增商品默认无图，走占位块');
    assert.strictEqual(created.category, 'traditional');
  });

  await check('价格校验：非法输入不提交，错误提示可见', async () => {
    const page = createPage(pages.edit);
    page.onLoad({});
    await waitFor(() => page.data.loading === false && page.data.categories.length > 0);

    page.onNameInput({ detail: { value: '示例·非法价格' } });
    page.onPriceInput({ detail: { value: 'abc' } });
    page.onSave();
    await waitFor(() => page.data.error.length > 0);
    assert.ok(page.data.error.indexOf('价格') >= 0);
    assert.ok(!productService.listAllSync().some((item) => item.name === '示例·非法价格'));

    page.onPriceInput({ detail: { value: '-1' } });
    page.onSave();
    await waitFor(() => page.data.error.length > 0);
    assert.ok(!productService.listAllSync().some((item) => item.name === '示例·非法价格'));

    page.onPriceInput({ detail: { value: '1.234' } });
    page.onSave();
    await waitFor(() => page.data.error.length > 0);
  });

  await check('编辑商品：改名称/价格/分类/介绍，图片字段不被覆盖', async () => {
    // 先给商品塞一张图，模拟维护者写入的长期地址
    await productService.updateProduct(SEED_PRODUCT_ID, { image: 'assets/demo/rose.png' });

    const page = createPage(pages.edit);
    page.onLoad({ id: SEED_PRODUCT_ID });
    await waitFor(() => page.data.loading === false && page.data.form.name.length > 0);

    assert.strictEqual(page.data.mode, 'edit');
    assert.strictEqual(page.data.imageUrl, 'assets/demo/rose.png', '编辑页应回显图片');
    assert.strictEqual(page.data.form.priceYuan, '58.00', '价格按元回填');

    page.onNameInput({ detail: { value: '示例·改名后的传统饮品' } });
    page.onPriceInput({ detail: { value: '99.00' } });
    page.onDescInput({ detail: { value: '改过的介绍' } });
    page.onCategoryChange({ detail: { value: 2 } });
    page.onSave();
    await waitFor(() => {
      const hit = productService.listAllSync().find((item) => item.id === SEED_PRODUCT_ID);
      return hit && hit.price === 9900;
    });

    const updated = productService.listAllSync().find((item) => item.id === SEED_PRODUCT_ID);
    assert.strictEqual(updated.name, '示例·改名后的传统饮品');
    assert.strictEqual(updated.description, '改过的介绍');
    assert.strictEqual(updated.category, 'non_alcoholic');
    assert.strictEqual(updated.image, 'assets/demo/rose.png', '图片不能被编辑页清空');
  });

  await check('历史订单快照不受改价影响', async () => {
    const created = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 2 }]
    });
    const oldTotal = created.data.totalAmount;
    const oldPrice = created.data.items[0].price;

    await productService.updateProduct(SEED_PRODUCT_ID, { price: 12345 });

    const res = await orderService.getOrder(created.data.id);
    assert.strictEqual(res.data.items[0].price, oldPrice, '订单条目价格应保留下单时快照');
    assert.strictEqual(res.data.items[0].subtotal, oldPrice * 2);
    assert.strictEqual(res.data.totalAmount, oldTotal);
  });

  await check('下架后：酒单不显示、不能加购、不能下单', async () => {
    const page = createPage(pages.products);
    page.onLoad();
    await waitFor(() => page.data.loading === false && page.data.products.length > 0);

    page.onToggle({ currentTarget: { dataset: { id: SEED_PRODUCT_ID } }, detail: { value: false } });
    await waitFor(() => {
      const hit = productService.listAllSync().find((item) => item.id === SEED_PRODUCT_ID);
      return hit && hit.isAvailable === false;
    });

    // 顾客端酒单
    const customerList = await productService.listProducts({});
    assert.ok(!customerList.data.some((item) => item.id === SEED_PRODUCT_ID), '酒单不应显示下架商品');

    // 加购被拒
    const add = await cartService.addItem(SEED_PRODUCT_ID, 1);
    assert.strictEqual(add.code, 4040);

    // 下单被拒
    const order = await orderService.createOrder({
      tableId: TABLE_ID,
      items: [{ productId: SEED_PRODUCT_ID, qty: 1 }]
    });
    assert.strictEqual(order.code, 4004);
  });

  await check('购物车里已存在的下架商品自动剔除', async () => {
    // 先上架加购，再下架
    await productService.setProductAvailability(SEED_PRODUCT_ID, true);
    await cartService.clear();
    await cartService.addItem(SEED_PRODUCT_ID, 2);
    let cart = await cartService.getCart();
    assert.strictEqual(cart.data.items.length, 1);

    await productService.setProductAvailability(SEED_PRODUCT_ID, false);
    cart = await cartService.getCart();
    assert.strictEqual(cart.data.items.length, 0, '下架商品应从购物车剔除');
    assert.strictEqual(cart.data.selectedQty, 0);
  });

  await check('重新上架后酒单与加购恢复', async () => {
    await productService.setProductAvailability(SEED_PRODUCT_ID, true);
    const list = await productService.listProducts({});
    assert.ok(list.data.some((item) => item.id === SEED_PRODUCT_ID));
    const add = await cartService.addItem(SEED_PRODUCT_ID, 1);
    assert.strictEqual(add.code, 0);
    await cartService.clear();
  });

  await check('新增商品可指定下架，顾客端立即不可见', async () => {
    const page = createPage(pages.edit);
    page.onLoad({});
    await waitFor(() => page.data.loading === false && page.data.categories.length > 0);

    page.onNameInput({ detail: { value: '示例·默认下架' } });
    page.onPriceInput({ detail: { value: '10' } });
    page.onAvailableChange({ detail: { value: false } });
    page.onSave();
    await waitFor(() => productService.listAllSync().some((item) => item.name === '示例·默认下架'));

    const created = productService.listAllSync().find((item) => item.name === '示例·默认下架');
    assert.strictEqual(created.isAvailable, false);
    const list = await productService.listProducts({});
    assert.ok(!list.data.some((item) => item.id === created.id));
  });

  await check('商品编辑页只读：无上传控件，含维护说明，临时路径不会被写入', async () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/admin-product-edit/admin-product-edit.wxml'), 'utf8');
    assert.ok(wxml.indexOf('图片由系统维护人员统一更新') >= 0, '缺少图片来源说明');
    assert.ok(wxml.indexOf('chooseMedia') < 0 && wxml.indexOf('chooseImage') < 0, '不应出现相册选择');
    assert.ok(wxml.indexOf('imageUrl') >= 0, '应只读回显 image');

    const res = await mediaService.uploadProductImage({ productId: SEED_PRODUCT_ID, filePath: 'wxfile://tmp.png' });
    assert.strictEqual(res.code, 4030, '维护接口应明确未开放');
    assert.strictEqual(mediaService.isAcceptableImage({ size: 1024, type: 'image/png' }), true);
    assert.strictEqual(mediaService.isAcceptableImage({ size: 9 * 1024 * 1024, type: 'image/png' }), false);

    // 服务层不会因为页面传了临时路径就落库（updateProduct 只认 image 字段，页面不传）
    const before = productService.listAllSync().find((item) => item.id === SEED_PRODUCT_ID).image;
    await productService.updateProduct(SEED_PRODUCT_ID, { price: 5000 });
    const after = productService.listAllSync().find((item) => item.id === SEED_PRODUCT_ID).image;
    assert.strictEqual(after, before);
  });

  await check('价格换算：字符串解析避免浮点误差', () => {
    assert.strictEqual(format.yuanToFen('58'), 5800);
    assert.strictEqual(format.yuanToFen('58.5'), 5850);
    assert.strictEqual(format.yuanToFen('58.05'), 5805);
    assert.strictEqual(format.yuanToFen('0.1'), 10);
    assert.strictEqual(format.yuanToFen('0.01'), 1);
    assert.strictEqual(format.yuanToFen(19.9), 1990);
    assert.strictEqual(format.yuanToFen('abc'), null);
    assert.strictEqual(format.yuanToFen('-1'), null);
    assert.strictEqual(format.yuanToFen('1.234'), null);
    assert.strictEqual(format.yuanToFen(''), null);
    assert.strictEqual(format.fenToYuanInput(5850), '58.50');
  });

  section('五、数据一致性与持久化');

  await check('金额全部为整数分', async () => {
    readOrders().forEach((order) => {
      assert.ok(Number.isInteger(order.totalAmount), `订单 ${order.orderNo} 总额不是整数分`);
      (order.items || []).forEach((item) => {
        assert.ok(Number.isInteger(item.price), '商品单价不是整数分');
        assert.ok(Number.isInteger(item.subtotal), '小计不是整数分');
      });
    });
    productService.listAllSync().forEach((item) => {
      assert.ok(Number.isInteger(item.price), `商品 ${item.id} 价格不是整数分`);
    });
  });

  await check('管理页不直接读写 storage（统一走 services）', () => {
    ['admin-overview', 'admin-orders', 'admin-order-detail', 'admin-products', 'admin-product-edit'].forEach((name) => {
      const source = fs.readFileSync(path.join(ROOT, `pages/${name}/${name}.js`), 'utf8');
      assert.ok(source.indexOf('utils/storage') < 0, `${name} 不应直接引用 storage`);
      assert.ok(source.indexOf('setStorageSync') < 0, `${name} 不应直接写 storage`);
      assert.ok(source.indexOf('admin-guard') >= 0, `${name} 缺少页面守卫`);
    });
  });

  await check('关闭再打开小程序：订单与商品改动仍在', async () => {
    const orderTotal = readOrders().length;
    const productCount = productService.listAllSync().length;
    const renamed = productService.listAllSync().find((item) => item.id === SEED_PRODUCT_ID).name;

    reloadProject();

    const ordersAfter = await orderService.listOrders({});
    assert.strictEqual(ordersAfter.data.length, orderTotal, '订单不应丢失');
    const productsAfter = productService.listAllSync();
    assert.strictEqual(productsAfter.length, productCount, '商品不应丢失');
    assert.strictEqual(productsAfter.find((item) => item.id === SEED_PRODUCT_ID).name, renamed, '改名应持久化');

    const session = await authService.getSession();
    assert.strictEqual(session.code, 0);
    assert.ok(session.data, '登录态应保留');
  });

  section('六、静态检查（路由 / 组件 / 文案）');

  const appJson = readJson(path.join(ROOT, 'app.json'));
  const ADMIN_PAGES = [
    'pages/admin-login/admin-login',
    'pages/admin-overview/admin-overview',
    'pages/admin-orders/admin-orders',
    'pages/admin-order-detail/admin-order-detail',
    'pages/admin-products/admin-products',
    'pages/admin-product-edit/admin-product-edit'
  ];

  await check('app.json 注册 6 个管理页且文件齐全', () => {
    ADMIN_PAGES.forEach((page) => {
      assert.ok(appJson.pages.indexOf(page) >= 0, `app.json 缺少 ${page}`);
      ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
        assert.ok(fs.existsSync(path.join(ROOT, `${page}.${ext}`)), `缺少 ${page}.${ext}`);
      });
    });
  });

  await check('底部导航仍为 4 个 Tab，管理端不使用原生 Tab', () => {
    assert.strictEqual(appJson.tabBar.list.length, 4);
    appJson.tabBar.list.forEach((tab) => {
      assert.ok(ADMIN_PAGES.indexOf(tab.pagePath) < 0, '管理页不应进原生 tabBar');
    });
  });

  await check('管理页 JSON 引用的组件都存在', () => {
    ADMIN_PAGES.forEach((page) => {
      const json = readJson(path.join(ROOT, `${page}.json`));
      Object.values(json.usingComponents || {}).forEach((componentPath) => {
        const base = path.join(ROOT, componentPath.replace(/^\//, ''));
        ['js', 'wxml', 'json'].forEach((ext) => {
          assert.ok(fs.existsSync(`${base}.${ext}`), `${page} 引用的组件缺少 ${ext}：${componentPath}`);
        });
      });
    });
  });

  await check('管理页 WXML 标签闭合', () => {
    ADMIN_PAGES.forEach((page) => {
      checkWxmlBalance(path.join(ROOT, `${page}.wxml`));
    });
  });

  await check('管理页不含已废弃状态，且都带「演示」标注', () => {
    ADMIN_PAGES.forEach((page) => {
      const wxml = fs.readFileSync(path.join(ROOT, `${page}.wxml`), 'utf8');
      const js = fs.readFileSync(path.join(ROOT, `${page}.js`), 'utf8');
      ['待取餐', '已接单'].forEach((word) => {
        assert.ok(wxml.indexOf(word) < 0, `${page}.wxml 仍包含「${word}」`);
        assert.ok(js.indexOf(word) < 0, `${page}.js 仍包含「${word}」`);
      });
      assert.ok(wxml.indexOf('演示') >= 0, `${page}.wxml 缺少演示标注`);
    });
  });

  await check('Mock 权限说明在登录页与页面守卫中都有体现', () => {
    const loginWxml = fs.readFileSync(path.join(ROOT, 'pages/admin-login/admin-login.wxml'), 'utf8');
    assert.ok(loginWxml.indexOf('Mock 权限') >= 0, '登录页应明确区分 Mock 与正式权限');
    assert.ok(loginWxml.indexOf('云函数') >= 0, '应说明正式版由服务端校验');
    assert.ok(loginWxml.indexOf('安全边界') >= 0);

    const loginJs = fs.readFileSync(path.join(ROOT, 'pages/admin-login/admin-login.js'), 'utf8');
    assert.ok(loginJs.indexOf('redirectTo') >= 0, '登录成功应跳转概览');

    const guard = fs.readFileSync(path.join(ROOT, 'utils/admin-guard.js'), 'utf8');
    assert.ok(guard.indexOf('requireOwner') >= 0);
    assert.ok(guard.indexOf('admin-login') >= 0);
  });

  await check('商品图片：服务端无上传实现，页面无相册调用', () => {
    const files = walk(path.join(ROOT, 'pages'), ['.js', '.wxml']).concat(walk(path.join(ROOT, 'services'), ['.js']));
    files.forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');
      ['wx.chooseMedia', 'wx.chooseImage', 'chooseMessageFile'].forEach((word) => {
        assert.ok(source.indexOf(word) < 0, `${path.relative(ROOT, file)} 仍包含 ${word}`);
      });
    });
  });

  await check('管理端组件：admin-nav 三项、label-block 占位块', () => {
    const navJs = fs.readFileSync(path.join(ROOT, 'components/admin-nav/admin-nav.js'), 'utf8');
    ['overview', 'orders', 'products'].forEach((key) => {
      assert.ok(navJs.indexOf(key) >= 0, `admin-nav 缺少 ${key}`);
    });
    assert.ok(navJs.indexOf('redirectTo') >= 0, '管理端切页应使用 redirectTo');

    const labelWxml = fs.readFileSync(path.join(ROOT, 'components/label-block/label-block.wxml'), 'utf8');
    assert.ok(labelWxml.indexOf('lb') >= 0);
    assert.ok(labelWxml.indexOf('示例图') >= 0);
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