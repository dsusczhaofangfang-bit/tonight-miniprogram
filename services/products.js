const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const productSeed = require('../utils/mock-data/products');

function loadAll() {
  let list = storage.get(STORAGE_KEYS.PRODUCTS, null);
  if (!Array.isArray(list) || list.length === 0) {
    list = api.clone(productSeed);
    storage.set(STORAGE_KEYS.PRODUCTS, list);
  }
  return list;
}

function saveAll(list) {
  storage.set(STORAGE_KEYS.PRODUCTS, list);
}

function sortList(list) {
  return list.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function listProducts(options = {}) {
  const categoryId = options.categoryId || '';
  const onlyOnSale = options.onlyOnSale !== false;

  const list = loadAll().filter((item) => {
    if (onlyOnSale && item.status !== 'on') return false;
    if (categoryId && item.categoryId !== categoryId) return false;
    return true;
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

function categoryExists(categoryId) {
  const categories = storage.get(STORAGE_KEYS.CATEGORIES, null);
  if (!Array.isArray(categories) || categories.length === 0) return true;
  return categories.some((item) => item.id === categoryId);
}

function createProduct(input = {}) {
  const name = String(input.name || '').trim();
  const price = Number(input.price);
  if (!name) return api.fail(4001, '请填写商品名称');
  if (!Number.isFinite(price) || price <= 0) return api.fail(4002, '请填写正确的价格（单位：分）');
  if (!input.categoryId) return api.fail(4003, '请选择分类');
  if (!categoryExists(input.categoryId)) return api.fail(4004, '分类不存在');

  const list = loadAll();
  const product = {
    id: api.nextId('p'),
    categoryId: input.categoryId,
    name,
    nameEn: String(input.nameEn || '').trim(),
    desc: String(input.desc || '').trim(),
    price: Math.round(price),
    image: input.image || '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    abv: input.abv === undefined || input.abv === null || input.abv === '' ? null : Number(input.abv),
    status: input.status === 'off' ? 'off' : 'on',
    sort: Number(input.sort) || (list.length + 1) * 10,
    isDemo: false
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
  const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;

  if (!name) return api.fail(4001, '请填写商品名称');
  if (!Number.isFinite(price) || price <= 0) return api.fail(4002, '请填写正确的价格（单位：分）');
  if (!categoryId) return api.fail(4003, '请选择分类');
  if (!categoryExists(categoryId)) return api.fail(4004, '分类不存在');

  list[index] = Object.assign({}, current, {
    name,
    categoryId,
    nameEn: input.nameEn === undefined ? current.nameEn : String(input.nameEn).trim(),
    desc: input.desc === undefined ? current.desc : String(input.desc).trim(),
    price: Math.round(price),
    image: input.image === undefined ? current.image : input.image,
    tags: input.tags === undefined ? current.tags : input.tags,
    abv: input.abv === undefined ? current.abv : (input.abv === null || input.abv === '' ? null : Number(input.abv)),
    status: input.status === undefined ? current.status : (input.status === 'off' ? 'off' : 'on'),
    sort: input.sort === undefined ? current.sort : Number(input.sort)
  });
  saveAll(list);
  return api.success(api.clone(list[index]));
}

function toggleProductStatus(id) {
  const list = loadAll();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return api.fail(4040, '商品不存在');
  list[index].status = list[index].status === 'on' ? 'off' : 'on';
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
  toggleProductStatus,
  removeProduct
};