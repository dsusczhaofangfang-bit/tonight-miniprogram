const { STORAGE_KEYS } = require('./utils/constants');
const storage = require('./utils/storage');
const config = require('./config/index');
const tableService = require('./services/tables');

// 扫码进入时桌号可能出现在 query.table，也可能出现在二维码 scene 里（table=t_a1）
function parseTableId(options) {
  const query = (options && options.query) || {};
  let raw = query.table || '';

  if (!raw && query.scene) {
    try {
      const scene = decodeURIComponent(query.scene);
      const match = /(?:^|[&?])table=([^&]+)/.exec(scene);
      if (match) raw = match[1];
    } catch (error) {
      raw = '';
    }
  }

  return String(raw || '').trim();
}

App({
  globalData: {
    version: config.version,
    cart: [],
    table: null,
    adminSession: null,
    // 首页点分类后暂存，酒单页 onShow 取用（tab 页无法通过 URL 传参）
    pendingCategoryId: ''
  },

  onLaunch(options) {
    this.globalData.cart = storage.get(STORAGE_KEYS.CART, []);
    // 本地桌号可能来自旧配置：启动时校验一次，失效则清空，避免展示已停用的桌号
    this.globalData.table = this.validateTable(storage.get(STORAGE_KEYS.TABLE, null));
    this.globalData.adminSession = storage.get(STORAGE_KEYS.ADMIN_SESSION, null);
    this.syncTable(options);
  },

  onShow(options) {
    this.syncTable(options);
  },

  // 校验并归一化桌号：只保留配置里启用中的桌号，失效时清掉本地缓存
  validateTable(table) {
    if (!table || !table.id) return null;

    const found = tableService.getTableSync(table.id);
    if (!found || found.enabled === false) {
      storage.remove(STORAGE_KEYS.TABLE);
      return null;
    }

    return { id: found.id, name: found.name, area: found.area };
  },

  // 设置当前桌号：扫码解析与开发调试共用，非法桌号不接受
  setTable(tableId) {
    const table = tableService.getTableSync(tableId);
    if (!table || table.enabled === false) return null;

    this.globalData.table = { id: table.id, name: table.name, area: table.area };
    storage.set(STORAGE_KEYS.TABLE, this.globalData.table);
    return this.globalData.table;
  },

  clearTable() {
    this.globalData.table = null;
    storage.remove(STORAGE_KEYS.TABLE);
  },

  // 只接受 tables 配置里启用中的桌号，非法参数忽略
  syncTable(options) {
    const tableId = parseTableId(options);
    if (!tableId) return;
    this.setTable(tableId);
  }
});