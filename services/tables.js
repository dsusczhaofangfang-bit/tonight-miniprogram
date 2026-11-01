const api = require('./api');
const storage = require('../utils/storage');
const { STORAGE_KEYS } = require('../utils/constants');
const tableSeed = require('../utils/mock-data/tables');

function loadAll() {
  let list = storage.get(STORAGE_KEYS.TABLES, null);
  if (!Array.isArray(list) || list.length === 0) {
    list = api.clone(tableSeed);
    storage.set(STORAGE_KEYS.TABLES, list);
  }
  return list;
}

function listTables() {
  const list = loadAll()
    .filter((item) => item.enabled !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return api.success(api.clone(list));
}

// 供订单创建时同步校验桌号
function getTableSync(id) {
  const table = loadAll().find((item) => item.id === id);
  return table || null;
}

function getTable(id) {
  const table = getTableSync(id);
  return table ? api.success(api.clone(table)) : api.fail(4040, '桌号不存在');
}

module.exports = { listTables, getTable, getTableSync };