const api = require('./api');
const storage = require('../utils/storage');
const format = require('../utils/format');
const products = require('./products');
const { STORAGE_KEYS, ORDER_STATUS, EXCEPTION_STATUS } = require('../utils/constants');

function loadOrders() {
  const list = storage.get(STORAGE_KEYS.ORDERS, []);
  return Array.isArray(list) ? list : [];
}

// 有效订单：未取消（本阶段不涉及支付，下单即计入；M5 接入支付后再按 payStatus 收口）
function isValid(order) {
  return order.status !== ORDER_STATUS.CANCELLED;
}

function getTodayStats() {
  const orders = loadOrders();
  const todayKey = format.dateKey();
  const validOrders = orders.filter(isValid);
  const todayValid = validOrders.filter((order) => format.dateKey(order.createdAt) === todayKey);

  return api.success({
    date: todayKey,
    orderCount: todayValid.length,
    revenue: todayValid.reduce((sum, order) => sum + (order.totalAmount || 0), 0),
    pendingCount: validOrders.filter((order) => order.status === ORDER_STATUS.PENDING).length,
    makingCount: validOrders.filter((order) => order.status === ORDER_STATUS.MAKING).length,
    completedCount: todayValid.filter((order) => order.status === ORDER_STATUS.COMPLETED).length
  });
}

// 老板端经营概览：口径固定为「已取消不计入订单数与营业额」。
// 数据全部实时读现有 orders / products，不单独存副本，商品上下架后即刻生效。
function getAdminOverview() {
  const orders = loadOrders();
  const todayKey = format.dateKey();
  const valid = orders.filter(isValid);
  const todayValid = valid.filter((order) => format.dateKey(order.createdAt) === todayKey);
  const catalog = products.listAllSync();

  return api.success({
    date: todayKey,
    todayOrderCount: todayValid.length,
    todayRevenue: todayValid.reduce((sum, order) => sum + (order.totalAmount || 0), 0),
    todayCancelledCount: orders.filter(
      (order) => order.status === ORDER_STATUS.CANCELLED && format.dateKey(order.createdAt) === todayKey
    ).length,
    // 待处理 = 还没结束的订单（待接单 + 制作中），已取消/已完成不算
    handlingCount: valid.filter(
      (order) => order.status === ORDER_STATUS.PENDING || order.status === ORDER_STATUS.MAKING
    ).length,
    pendingCount: valid.filter((order) => order.status === ORDER_STATUS.PENDING).length,
    makingCount: valid.filter((order) => order.status === ORDER_STATUS.MAKING).length,
    openExceptionCount: orders.filter(
      (order) => order.exception && order.exception.status === EXCEPTION_STATUS.OPEN
    ).length,
    onSaleCount: catalog.filter((item) => item.isAvailable !== false).length,
    offSaleCount: catalog.filter((item) => item.isAvailable === false).length,
    totalProductCount: catalog.length
  });
}

function getRecentDays(days = 7) {
  const orders = loadOrders();
  const result = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = format.dateKey(date.getTime());
    const dayOrders = orders.filter((order) => isValid(order) && format.dateKey(order.createdAt) === key);
    result.push({
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      orderCount: dayOrders.length,
      revenue: dayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0)
    });
  }

  return api.success(result);
}

module.exports = { getTodayStats, getRecentDays, getAdminOverview };