// 第七阶段（调酒师工作台）离线校验脚本。
// 不依赖微信开发者工具：用内存 storage 与 wx 桩件跑 services / 页面逻辑，并静态检查 WXML/JSON/文案。
// 运行：node scripts/verify_stage7.js
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

// ---------- wx 桩件 ----------
const store = new Map();
let lastToast = '';
let lastRedirect = '';
let lastNav = '';
let lastSwitch = '';
let modalConfirm = true;
let modalCount = 0;
let netHandler = null;
let audioPlays = 0;
let audioDestroyed = 0;

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
  showToast: (options) => {
    lastToast = options.title || '';
  },
  showModal: (options) => {
    modalCount += 1;
    if (options.success) options.success({ confirm: modalConfirm, cancel: !modalConfirm });
  },
  navigateTo: (options) => {
    lastNav = options.url;
  },
  redirectTo: (options) => {
    lastRedirect = options.url;
  },
  switchTab: (options) => {
    lastSwitch = options.url;
  },
  navigateBack: () => {},
  stopPullDownRefresh: () => {},
  setNavigationBarTitle: () => {},
  pageScrollTo: () => {},
  vibrateShort: () => {},
  getNetworkType: (options) => {
    if (options.success) options.success({ networkType: 'wifi' });
  },
  onNetworkStatusChange: (handler) => {
    netHandler = handler;
  },
  offNetworkStatusChange: (handler) => {
    if (netHandler === handler) netHandler = null;
  },
  createInnerAudioContext: () => ({
    src: '',
    loop: false,
    play: () => {
      audioPlays += 1;
    },
    stop: () => {},
    destroy: () => {
      audioDestroyed += 1;
    }
  })
};
global.getApp = () => ({ globalData: {} });

const config = require(path.join(ROOT, 'config/index'));
config.mockDelay = [0, 0];
config.orderFeedIntervalMs = 1000;

let authService = require(path.join(ROOT, 'services/auth'));
let orderService = require(path.join(ROOT, 'services/orders'));
let tableService = require(path.join(ROOT, 'services/tables'));
let feedFactory = require(path.join(ROOT, 'services/order-feed'));
let constants = require(path.join(ROOT, 'utils/constants'));

const {
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_STATUS_LIST,
  WORKBENCH_STATUS_LIST,
  ORDER_TRANSITIONS,
  STORAGE_KEYS
} = constants;

const TABLE_ID = require(path.join(ROOT, 'utils/mock-data/tables'))[0].id;
const PRODUCT_ID = require(path.join(ROOT, 'utils/mock-data/products')).find(
  (item) => item.isAvailable !== false
).id;

