const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const config = require('../config/index');
const productSeed = require('../utils/mock-data/products');

// 商品字段（与 docs/01 第 5 章一致）：
// id / name / category / price / description / image / isAvailable
// 另带 nameEn（英文名）、tags、abv、sort 等展示与排序字段，迁移云数据库时同名字段直接对应。

// 种子版本变化时重建缓存：改过 mock-data 后客户端无需手动「重置演示数据」
function loadAll() {
  const seeded = storage.get(STORAGE_KEYS.SEED_PRODUCTS, '');
  let list = storage.get(STORAGE_KEYS.PRODUCTS, null);
  if (seeded !== config.seedVersion || !Array.isArray(list) || list.length === 0) {
    list = api.clone(productSeed);
    storage.set(STORAGE_KEYS.PRODUCTS, list);
    storage.set(STORAGE_KEYS.SEED_PRODUCTS, config.seedVersion);
  }
  return list;
}

function saveAll(list) {
  storage.set(STORAGE_KEYS.PRODUCTS, list);
}

function sortList(list) {
  return list.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

// 名称搜索：中文名、英文名都参与匹配，忽略大小写
function matchKeyword(product, keyword) {
  if (!keyword) return true;
  return (
    String(product.name || '').toLowerCase().indexOf(keyword) >= 0 ||
    String(product.nameEn || '').toLowerCase().indexOf(keyword) >= 0
  );
}

// options: { category | categoryId, keyword, onlyAvailable | onlyOnSale }
// 分类与搜索都走这一层，M4 换云函数时只改这里，页面不用动
function listProducts(options = {}) {
  const category = options.category || options.categoryId || '';
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const onlyAvailable = options.onlyAvailable !== false && options.onlyOnSale !== false;

  const list = loadAll().filter((item) => {
    if (onlyAvailable && item.isAvailable === false) return false;
    if (category && item.category !== category) return false;
    return matchKeyword(item, keyword);
  });
  return api.success(api.clone(sortList(list)));
}

// 服务内部同步读取：供订单创建时重算价格，避免信任前端传值
function listAllSync() {
  return sortList(loadAll());
}

function getProduct(id) {
  const product = loadAll().find((item) => item.id === id);
  return product ? api.success(api.clone(product)) : api.fail(4040, '商品不存在');
}

function categoryExists(category) {
  const categories = storage.get(STORAGE_KEYS.CATEGORIES, null);
  if (!Array.isArray(categories) || categories.length === 0) return true;
  return categories.some((item) => item.id === category);
}

function readCategory(input) {
  return String(input.category || input.categoryId || '').trim();
}

function createProduct(input = {}) {
  const name = String(input.name || '').trim();
  const price = Number(input.price);
  const category = readCategory(input);
  if (!name) return api.fail(4001, '请填写商品名称');
  if (!Number.isFinite(price) || price <= 0) return api.fail(4002, '请填写正确的价格（单位：分）');
  if (!category) return api.fail(4003, '请选择分类');
  if (!categoryExists(category)) return api.fail(4004, '分类不存在');

  const list = loadAll();
  const product = {
    id: api.nextId('p'),
    name,
    nameEn: String(input.nameEn || '').trim(),
    category,
    price: Math.round(price),
    description: String(input.description || input.desc || '').trim(),
    image: input.image || '',
    isAvailable: input.isAvailable !== false,
    tags: Array.isArray(input.tags) ? input.tags : [],
    abv: input.abv === undefined || input.abv === null || input.abv === '' ? null : Number(input.abv),
    sort: Number(input.sort) || (list.length + 1) * 10
  };
  list.push(product);
  saveAll(list);
  return api.success(api.clone(product));
}

function updateProduct(id, input = {}) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '商品不存在');

  const current = list[index];
  const name = input.name === undefined ? current.name : String(input.name).trim();
  const price = input.price === undefined ? current.price : Number(input.price);
  const category = input.category === undefined && input.categoryId === undefined
    ? current.category
    : readCategory(input);

  if (!name) return api.fail(4001, '请填写商品名称');
  if (!Number.isFinite(price) || price <= 0) return api.fail(4002, '请填写正确的价格（单位：分）');
  if (!category) return api.fail(4003, '请选择分类');
  if (!categoryExists(category)) return api.fail(4004, '分类不存在');

  const description = input.description === undefined && input.desc === undefined
    ? current.description
    : String(input.description || input.desc || '').trim();

  list[index] = Object.assign({}, current, {
    name,
    category,
    nameEn: input.nameEn === undefined ? current.nameEn : String(input.nameEn).trim(),
    description,
    price: Math.round(price),
    image: input.image === undefined ? current.image : input.image,
    isAvailable: input.isAvailable === undefined ? current.isAvailable !== false : input.isAvailable === true,
    tags: input.tags === undefined ? current.tags : input.tags,
    abv: input.abv === undefined ? current.abv : (input.abv === null || input.abv === '' ? null : Number(input.abv)),
    sort: input.sort === undefined ? current.sort : Number(input.sort)
  });
  saveAll(list);
  return api.success(api.clone(list[index]));
}

// 上架 / 下架：酒单与详情只展示 isAvailable !== false 的商品
function toggleProductAvailability(id) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '商品不存在');
  list[index].isAvailable = list[index].isAvailable === false;
  saveAll(list);
  return api.success(api.clone(list[index]));
}

// 明确设置上下架状态：管理端用（toggle 在重复点击时会翻错方向）
function setProductAvailability(id, isAvailable) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '商品不存在');
  list[index].isAvailable = isAvailable !== false;
  saveAll(list);
  return api.success(api.clone(list[index]));
}

function removeProduct(id) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '商品不存在');
  list.splice(index, 1);
  saveAll(list);
  return api.success({ id });
}

module.exports = {
  listProducts,
  listAllSync,
  getProduct,
  createProduct,
  updateProduct,
  toggleProductAvailability,
  setProductAvailability,
  removeProduct
};