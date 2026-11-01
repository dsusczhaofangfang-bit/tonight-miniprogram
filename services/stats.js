const api = require('./api');
const storage = require('../utils/storage');
const format = require('../utils/format');
const { STORAGE_KEYS, ORDER_STATUS, PAY_STATUS } = require('../utils/constants');

function loadOrders() {
  const list = storage.get(STORAGE_KEYS.ORDERS, []);
  return Array.isArray(list) ? list : [];
}

// 有效订单：已模拟支付且未取消
function isValid(order) {
  return order.payStatus === PAY_STATUS.MOCK_PAID && order.status !== ORDER_STATUS.CANCELLED;
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
    acceptedCount: validOrders.filter((order) => order.status === ORDER_STATUS.ACCEPTED).length,
    makingCount: validOrders.filter((order) => order.status === ORDER_STATUS.MAKING).length,
    completedCount: todayValid.filter((order) => order.status === ORDER_STATUS.COMPLETED).length
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

module.exports = { getTodayStats, getRecentDays };