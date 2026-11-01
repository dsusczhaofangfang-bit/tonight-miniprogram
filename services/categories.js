const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const categorySeed = require('../utils/mock-data/categories');

function loadAll() {
  let list = storage.get(STORAGE_KEYS.CATEGORIES, null);
  if (!Array.isArray(list) || list.length === 0) {
    list = api.clone(categorySeed);
    storage.set(STORAGE_KEYS.CATEGORIES, list);
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
  if (products.some((item) => item.categoryId === id)) {
    return api.fail(4003, '该分类下还有商品，无法删除');
  }

  list.splice(index, 1);
  saveAll(list);
  return api.success({ id });
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  removeCategory
};