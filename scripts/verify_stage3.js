// 第三阶段（酒单 + 商品详情）离线校验脚本。
// 不依赖微信开发者工具：用内存 storage 桩件跑 services，并静态检查 WXML/JSON/引用字段。
// 运行：node scripts/verify_stage3.js
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
let lastBadge = '';

global.wx = {
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => {
    store.set(key, value);
  },
  removeStorageSync: (key) => {
    store.delete(key);
  },
  getWindowInfo: () => ({ statusBarHeight: 20, windowHeight: 700 }),
  setTabBarBadge: (options) => {
    lastBadge = String(options.text);
  },
  removeTabBarBadge: () => {
    lastBadge = '';
  },
  showToast: () => {},
  pageScrollTo: () => {},
  navigateTo: (options) => {
    lastNavUrl = options.url;
  },
  switchTab: () => {},
  setNavigationBarTitle: () => {}
};
global.getApp = () => appStub;

const config = require(path.join(ROOT, 'config/index'));
config.mockDelay = [0, 0];

const categoryService = require(path.join(ROOT, 'services/categories'));
const productService = require(path.join(ROOT, 'services/products'));
const cartService = require(path.join(ROOT, 'services/cart'));
const orderService = require(path.join(ROOT, 'services/orders'));
const recommendService = require(path.join(ROOT, 'services/recommend'));
const validTable = require(path.join(ROOT, 'utils/mock-data/tables'))[0].id;

const REQUIRED_FIELDS = ['id', 'name', 'category', 'price', 'description', 'image', 'isAvailable'];
const CATEGORY_IDS = ['traditional', 'signature', 'non_alcoholic', 'snacks'];

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

