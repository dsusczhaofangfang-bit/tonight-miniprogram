const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const config = require('../config/index');
const tableSeed = require('../utils/mock-data/tables');

// 种子版本变化时重建缓存：改过 utils/mock-data/tables.js 后无需手动清缓存
function loadAll() {
  const seeded = storage.get(STORAGE_KEYS.SEED_TABLES, '');
  let list = storage.get(STORAGE_KEYS.TABLES, null);

  if (seeded !== config.tableSeedVersion || !Array.isArray(list) || list.length === 0) {
    list = api.clone(tableSeed);
    storage.set(STORAGE_KEYS.TABLES, list);
    storage.set(STORAGE_KEYS.SEED_TABLES, config.tableSeedVersion);
  }

  return list;
}

function listTables() {
  const list = loadAll()
    .filter((item) => item.enabled !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return api.success(api.clone(list));
}

// 供订单创建与桌号校验使用：只认配置里存在的桌号
function getTableSync(id) {
  const table = loadAll().find((item) => item.id === id);
  return table || null;
}

function getTable(id) {
  const table = getTableSync(id);
  return table ? api.success(api.clone(table)) : api.fail(4040, '桌号不存在');
}

module.exports = { listTables, getTable, getTableSync };