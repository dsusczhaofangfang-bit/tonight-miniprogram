const api = require('./api');
const shopSeed = require('../utils/mock-data/shop');

function getShop() {
  return api.success(api.clone(shopSeed));
}

module.exports = { getShop };