function scanStaleFields(file) {
  const source = fs.readFileSync(file, 'utf8');
  const rules = [
    { re: /\.desc\b/, hint: '旧字段 desc，应改为 description' },
    { re: /categoryId/, hint: '旧字段 categoryId，应改为 category' },
    { re: /status\s*===\s*'on'/, hint: "旧字段 status，应改为 isAvailable" }
  ];
  rules.forEach((rule) => {
    if (rule.re.test(source)) throw new Error(`${path.relative(ROOT, file)} 仍在使用${rule.hint}`);
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 页面逻辑桩件：截获 Page() 配置，构造一个带 setData 的实例
function loadPage(relPath) {
  const file = path.join(ROOT, relPath);
  let captured = null;
  const previous = global.Page;
  global.Page = (config) => {
    captured = config;
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

function createPage(config) {
  const page = Object.create(config);
  page.data = JSON.parse(JSON.stringify(config.data));
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

function waitFor(predicate, timeout = 2000) {
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

async function main() {
  section('一、数据与缓存');

  await check('旧的本地商品缓存会按 seedVersion 重建', async () => {
    store.set('lm_products', [{ id: 'stale', categoryId: 'cat_classic' }]);
    store.set('lm_seed_products', 'old-version');
    const res = await productService.listProducts({});
    assert.strictEqual(res.data.length, 24, '应重建为 24 款示例商品');
  });

  const categoriesRes = await categoryService.listCategories();
  const categories = categoriesRes.data;

  await check('四个分类的 id 与约定一致', () => {
    assert.deepStrictEqual(categories.map((item) => item.id), CATEGORY_IDS);
  });

  const allRes = await productService.listProducts({});
  const all = allRes.data;

  await check('全部在售商品 24 款，字段完整', () => {
    assert.strictEqual(all.length, 24);
    all.forEach((item) => {
      REQUIRED_FIELDS.forEach((field) => {
        assert.ok(Object.prototype.hasOwnProperty.call(item, field), `${item.id} 缺少字段 ${field}`);
      });
      assert.ok(CATEGORY_IDS.includes(item.category), `${item.id} 的 category 非法：${item.category}`);
      assert.ok(Number.isInteger(item.price) && item.price > 0, `${item.id} 价格应为正整数分`);
      assert.strictEqual(typeof item.isAvailable, 'boolean');
      assert.ok(item.description.length > 0, `${item.id} 介绍为空`);
      assert.strictEqual(item.image, '', `${item.id} 示例阶段应无真实图片`);
      assert.ok(item.name.indexOf('示例·') === 0, `${item.id} 名称缺少「示例·」前缀`);
    });
  });

  await check('商品 id 唯一', () => {
    const ids = all.map((item) => item.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  await check('每个分类 6 款', async () => {
    for (const id of CATEGORY_IDS) {
      const res = await productService.listProducts({ category: id });
      assert.strictEqual(res.data.length, 6, `${id} 分类应有 6 款`);
      assert.ok(res.data.every((item) => item.category === id));
    }
  });

  section('二、搜索');

  await check('按中文名搜索：特调 → 6 款', async () => {
    const res = await productService.listProducts({ keyword: '特调' });
    assert.strictEqual(res.data.length, 6);
  });

  await check('按英文名搜索且忽略大小写：DEMO CLASSICS → 6 款', async () => {
    const res = await productService.listProducts({ keyword: '  DEMO CLASSICS  ' });
    assert.strictEqual(res.data.length, 6);
  });

  await check('分类 + 关键词组合：小吃 + 小吃 → 6 款', async () => {
    const res = await productService.listProducts({ category: 'snacks', keyword: '小吃' });
    assert.strictEqual(res.data.length, 6);
  });

  await check('分类 + 不匹配关键词 → 0 款', async () => {
    const res = await productService.listProducts({ category: 'snacks', keyword: '特调' });
    assert.strictEqual(res.data.length, 0);
  });

  await check('空关键词返回全部', async () => {
    const res = await productService.listProducts({ keyword: '   ' });
    assert.strictEqual(res.data.length, 24);
  });

  section('三、商品详情读取');

  await check('按 id 读取单款商品', async () => {
    const res = await productService.getProduct('p_traditional_01');
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.category, 'traditional');
    assert.strictEqual(res.data.price, 5800);
  });

  await check('不存在的 id 返回 4040', async () => {
    const res = await productService.getProduct('p_not_exist');
    assert.strictEqual(res.code, 4040);
  });

  section('四、加入购物车');

  await check('加购 3 件后数量为 3', async () => {
    const res = await cartService.addItem('p_traditional_01', 3);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.totalQty, 3);
    assert.strictEqual(res.data.items[0].productId, 'p_traditional_01');
    assert.strictEqual(res.data.items[0].qty, 3);
    assert.strictEqual(res.data.items[0].category, 'traditional');
    assert.strictEqual(res.data.items[0].subtotal, 5800 * 3);
  });

  await check('同一商品再加 2 件合并为 5 件', async () => {
    const res = await cartService.addItem('p_traditional_01', 2);
    assert.strictEqual(res.data.totalQty, 5);
    assert.strictEqual(res.data.items.length, 1);
  });

  await check('数量下限与非法数量按 1 处理', async () => {
    const res = await cartService.addItem('p_snacks_01', 0);
    assert.strictEqual(res.code, 0);
    const item = res.data.items.find((entry) => entry.productId === 'p_snacks_01');
    assert.strictEqual(item.qty, 1);
  });

  await check('合计金额按分计算', async () => {
    const res = await cartService.getCart();
    assert.strictEqual(res.data.totalQty, 6);
    assert.strictEqual(res.data.totalAmount, 5800 * 5 + 2800);
  });

  await check('改数量、移除、清空', async () => {
    let res = await cartService.updateItemQty('p_traditional_01', 1);
    assert.strictEqual(res.data.totalQty, 2);
    res = await cartService.removeItem('p_snacks_01');
    assert.strictEqual(res.data.totalQty, 1);
    res = await cartService.clear();
    assert.strictEqual(res.data.totalQty, 0);
  });

  section('五、上下架');

  await check('下架后酒单不展示、详情仍可读、加购被拒', async () => {
    const off = await productService.toggleProductAvailability('p_signature_03');
    assert.strictEqual(off.data.isAvailable, false);

    const list = await productService.listProducts({});
    assert.strictEqual(list.data.length, 23);
    assert.ok(!list.data.some((item) => item.id === 'p_signature_03'));

    const detail = await productService.getProduct('p_signature_03');
    assert.strictEqual(detail.code, 0);
    assert.strictEqual(detail.data.isAvailable, false);

    const add = await cartService.addItem('p_signature_03', 1);
    assert.strictEqual(add.code, 4040);
  });

  await check('购物车自动剔除已下架商品', async () => {
    await productService.toggleProductAvailability('p_signature_03');
    await cartService.clear();
    const added = await cartService.addItem('p_signature_03', 1);
    assert.strictEqual(added.code, 0, '上架状态应可加购');

    await productService.toggleProductAvailability('p_signature_03');
    const cart = await cartService.getCart();
    assert.strictEqual(cart.data.totalQty, 0, '已下架商品应被自动剔除');
    await productService.toggleProductAvailability('p_signature_03');
  });

  await check('重新上架后恢复 24 款', async () => {
    const list = await productService.listProducts({});
    assert.strictEqual(list.data.length, 24);
  });

  section('六、首页推荐位');

  await check('推荐位 3 + 3，且 id 全部有效', async () => {
    const res = await recommendService.getHome();
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.featured.length, 3);
    assert.strictEqual(res.data.seasonal.length, 3);
    assert.strictEqual(res.data.totalCount, 24);
    res.data.featured.forEach((item) => {
      assert.ok(all.some((p) => p.id === item.id), `推荐商品 ${item.id} 不在商品表中`);
    });
    res.data.seasonal.forEach((entry) => {
      assert.ok(all.some((p) => p.id === entry.product.id), `当季推荐 ${entry.product.id} 不在商品表中`);
    });
  });

  section('七、下单接口（验证字段贯通，不改动 M2 流程）');

  await check('用购物车商品下单，金额与明细按商品表重算', async () => {
    await cartService.clear();
    await cartService.addItem('p_traditional_01', 2);
    await cartService.addItem('p_snacks_01', 1);

    const res = await orderService.createOrder({
      tableId: validTable,
      items: [
        { productId: 'p_traditional_01', qty: 2 },
        { productId: 'p_snacks_01', qty: 1 }
      ]
    });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.data.totalQty, 3);
    assert.strictEqual(res.data.totalAmount, 5800 * 2 + 2800);
    assert.strictEqual(res.data.items[0].nameEn, 'Demo Classics 01');
  });

  await check('下单接口拒绝已下架商品', async () => {
    await productService.toggleProductAvailability('p_snacks_01');
    const res = await orderService.createOrder({
      tableId: validTable,
      items: [{ productId: 'p_snacks_01', qty: 1 }]
    });
    assert.strictEqual(res.code, 4004);
    await productService.toggleProductAvailability('p_snacks_01');
  });

  section('八、静态检查（页面 / 组件 / 配置）');

  const appJson = readJson(path.join(ROOT, 'app.json'));

  await check('app.json 页面文件齐全（js/json/wxml/wxss）', () => {
    appJson.pages.forEach((page) => {
      ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
        const file = path.join(ROOT, `${page}.${ext}`);
        assert.ok(fs.existsSync(file), `缺少 ${page}.${ext}`);
      });
    });
  });

  await check('所有 JSON 配置可解析', () => {
    const files = [
      'app.json',
      'project.config.json',
      'sitemap.json',
      'pages/menu/menu.json',
      'pages/product/product.json',
      'pages/home/home.json',
      'pages/cart/cart.json',
      'pages/orders/orders.json'
    ];
    files.forEach((file) => readJson(path.join(ROOT, file)));
  });

  await check('底部导航固定 4 个 Tab，购物车在 index 2', () => {
    assert.strictEqual(appJson.tabBar.list.length, 4);
    assert.strictEqual(appJson.tabBar.list[2].pagePath, 'pages/cart/cart');
    appJson.tabBar.list.forEach((tab) => {
      assert.ok(fs.existsSync(path.join(ROOT, tab.iconPath)), `缺少图标 ${tab.iconPath}`);
      assert.ok(fs.existsSync(path.join(ROOT, tab.selectedIconPath)), `缺少图标 ${tab.selectedIconPath}`);
    });
  });

  const wxmlFiles = walk(path.join(ROOT, 'pages'), ['.wxml']).concat(
    walk(path.join(ROOT, 'components'), ['.wxml'])
  );

  await check(`WXML 标签闭合与配对（${wxmlFiles.length} 个文件）`, () => {
    wxmlFiles.forEach((file) => {
      // 玫瑰组件已废弃且不进包，跳过
      if (file.indexOf('rose-stage') >= 0 || file.indexOf('petal-') >= 0) return;
      checkWxmlBalance(file);
    });
  });

  const pageFiles = walk(path.join(ROOT, 'pages'), ['.js', '.wxml']).concat(
    walk(path.join(ROOT, 'components'), ['.js', '.wxml'])
  );

  await check('页面与组件不再引用旧字段 desc / categoryId / status=on', () => {
    pageFiles.forEach((file) => {
      if (file.indexOf('rose-stage') >= 0 || file.indexOf('petal-') >= 0) return;
      scanStaleFields(file);
    });
  });

  await check('酒单与详情均保留图片失败回退钩子', () => {
    const menu = fs.readFileSync(path.join(ROOT, 'pages/menu/menu.wxml'), 'utf8');
    const product = fs.readFileSync(path.join(ROOT, 'pages/product/product.wxml'), 'utf8');
    [menu, product].forEach((source) => {
      assert.ok(source.indexOf('binderror') >= 0, '缺少 binderror');
      assert.ok(source.indexOf('示例图') >= 0 || source.indexOf('示例图 ·') >= 0, '缺少占位块文案');
    });
  });

  await check('酒单页注册的组件都存在', () => {
    const menuJson = readJson(path.join(ROOT, 'pages/menu/menu.json'));
    Object.values(menuJson.usingComponents || {}).forEach((componentPath) => {
      const base = path.join(ROOT, componentPath.replace(/^\//, ''));
      assert.ok(fs.existsSync(`${base}.js`), `组件缺少 js：${componentPath}`);
      assert.ok(fs.existsSync(`${base}.wxml`), `组件缺少 wxml：${componentPath}`);
    });
  });

  section('九、页面逻辑（酒单 / 详情）');

  const menuConfig = loadPage('pages/menu/menu.js');
  const productConfig = loadPage('pages/product/product.js');

  await check('酒单默认「全部」，24 款', async () => {
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false && page.data.categories.length === 4);
    assert.strictEqual(page.data.activeId, '');
    assert.strictEqual(page.data.activeName, '全部');
    assert.strictEqual(page.data.products.length, 24);
    page.onUnload();
  });

  await check('首页带入分类：pendingCategoryId 生效并被清空', async () => {
    appStub.globalData.pendingCategoryId = 'signature';
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false && page.data.activeId === 'signature');
    assert.strictEqual(page.data.activeName, '特调饮品');
    assert.strictEqual(page.data.products.length, 6);
    assert.strictEqual(appStub.globalData.pendingCategoryId, '');
    page.onUnload();
  });

  await check('切换分类后列表与计数同步', async () => {
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);
    page.onCategoryTap({ currentTarget: { dataset: { id: 'snacks' } } });
    await waitFor(() => page.data.activeId === 'snacks' && page.data.products.length === 6);
    assert.strictEqual(page.data.activeName, '小吃');
    page.onUnload();
  });

  await check('关键词只在当前分类内过滤，清除后恢复', async () => {
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);
    page.onCategoryTap({ currentTarget: { dataset: { id: 'snacks' } } });
    await waitFor(() => page.data.activeId === 'snacks' && page.data.products.length === 6);

    page.onKeywordInput({ detail: { value: '特调' } });
    await delay(260);
    await waitFor(() => page.data.loading === false && page.data.products.length === 0);
    assert.strictEqual(page.data.keyword, '特调');

    page.onClearKeyword();
    await waitFor(() => page.data.loading === false && page.data.products.length === 6);
    assert.strictEqual(page.data.keyword, '');
    page.onUnload();
  });

  await check('「全部」下英文关键词搜索', async () => {
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);
    page.onKeywordInput({ detail: { value: 'demo classics' } });
    await delay(260);
    await waitFor(() => page.data.loading === false && page.data.products.length === 6);
    assert.strictEqual(page.data.keyword, 'demo classics');
    page.onUnload();
  });

  await check('点条目进入对应详情页', async () => {
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);
    lastNavUrl = '';
    page.onProductTap({ currentTarget: { dataset: { id: 'p_traditional_03' } } });
    assert.strictEqual(lastNavUrl, '/pages/product/product?id=p_traditional_03');
    page.onUnload();
  });

  await check('条目「加入」写购物车并更新角标', async () => {
    await cartService.clear();
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);
    page.onAdd({ currentTarget: { dataset: { id: 'p_traditional_03' } } });
    await waitFor(() => lastBadge === '1');
    const cart = await cartService.getCart();
    assert.strictEqual(cart.data.totalQty, 1);
    assert.strictEqual(cart.data.items[0].productId, 'p_traditional_03');
    page.onUnload();
  });

  await check('图片加载失败退回占位块（页面状态）', async () => {
    const page = createPage(menuConfig);
    page.onShow();
    await waitFor(() => page.data.loading === false);
    page.data.products[0].image = '/not-exist.png';
    page.onImageError({ currentTarget: { dataset: { index: 0 } } });
    assert.strictEqual(page.data.products[0].image, '');
    page.onUnload();
  });

  await check('详情页读取商品、分类与价格', async () => {
    const page = createPage(productConfig);
    page.onLoad({ id: 'p_signature_01' });
    await waitFor(() => page.data.loading === false);
    assert.strictEqual(page.data.product.id, 'p_signature_01');
    assert.strictEqual(page.data.categoryName, '特调饮品');
    assert.strictEqual(page.data.categoryNameEn, 'Signature');
    assert.strictEqual(page.data.priceText, '68.00');
    assert.strictEqual(page.data.unavailable, false);
  });

  await check('详情页按所选数量加购（4 件）', async () => {
    await cartService.clear();
    const page = createPage(productConfig);
    page.onLoad({ id: 'p_signature_01' });
    await waitFor(() => page.data.loading === false);
    page.onQtyChange({ detail: { value: 4 } });
    lastBadge = '';
    page.onAdd();
    await waitFor(() => lastBadge === '4');
    const cart = await cartService.getCart();
    assert.strictEqual(cart.data.totalQty, 4);
  });

  await check('详情页下架态：按钮不可用、加购无效', async () => {
    await cartService.clear();
    await productService.toggleProductAvailability('p_signature_02');
    const page = createPage(productConfig);
    page.onLoad({ id: 'p_signature_02' });
    await waitFor(() => page.data.loading === false);
    assert.strictEqual(page.data.unavailable, true);
    page.onAdd();
    await delay(50);
    const cart = await cartService.getCart();
    assert.strictEqual(cart.data.totalQty, 0);
    await productService.toggleProductAvailability('p_signature_02');
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