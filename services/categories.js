const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const config = require('../config/index');
const categorySeed = require('../utils/mock-data/categories');

// 种子版本变化时重建缓存：改过 mock-data 后客户端无需手动「重置演示数据」
function loadAll() {
  const seeded = storage.get(STORAGE_KEYS.SEED_CATEGORIES, '');
  let list = storage.get(STORAGE_KEYS.CATEGORIES, null);
  if (seeded !== config.seedVersion || !Array.isArray(list) || list.length === 0) {
    list = api.clone(categorySeed);
    storage.set(STORAGE_KEYS.CATEGORIES, list);
    storage.set(STORAGE_KEYS.SEED_CATEGORIES, config.seedVersion);
  }
  return list;
}

function saveAll(list) {
  storage.set(STORAGE_KEYS.CATEGORIES, list);
}

function sortList(list) {
  return list.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function listCategories(options = {}) {
  const includeDisabled = options.includeDisabled === true;
  const list = sortList(loadAll().filter((item) => includeDisabled || item.enabled !== false));
  return api.success(api.clone(list));
}

// 同步读取启用中的分类：下单时写订单快照用，不经过 Promise
function listAllSync() {
  return sortList(loadAll().filter((item) => item.enabled !== false));
}

function getCategory(id) {
  const category = loadAll().find((item) => item.id === id);
  return category ? api.success(api.clone(category)) : api.fail(4040, '分类不存在');
}

function createCategory(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) return api.fail(4001, '请填写分类名称');

  const list = loadAll();
  if (list.some((item) => item.name === name)) {
    return api.fail(4002, '分类名称已存在');
  }

  const category = {
    id: api.nextId('cat'),
    name,
    nameEn: String(input.nameEn || '').trim(),
    sort: Number(input.sort) || (list.length + 1) * 10,
    enabled: input.enabled !== false
  };
  list.push(category);
  saveAll(list);
  return api.success(api.clone(category));
}

function updateCategory(id, input = {}) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '分类不存在');

  const current = list[index];
  const name = input.name === undefined ? current.name : String(input.name).trim();
  if (!name) return api.fail(4001, '请填写分类名称');
  if (list.some((item) => item.id !== id && item.name === name)) {
    return api.fail(4002, '分类名称已存在');
  }

  list[index] = Object.assign({}, current, {
    name,
    nameEn: input.nameEn === undefined ? current.nameEn : String(input.nameEn).trim(),
    sort: input.sort === undefined ? current.sort : Number(input.sort),
    enabled: input.enabled === undefined ? current.enabled : input.enabled === true
  });
  saveAll(list);
  return api.success(api.clone(list[index]));
}

function removeCategory(id) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '分类不存在');

  const products = storage.get(STORAGE_KEYS.PRODUCTS, null) || [];
  if (products.some((item) => item.category === id)) {
    return api.fail(4003, '该分类下还有商品，无法删除');
  }

  list.splice(index, 1);
  saveAll(list);
  return api.success({ id });
}

module.exports = {
  listCategories,
  listAllSync,
  getCategory,
  createCategory,
  updateCategory,
  removeCategory
};