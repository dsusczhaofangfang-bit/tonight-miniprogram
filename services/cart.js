// 购物车服务（演示版，本地 storage 持久化）
// 只存 { productId, qty, selected }，价格与名称始终按商品表现算，避免缓存里留旧价格。
// selected 决定结算范围：下单成功后只移除已提交的条目。
const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const productService = require('./products');

const MAX_QTY = 99;

function readRaw() {
  const list = storage.get(STORAGE_KEYS.CART, []);
  return Array.isArray(list) ? list : [];
}

function writeRaw(list) {
  storage.set(STORAGE_KEYS.CART, list);
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.cart = list;
    }
  } catch (error) {
    // app 尚未初始化时忽略，storage 已写入
  }
}

function normalize(list) {
  const result = [];
  list.forEach((item) => {
    const productId = item && item.productId ? String(item.productId) : '';
    const qty = Math.floor(Number(item && item.qty));
    if (!productId || !Number.isFinite(qty) || qty <= 0) return;
    result.push({
      productId,
      qty: Math.min(MAX_QTY, qty),
      // 旧缓存没有 selected 字段时默认勾选
      selected: item.selected !== false
    });
  });
  return result;
}

// 用当前商品表重建购物车：已删除或已下架的商品自动剔除
function build() {
  const products = productService.listAllSync();
  const map = {};
  products.forEach((product) => {
    map[product.id] = product;
  });

  const items = [];
  normalize(readRaw()).forEach((entry) => {
    const product = map[entry.productId];
    if (!product || product.isAvailable === false) return;
    items.push({
      productId: product.id,
      name: product.name,
      nameEn: product.nameEn,
      category: product.category,
      image: product.image || '',
      price: product.price,
      qty: entry.qty,
      subtotal: product.price * entry.qty,
      selected: entry.selected
    });
  });

  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  const selectedItems = items.filter((item) => item.selected);
  const selectedQty = selectedItems.reduce((sum, item) => sum + item.qty, 0);
  const selectedAmount = selectedItems.reduce((sum, item) => sum + item.subtotal, 0);

  return {
    items,
    totalQty,
    totalAmount,
    selectedQty,
    selectedAmount,
    selectedCount: selectedItems.length,
    allSelected: items.length > 0 && selectedItems.length === items.length
  };
}

// 读取时顺带清理失效条目，保证 storage 与商品表一致
function getCart() {
  const data = build();
  writeRaw(data.items.map((item) => ({ productId: item.productId, qty: item.qty, selected: item.selected })));
  return api.success(data);
}

// 同步读取数量：给 tabBar 角标用，不触发 storage 写入
function getCountSync() {
  return build().totalQty;
}

function addItem(productId, qty) {
  const product = productService.listAllSync().find((item) => item.id === productId);
  if (!product || product.isAvailable === false) {
    return api.fail(4040, '该商品已下架');
  }

  const step = Math.max(1, Math.floor(Number(qty) || 1));
  const raw = normalize(readRaw());
  const index = raw.findIndex((item) => item.productId === productId);
  if (index >= 0) {
    raw[index].qty = Math.min(MAX_QTY, raw[index].qty + step);
    // 刚加过的商品重新勾选，避免结算时漏掉
    raw[index].selected = true;
  } else {
    raw.push({ productId, qty: Math.min(MAX_QTY, step), selected: true });
  }
  writeRaw(raw);
  return api.success(build());
}

// 改数量时保留勾选状态；数量 <= 0 视为移除
function updateItemQty(productId, qty) {
  const next = Math.floor(Number(qty));
  const raw = normalize(readRaw());
  const index = raw.findIndex((item) => item.productId === productId);

  if (!Number.isFinite(next) || next <= 0) {
    if (index >= 0) raw.splice(index, 1);
  } else if (index >= 0) {
    raw[index].qty = Math.min(MAX_QTY, next);
  } else {
    raw.push({ productId, qty: Math.min(MAX_QTY, next), selected: true });
  }

  writeRaw(raw);
  return api.success(build());
}

function toggleSelected(productId, selected) {
  const raw = normalize(readRaw());
  const target = raw.find((item) => item.productId === productId);
  if (target) {
    target.selected = selected !== false;
  }
  writeRaw(raw);
  return api.success(build());
}

function setAllSelected(selected) {
  const value = selected !== false;
  const raw = normalize(readRaw());
  raw.forEach((item) => {
    item.selected = value;
  });
  writeRaw(raw);
  return api.success(build());
}

function removeItem(productId) {
  writeRaw(normalize(readRaw()).filter((item) => item.productId !== productId));
  return api.success(build());
}

// 下单成功后只移除本次提交的条目，其余商品与勾选状态保留
function removeItems(productIds) {
  const ids = Array.isArray(productIds) ? productIds : [];
  writeRaw(normalize(readRaw()).filter((item) => ids.indexOf(item.productId) < 0));
  return api.success(build());
}

function clear() {
  writeRaw([]);
  return api.success({
    items: [],
    totalQty: 0,
    totalAmount: 0,
    selectedQty: 0,
    selectedAmount: 0,
    selectedCount: 0,
    allSelected: false
  });
}

module.exports = {
  getCart,
  getCountSync,
  addItem,
  updateItemQty,
  toggleSelected,
  setAllSelected,
  removeItem,
  removeItems,
  clear
};