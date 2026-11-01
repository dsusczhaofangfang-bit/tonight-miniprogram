const api = require('./api');
const storage = require('../utils/storage');
const config = require('../config/index');
const { STORAGE_KEYS } = require('../utils/constants');

// 演示阶段的本地模拟鉴权：
// 仅用于本地演示，不是安全边界；正式版由云函数校验 openid 白名单。
function login(password) {
  if (!password) return api.fail(4001, '请输入口令');
  if (String(password) !== String(config.demoAdminPassword)) {
    return api.fail(4002, '口令错误');
  }

  const session = {
    role: 'admin',
    name: '店主',
    loginAt: Date.now(),
    mock: true
  };
  storage.set(STORAGE_KEYS.ADMIN_SESSION, session);
  return api.success(session);
}

function getSession() {
  return api.success(storage.get(STORAGE_KEYS.ADMIN_SESSION, null));
}

function requireAdmin() {
  const session = storage.get(STORAGE_KEYS.ADMIN_SESSION, null);
  if (!session || session.role !== 'admin') {
    return api.fail(4010, '未登录管理员');
  }
  return api.success(session);
}

function logout() {
  storage.remove(STORAGE_KEYS.ADMIN_SESSION);
  return api.success({});
}

module.exports = { login, getSession, requireAdmin, logout };