// ---------- 页面桩件 ----------
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
      this.data[key] = patch[key];
    });
    if (typeof callback === 'function') callback();
  };
  return page;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = async () => {
      let ok = false;
      try {
        ok = Boolean(await predicate());
      } catch (error) {
        ok = false;
      }
      if (ok) return resolve();
      if (Date.now() - startedAt > timeout) return reject(new Error('等待页面状态超时'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function resetState() {
  store.clear();
  lastToast = '';
  lastRedirect = '';
  lastNav = '';
  lastSwitch = '';
  netHandler = null;
  audioPlays = 0;
  audioDestroyed = 0;
  modalConfirm = true;
  modalCount = 0;
}

function loginBartender() {
  return authService.login(config.demoBartenderPassword, authService.ROLES.BARTENDER);
}

function loginOwner() {
  return authService.login(config.demoOwnerPassword, authService.ROLES.OWNER);
}

async function createOrder(remark) {
  const res = await orderService.createOrder({
    tableId: TABLE_ID,
    items: [{ productId: PRODUCT_ID, qty: 1 }],
    remark: remark || ''
  });
  assert.strictEqual(res.code, 0, `下单失败：${res.message}`);
  return res.data;
}

async function loadOrder(id) {
  return orderService.getOrder(id);
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
  if (stack.length) throw new Error(`${path.relative(ROOT, file)} 存在未闭合标签：${stack.join(', ')}`);
}

async function main() {
  resetState();
  const pagesConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

  section('一、角色与登录');

  await check('调酒师口令 1234 登录成功：role=bartender、mock=true', async () => {
    const res = await loginBartender();
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.role, authService.ROLES.BARTENDER);
    assert.strictEqual(res.data.roleText, '调酒师');
    assert.strictEqual(res.data.mock, true);
    assert.ok(store.get(STORAGE_KEYS.BARTENDER_SESSION), '会话应写入调酒师专用 key');
    assert.strictEqual(store.get(STORAGE_KEYS.ADMIN_SESSION), undefined, '不应污染老板会话');
  });

  await check('调酒师口令错误被拒绝', async () => {
    const res = await authService.login('0000', authService.ROLES.BARTENDER);
    assert.strictEqual(res.code, 4002);
  });

  await check('老板口令不能登录调酒师', async () => {
    const res = await authService.login(config.demoOwnerPassword, authService.ROLES.BARTENDER);
    assert.strictEqual(res.code, 4002);
  });

  await check('老板口令仍可登录老板端，两份会话同时存在', async () => {
    const res = await loginOwner();
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.role, authService.ROLES.OWNER);
    assert.ok(store.get(STORAGE_KEYS.ADMIN_SESSION));
    assert.ok(store.get(STORAGE_KEYS.BARTENDER_SESSION));
  });

  await check('requireBartender 放行，requireOwner 拒绝调酒师身份', async () => {
    authService.logout(authService.ROLES.OWNER);
    const ok = await authService.requireBartender();
    assert.strictEqual(ok.code, 0);
    assert.strictEqual(ok.data.role, authService.ROLES.BARTENDER);

    const blocked = await authService.requireOwner();
    assert.strictEqual(blocked.code, 4010);
    assert.ok(blocked.message.indexOf('老板') >= 0);
  });

  await check('退出调酒师只清调酒师会话，老板会话不受影响', async () => {
    await loginOwner();
    await authService.logout(authService.ROLES.BARTENDER);
    assert.strictEqual(store.get(STORAGE_KEYS.BARTENDER_SESSION), undefined);
    assert.ok(store.get(STORAGE_KEYS.ADMIN_SESSION), '老板会话应保留');
    authService.logout(authService.ROLES.OWNER);
    await loginBartender();
  });

  await check('动作级权限：调酒师无取消/改商品权限，老板全通', () => {
    assert.strictEqual(authService.can(authService.ROLES.BARTENDER, 'order:accept'), true);
    assert.strictEqual(authService.can(authService.ROLES.BARTENDER, 'order:complete'), true);
    assert.strictEqual(authService.can(authService.ROLES.BARTENDER, 'order:exception:create'), true);
    assert.strictEqual(authService.can(authService.ROLES.BARTENDER, 'order:cancel'), false);
    assert.strictEqual(authService.can(authService.ROLES.BARTENDER, 'product:update'), false);
    assert.strictEqual(authService.can(authService.ROLES.BARTENDER, 'stats:read'), false);
    assert.strictEqual(authService.can(authService.ROLES.OWNER, 'product:update'), true);
  });

  section('二、权限边界与异常处理');

  await check('调酒师不能取消订单（4021，状态不变）', async () => {
    const order = await createOrder();
    const res = await orderService.cancelOrder(order.id, { by: 'bartender', reason: '缺货' });
    assert.strictEqual(res.code, 4021);
    const after = await loadOrder(order.id);
    assert.strictEqual(after.data.status, ORDER_STATUS.PENDING);
  });

  await check('调酒师不能把待接单直接改成已取消（4018）', async () => {
    const order = await createOrder();
    const res = await orderService.updateOrderStatus(
      order.id,
      ORDER_STATUS.CANCELLED,
      'bartender',
      ORDER_STATUS.PENDING
    );
    assert.strictEqual(res.code, 4018);
  });

  await check('顾客不能推进订单状态（4019）', async () => {
    const order = await createOrder();
    const res = await orderService.updateOrderStatus(order.id, ORDER_STATUS.MAKING, 'customer');
    assert.strictEqual(res.code, 4019);
  });

  await check('调酒师可提交异常说明：状态不变、by=bartender、写时间线', async () => {
    const order = await createOrder();
    const res = await orderService.markOrderException(order.id, {
      reason: '缺货',
      note: '金酒用完，需补货',
      by: 'bartender'
    });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.status, ORDER_STATUS.PENDING);
    assert.strictEqual(res.data.exception.status, 'open');
    assert.strictEqual(res.data.exception.by, 'bartender');
    assert.strictEqual(res.data.exception.reason, '缺货');
    const log = res.data.statusLogs[res.data.statusLogs.length - 1];
    assert.strictEqual(log.by, 'bartender');
    assert.ok(log.note.indexOf('缺货') >= 0);
  });

  await check('调酒师不能处理（解除）异常（4020）', async () => {
    const list = await orderService.listOrders({});
    const withException = list.data.find(
      (item) => item.exception && item.exception.status === 'open'
    );
    assert.ok(withException, '需要一条待处理异常订单');
    const res = await orderService.resolveOrderException(withException.id, {
      resolution: '已补货',
      by: 'bartender'
    });
    assert.strictEqual(res.code, 4020);
  });

  await check('老板可处理异常，异常关闭后顾客端可见', async () => {
    const list = await orderService.listOrders({});
    const target = list.data.find((item) => item.exception && item.exception.status === 'open');
    const res = await orderService.resolveOrderException(target.id, {
      resolution: '已补货并重新出品',
      by: 'owner'
    });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.exception.status, 'resolved');
    assert.strictEqual(res.data.exception.resolvedBy, 'owner');
  });

  section('三、状态机与工作台查询');

  await check('工作台不含已取消订单，只含待接单/制作中/已完成', async () => {
    await orderService.listOrders({});
    const res = await orderService.listWorkbenchOrders({});
    assert.strictEqual(res.code, 0);
    res.data.list.forEach((order) => {
      assert.notStrictEqual(order.status, ORDER_STATUS.CANCELLED);
    });
    const seedCancelled = res.data.list.find((order) => order.id === 'o_demo_002');
    assert.strictEqual(seedCancelled, undefined, '已取消的演示订单不应进入工作台');
  });

  await check('工作台按状态筛选', async () => {
    const making = await orderService.listWorkbenchOrders({ status: ORDER_STATUS.MAKING });
    assert.ok(making.data.list.length >= 1);
    making.data.list.forEach((order) => assert.strictEqual(order.status, ORDER_STATUS.MAKING));

    const bad = await orderService.listWorkbenchOrders({ status: ORDER_STATUS.CANCELLED });
    assert.strictEqual(bad.data.list.length, 0, '已取消不是工作台的可选状态');
  });

  await check('工作台按桌号搜索（忽略大小写）', async () => {
    const upper = await orderService.listWorkbenchOrders({ keyword: 'A1' });
    const lower = await orderService.listWorkbenchOrders({ keyword: 'a1' });
    assert.ok(upper.data.list.length >= 1);
    upper.data.list.forEach((order) => assert.strictEqual(order.tableName, 'A1'));
    assert.strictEqual(lower.data.list.length, upper.data.list.length);
    assert.ok(upper.data.list.some((order) => order.id === 'o_demo_001'), '演示待接单应命中 A1');
  });

  await check('工作台搜索无结果返回空列表', async () => {
    const res = await orderService.listWorkbenchOrders({ keyword: 'Z9' });
    assert.strictEqual(res.data.list.length, 0);
    assert.strictEqual(res.data.total, 0);
  });

  await check('工作台按下单时间升序 / 降序排序', async () => {
    const asc = await orderService.listWorkbenchOrders({ sort: 'asc' });
    const desc = await orderService.listWorkbenchOrders({ sort: 'desc' });
    for (let i = 1; i < asc.data.list.length; i += 1) {
      assert.ok(asc.data.list[i - 1].createdAt <= asc.data.list[i].createdAt);
    }
    for (let i = 1; i < desc.data.list.length; i += 1) {
      assert.ok(desc.data.list[i - 1].createdAt >= desc.data.list[i].createdAt);
    }
  });

  await check('工作台与顾客端/老板端读同一份订单数据', async () => {
    const workbench = await orderService.listWorkbenchOrders({ status: ORDER_STATUS.MAKING });
    const sameId = workbench.data.list[0].id;
    const customer = await orderService.getOrder(sameId);
    const owner = await orderService.adminListOrders({ pageSize: 200 });
    const ownerOrder = owner.data.list.find((item) => item.id === sameId);
    assert.strictEqual(customer.data.status, ORDER_STATUS.MAKING);
    assert.strictEqual(ownerOrder.status, ORDER_STATUS.MAKING);
  });

  await check('待接单 → 制作中 → 已完成（by=bartender）', async () => {
    const order = await createOrder();
    const step1 = await orderService.updateOrderStatus(
      order.id,
      ORDER_STATUS.MAKING,
      'bartender',
      order.status
    );
    assert.strictEqual(step1.code, 0);
    assert.strictEqual(step1.data.status, ORDER_STATUS.MAKING);

    const step2 = await orderService.updateOrderStatus(
      order.id,
      ORDER_STATUS.COMPLETED,
      'bartender',
      ORDER_STATUS.MAKING
    );
    assert.strictEqual(step2.code, 0);
    assert.strictEqual(step2.data.status, ORDER_STATUS.COMPLETED);
    const actors = step2.data.statusLogs.map((log) => log.by);
    assert.ok(actors.indexOf('bartender') >= 0);
  });

  await check('不能跳级（待接单 → 已完成）', async () => {
    const order = await createOrder();
    const res = await orderService.updateOrderStatus(order.id, ORDER_STATUS.COMPLETED, 'bartender');
    assert.strictEqual(res.code, 4006);
  });

  await check('期望状态冲突：别端已改单时拒绝并返回 4017', async () => {
    const order = await createOrder();
    await loginOwner();
    await orderService.updateOrderStatus(order.id, ORDER_STATUS.MAKING, 'owner', ORDER_STATUS.PENDING);
    const res = await orderService.updateOrderStatus(
      order.id,
      ORDER_STATUS.COMPLETED,
      'bartender',
      ORDER_STATUS.PENDING
    );
    assert.strictEqual(res.code, 4017);
    assert.ok(res.message.indexOf('状态') >= 0);
    authService.logout(authService.ROLES.OWNER);
  });

  section('四、模拟实时轮询');

  await check('轮询启动立即执行一次，之后按间隔继续', async () => {
    let ticks = 0;
    const feed = feedFactory.createOrderFeed({ intervalMs: 1000, onPoll: () => (ticks += 1) });
    feed.start();
    await delay(80);
    assert.strictEqual(ticks, 1);
    await delay(1100);
    assert.ok(ticks >= 2, `期望至少 2 次轮询，实际 ${ticks}`);
    feed.stop();
  });

  await check('停止后不再轮询', async () => {
    let ticks = 0;
    const feed = feedFactory.createOrderFeed({ intervalMs: 1000, onPoll: () => (ticks += 1) });
    feed.start();
    await delay(80);
    feed.stop();
    const before = ticks;
    await delay(1100);
    assert.strictEqual(ticks, before);
    assert.strictEqual(feed.isRunning(), false);
  });

  await check('轮询异常走 onError，不中断后续轮询', async () => {
    let ticks = 0;
    let errors = 0;
    const feed = feedFactory.createOrderFeed({
      intervalMs: 1000,
      onPoll: () => {
        ticks += 1;
        if (ticks === 1) throw new Error('模拟失败');
      },
      onError: () => (errors += 1)
    });
    feed.start();
    await delay(1100);
    feed.stop();
    assert.ok(errors >= 1);
    assert.ok(ticks >= 2);
  });

  section('五、工作台页面与提醒');

  resetState();
  await loginBartender();
  await orderService.listOrders({});

  const boardPage = createPage(loadPage('pages/bartender-board/bartender-board'));
  boardPage.onLoad();
  await waitFor(() => boardPage.data.session && !boardPage.data.loading && boardPage.data.orders.length);
  await delay(60);

  await check('首屏不把已有待接单当新单，也不播放提示音', () => {
    assert.strictEqual(boardPage.data.newCount, 0);
    assert.strictEqual(audioPlays, 0);
  });

  await check('工作台默认待接单，3 个筛选且没有「全部 / 已取消」', () => {
    assert.strictEqual(boardPage.data.activeStatus, ORDER_STATUS.PENDING);
    assert.strictEqual(boardPage.data.filters.length, 3);
    const values = boardPage.data.filters.map((item) => item.value);
    assert.deepStrictEqual(values, [ORDER_STATUS.PENDING, ORDER_STATUS.MAKING, ORDER_STATUS.COMPLETED]);
    assert.strictEqual(values.indexOf(''), -1);
    assert.strictEqual(values.indexOf(ORDER_STATUS.CANCELLED), -1);
  });

  await check('卡片展示桌号、商品与数量、备注', () => {
    // 用内存对象验证渲染字段，避免额外创建订单干扰后面的「新单」计数
    const card = boardPage.decorate({
      id: 'o_card_probe',
      orderNo: '20261102-9999',
      status: ORDER_STATUS.PENDING,
      tableName: 'A1',
      tableArea: '吧台区',
      createdAt: Date.now() - 60000,
      totalQty: 2,
      items: [
        { productId: 'p_a', name: '示例·特调饮品 01', qty: 1 },
        { productId: 'p_b', name: '示例·小吃 01', qty: 1 }
      ],
      remark: '少冰，多谢'
    });
    assert.strictEqual(card.tableName, 'A1');
    assert.strictEqual(card.items.length, 2);
    assert.strictEqual(card.items[0].qty, 1);
    assert.strictEqual(card.remark, '少冰，多谢');
    assert.strictEqual(card.actionText, '接单');
    assert.strictEqual(card.totalQty, 2);
  });

  await check('新订单在下一轮轮询后提醒并播放提示音', async () => {
    const order = await createOrder('加冰');
    await delay(1300);
    await waitFor(() => boardPage.data.newCount >= 1);
    assert.ok(audioPlays >= 1, '提示音应播放');
    const card = boardPage.data.orders.find((item) => item.id === order.id);
    assert.ok(card, '新单应出现在待接单列表');
    assert.strictEqual(card.isNew, true);
    boardPage._newOrderId = order.id;
  });

  await check('快捷接单：待接单 → 制作中，并清除新单标记', async () => {
    const id = boardPage._newOrderId;
    assert.ok(id, '需要上一项记录的新单');
    boardPage.onQuickAction({
      currentTarget: {
        dataset: { id, next: ORDER_STATUS.MAKING, status: ORDER_STATUS.PENDING }
      }
    });
    await waitFor(async () => {
      const res = await orderService.getOrder(id);
      return res.data.status === ORDER_STATUS.MAKING;
    });
    await waitFor(() => boardPage.data.newCount === 0);
  });

  await check('关闭提示音后仍提醒，但不播放声音', async () => {
    boardPage.onSoundChange({ detail: { value: false } });
    assert.strictEqual(boardPage.data.soundOn, false);
    const playsBefore = audioPlays;
    const order = await createOrder('不要冰');
    await delay(1300);
    await waitFor(() => boardPage.data.newCount >= 1);
    const card = boardPage.data.orders.find((item) => item.id === order.id);
    assert.ok(card && card.isNew);
    assert.strictEqual(audioPlays, playsBefore);
    assert.strictEqual(store.get(STORAGE_KEYS.BARTENDER_SOUND), false);

    boardPage.onSoundChange({ detail: { value: true } });
    assert.strictEqual(store.get(STORAGE_KEYS.BARTENDER_SOUND), true);
  });

  await check('新单提示条点击后清空提醒并回到待接单', async () => {
    boardPage.onNewBannerTap();
    await waitFor(() => boardPage.data.newCount === 0);
    assert.strictEqual(boardPage.data.activeStatus, ORDER_STATUS.PENDING);
  });

  await check('制作中快捷完成 → 已完成，卡片操作变为空', async () => {
    const order = await createOrder();
    boardPage.onQuickAction({
      currentTarget: {
        dataset: { id: order.id, next: ORDER_STATUS.MAKING, status: ORDER_STATUS.PENDING }
      }
    });
    await waitFor(async () => {
      const res = await orderService.getOrder(order.id);
      return res.data.status === ORDER_STATUS.MAKING;
    });

    boardPage.onQuickAction({
      currentTarget: {
        dataset: { id: order.id, next: ORDER_STATUS.COMPLETED, status: ORDER_STATUS.MAKING }
      }
    });
    await waitFor(async () => {
      const res = await orderService.getOrder(order.id);
      return res.data.status === ORDER_STATUS.COMPLETED;
    });
    const card = boardPage.decorate((await orderService.getOrder(order.id)).data);
    assert.strictEqual(card.actionText, '');
    assert.strictEqual(card.isNew, false);
  });

  await check('离线时暂停轮询，恢复后继续', async () => {
    assert.ok(netHandler, '页面应注册网络状态监听');
    netHandler({ isConnected: false });
    assert.strictEqual(boardPage.data.online, false);
    assert.strictEqual(boardPage._feed.isRunning(), false);

    netHandler({ isConnected: true });
    await waitFor(() => boardPage._feed.isRunning());
    assert.strictEqual(boardPage.data.online, true);
  });

  await check('点击订单卡进入详情并减少新单计数', async () => {
    const order = await createOrder();
    await delay(1300);
    await waitFor(() => boardPage.data.newCount >= 1);
    lastNav = '';
    boardPage.onOrderTap({ currentTarget: { dataset: { id: order.id } } });
    assert.ok(lastNav.indexOf('/pages/bartender-order/bartender-order') === 0);
  });

  await check('退出页面停止轮询并销毁音频', () => {
    boardPage.onUnload();
    assert.strictEqual(boardPage._feed.isRunning(), false);
    assert.ok(audioDestroyed >= 1);
    assert.strictEqual(netHandler, null);
  });

  section('六、订单详情页');

  const detailPage = createPage(loadPage('pages/bartender-order/bartender-order'));
  const detailOrder = await createOrder('不加冰');
  detailPage.onLoad({ id: detailOrder.id });
  await waitFor(() => detailPage.data.order && !detailPage.data.loading);

  await check('详情展示编号、桌号、时间、商品与备注', () => {
    assert.strictEqual(detailPage.data.orderNo, detailOrder.orderNo);
    assert.strictEqual(detailPage.data.tableText, 'A1 · 吧台区');
    assert.ok(detailPage.data.timeText.length > 0);
    assert.strictEqual(detailPage.data.items[0].qty, 1);
    assert.strictEqual(detailPage.data.remark, '不加冰');
    assert.strictEqual(detailPage.data.totalQty, 1);
  });

  await check('详情页接单动作生效（带期望状态）', async () => {
    detailPage.onAdvance();
    await waitFor(async () => (await orderService.getOrder(detailOrder.id)).data.status === ORDER_STATUS.MAKING);
    await waitFor(() => detailPage.data.order.status === ORDER_STATUS.MAKING);
    assert.strictEqual(detailPage.data.nextActionText, '制作完成');
  });

  await check('详情页状态冲突时拒绝并刷新', async () => {
    const order = await createOrder();
    const page = createPage(loadPage('pages/bartender-order/bartender-order'));
    page.onLoad({ id: order.id });
    await waitFor(() => page.data.order && !page.data.loading);

    // 另一端（老板）先接单，页面仍以为待接单
    await loginOwner();
    await orderService.updateOrderStatus(order.id, ORDER_STATUS.MAKING, 'owner', ORDER_STATUS.PENDING);
    authService.logout(authService.ROLES.OWNER);

    page.onAdvance();
    await waitFor(() => lastToast.indexOf('状态') >= 0);
    await waitFor(() => page.data.order.status === ORDER_STATUS.MAKING);
    page.onUnload && page.onUnload();
  });

  await check('详情页提交异常：快捷原因 + 提交给老板', async () => {
    const order = await createOrder();
    const page = createPage(loadPage('pages/bartender-order/bartender-order'));
    page.onLoad({ id: order.id });
    await waitFor(() => page.data.order && !page.data.loading);

    assert.strictEqual(page.data.canSubmitException, true);
    page.onOpenException();
    page.onQuickReason({ currentTarget: { dataset: { reason: '缺货' } } });
    page.onSubmitException();

    await waitFor(async () => {
      const res = await orderService.getOrder(order.id);
      return Boolean(res.data.exception);
    });
    const res = await orderService.getOrder(order.id);
    assert.strictEqual(res.data.exception.by, 'bartender');
    assert.strictEqual(res.data.exception.status, 'open');
    await waitFor(() => page.data.exception && page.data.exception.status === 'open');
    assert.strictEqual(page.data.canSubmitException, false);
  });

  await check('已完成订单无推进按钮，也不能提交异常', async () => {
    const order = await createOrder();
    await orderService.updateOrderStatus(order.id, ORDER_STATUS.MAKING, 'bartender', ORDER_STATUS.PENDING);
    await orderService.updateOrderStatus(order.id, ORDER_STATUS.COMPLETED, 'bartender', ORDER_STATUS.MAKING);

    const page = createPage(loadPage('pages/bartender-order/bartender-order'));
    page.onLoad({ id: order.id });
    await waitFor(() => page.data.order && !page.data.loading);
    assert.strictEqual(page.data.canAdvance, false);
    assert.strictEqual(page.data.canSubmitException, false);
  });

  await check('调酒师改状态后顾客端与老板端立即同步', async () => {
    const order = await createOrder();
    await orderService.updateOrderStatus(order.id, ORDER_STATUS.MAKING, 'bartender', ORDER_STATUS.PENDING);

    const customer = await orderService.listOrders({ status: ORDER_STATUS.MAKING });
    assert.ok(customer.data.some((item) => item.id === order.id));

    await loginOwner();
    const owner = await orderService.adminListOrders({ pageSize: 200 });
    authService.logout(authService.ROLES.OWNER);
    assert.strictEqual(owner.data.list.find((item) => item.id === order.id).status, ORDER_STATUS.MAKING);
  });

  await check('「我的」页调酒师入口显示已登录，退出后回到需口令', async () => {
    const myPage = createPage(loadPage('pages/my/my'));
    myPage.onShow();
    assert.strictEqual(myPage.data.isBartender, true);
    assert.ok(myPage.data.bartenderText.indexOf('调酒师') >= 0);

    await authService.logout(authService.ROLES.BARTENDER);
    myPage.onShow();
    assert.strictEqual(myPage.data.isBartender, false);
    assert.strictEqual(myPage.data.bartenderText, '需口令');
  });

  section('七、未登录与登录页');

  await check('未登录进工作台被重定向到调酒师登录页', async () => {
    lastRedirect = '';
    const page = createPage(loadPage('pages/bartender-board/bartender-board'));
    page.onLoad();
    await waitFor(() => lastRedirect.indexOf('/pages/bartender-login/bartender-login') === 0);
    assert.strictEqual(page.data.session, null);
    assert.strictEqual(page.data.orders.length, 0);
  });

  await check('登录页提交正确口令后进入工作台', async () => {
    lastRedirect = '';
    const page = createPage(loadPage('pages/bartender-login/bartender-login'));
    page.onLoad();
    page.onPasswordInput({ detail: { value: config.demoBartenderPassword } });
    page.onSubmit();
    await waitFor(() => lastRedirect.indexOf('/pages/bartender-board/bartender-board') === 0);
    assert.strictEqual(page.data.error, '');
  });

  await check('登录页已登录时直接进工作台', async () => {
    lastRedirect = '';
    const page = createPage(loadPage('pages/bartender-login/bartender-login'));
    page.onLoad();
    await waitFor(() => lastRedirect.indexOf('/pages/bartender-board/bartender-board') === 0);
  });

  section('八、静态检查');

  await check('app.json 注册 3 个调酒师页面且四件套齐全', () => {
    ['bartender-login', 'bartender-board', 'bartender-order'].forEach((name) => {
      const route = `pages/${name}/${name}`;
      assert.ok(pagesConfig.pages.indexOf(route) >= 0, `缺少页面 ${route}`);
      ['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
        assert.ok(fs.existsSync(path.join(ROOT, route + ext)), `缺少文件 ${route}${ext}`);
      });
    });
  });

  await check('新页面 JSON 可解析，引用的组件都存在', () => {
    ['bartender-login', 'bartender-board', 'bartender-order'].forEach((name) => {
      const json = JSON.parse(
        fs.readFileSync(path.join(ROOT, `pages/${name}/${name}.json`), 'utf8')
      );
      const using = json.usingComponents || {};
      Object.keys(using).forEach((key) => {
        const target = path.join(ROOT, `pages/${name}`, using[key]);
        assert.ok(fs.existsSync(target + '.js'), `组件不存在：${using[key]}`);
      });
    });
  });

  await check('调酒师页面 WXML 标签闭合', () => {
    ['bartender-login', 'bartender-board', 'bartender-order'].forEach((name) => {
      checkWxmlBalance(path.join(ROOT, `pages/${name}/${name}.wxml`));
    });
  });

  await check('调酒师页面不做商品/统计/媒体操作，也不直接写订单存储', () => {
    const files = walk(path.join(ROOT, 'pages/bartender-board'), ['.js', '.wxml'])
      .concat(walk(path.join(ROOT, 'pages/bartender-order'), ['.js', '.wxml']))
      .concat(walk(path.join(ROOT, 'pages/bartender-login'), ['.js', '.wxml']));
    const forbidden = [
      { re: /chooseMedia|chooseImage/, name: '相册/图片上传' },
      { re: /services\/stats/, name: '经营统计服务' },
      { re: /services\/products/, name: '商品服务' },
      { re: /services\/cart/, name: '购物车服务' },
      { re: /STORAGE_KEYS\.ORDERS|lm_orders/, name: '直接读写订单存储' },
      { re: /cancelOrder\s*\(/, name: '取消订单' },
      { re: /resolveOrderException\s*\(/, name: '处理异常' },
      { re: /totalAmount|fenToYuan/, name: '订单金额展示' }
    ];
    files.forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');
      forbidden.forEach((rule) => {
        assert.ok(!rule.re.test(source), `${path.relative(ROOT, file)} 不应出现${rule.name}`);
      });
    });

    // 页面文案可以说明「不能查看营业额」，但不能渲染金额/财务数据
    const detailJs = fs.readFileSync(path.join(ROOT, 'pages/bartender-order/bartender-order.js'), 'utf8');
    assert.ok(detailJs.indexOf('totalAmount') < 0);
  });

  await check('页面不硬编码调酒师口令，口令只在 config', () => {
    const pages = walk(path.join(ROOT, 'pages/bartender-login'), ['.js', '.wxml']);
    pages.forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(source.indexOf("'1234'") < 0, `${path.relative(ROOT, file)} 不应写死口令`);
    });
    assert.strictEqual(config.demoBartenderPassword, '1234');
    assert.notStrictEqual(config.demoBartenderPassword, config.demoOwnerPassword);
  });

  await check('工作台常驻「模拟实时」标注，不把轮询说成实时推送', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/bartender-board/bartender-board.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/bartender-board/bartender-board.js'), 'utf8');
    assert.ok(wxml.indexOf('模拟实时') >= 0);
    assert.ok(wxml.indexOf('轮询') >= 0);
    assert.ok(wxml.indexOf('实时推送') < 0);
    assert.ok(js.indexOf('实时推送') < 0);
  });

  await check('提示音文件存在且为合法 WAV', () => {
    const file = path.join(ROOT, 'assets/sounds/order-alert.wav');
    assert.ok(fs.existsSync(file));
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.slice(0, 4).toString(), 'RIFF');
    assert.strictEqual(buf.slice(8, 12).toString(), 'WAVE');
    assert.ok(buf.length > 1000);
  });

  await check('状态枚举仍为 4 个（没有待取餐），工作台筛选为 3 个', () => {
    assert.strictEqual(Object.keys(ORDER_STATUS).length, 4);
    assert.strictEqual(ORDER_STATUS.READY, undefined);
    assert.strictEqual(ORDER_STATUS_LIST.length, 4);
    assert.strictEqual(WORKBENCH_STATUS_LIST.length, 3);
    assert.deepStrictEqual(ORDER_TRANSITIONS.making, [ORDER_STATUS.COMPLETED]);
    assert.deepStrictEqual(ORDER_TRANSITIONS.pending, [ORDER_STATUS.MAKING, ORDER_STATUS.CANCELLED]);
  });

  await check('调酒师样式文件存在、括号配平，页面正确引用', () => {
    const shared = path.join(ROOT, 'styles/bartender.wxss');
    assert.ok(fs.existsSync(shared));
    const css = fs.readFileSync(shared, 'utf8');
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    assert.strictEqual(open, close, `大括号不配平：{ ${open} / } ${close}`);

    ['bartender-board', 'bartender-order'].forEach((name) => {
      const pageCss = fs.readFileSync(path.join(ROOT, `pages/${name}/${name}.wxss`), 'utf8');
      assert.ok(pageCss.indexOf('styles/bartender.wxss') >= 0);
    });

    const boardWxml = fs.readFileSync(
      path.join(ROOT, 'pages/bartender-board/bartender-board.wxml'),
      'utf8'
    );
    assert.ok(boardWxml.indexOf('status-tag') >= 0);
    assert.ok(boardWxml.indexOf('onQuickAction') >= 0);
  });

  await check('工作台与详情页都走 bartender-guard，不用 admin-guard', () => {
    ['bartender-board', 'bartender-order'].forEach((name) => {
      const source = fs.readFileSync(path.join(ROOT, `pages/${name}/${name}.js`), 'utf8');
      assert.ok(source.indexOf('bartender-guard') >= 0);
      assert.ok(source.indexOf('admin-guard') < 0);
      assert.ok(source.indexOf('ensureBartender') >= 0);
    });
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