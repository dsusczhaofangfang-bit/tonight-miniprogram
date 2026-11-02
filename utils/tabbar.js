// tabBar 购物车角标：首页、酒单、商品详情、购物车共用
// tabBar 顺序固定为 首页(0) / 酒单(1) / 购物车(2) / 我的订单(3)
const CART_TAB_INDEX = 2;

function setCartBadge(count) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  try {
    if (value > 0) {
      wx.setTabBarBadge({
        index: CART_TAB_INDEX,
        text: value > 99 ? '99+' : String(value)
      });
    } else {
      wx.removeTabBarBadge({ index: CART_TAB_INDEX });
    }
  } catch (error) {
    // 非预期环境下 tabBar 不可用，角标失败不影响业务
  }
}

module.exports = { CART_TAB_INDEX, setCartBadge };