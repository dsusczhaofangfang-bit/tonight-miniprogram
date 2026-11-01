const { STORAGE_KEYS } = require('./utils/constants');
const storage = require('./utils/storage');
const config = require('./config/index');

App({
  globalData: {
    version: config.version,
    cart: [],
    table: null,
    adminSession: null
  },

  onLaunch() {
    this.globalData.cart = storage.get(STORAGE_KEYS.CART, []);
    this.globalData.adminSession = storage.get(STORAGE_KEYS.ADMIN_SESSION, null);
  }
});