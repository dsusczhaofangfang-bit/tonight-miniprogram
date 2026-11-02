const api = require('./api');
const storage = require('../utils/storage');
const config = require('../config/index');
const { STORAGE_KEYS } = require('../utils/constants');

// 演示阶段的本地模拟鉴权：
// 只用于本地演示，**不是安全边界**。正式版必须由云函数校验 openid 白名单，
// 前端隐藏入口、口令放前端都只是体验层，不能作为权限依据。
const ROLES = {
  CUSTOMER: 'customer',
  OWNER: 'owner',
  BARTENDER: 'bartender'
};

const ROLE_TEXT = {
  customer: '顾客',
  owner: '老板',
  bartender: '调酒师'
};

const OWNER_PASSWORD = String(config.demoOwnerPassword || config.demoAdminPassword || '8888');

// 旧版本只存了 role: 'admin'，读出来统一归一到 owner
function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  const role = session.role === 'admin' ? ROLES.OWNER : session.role;
  return Object.assign({}, session, { role, roleText: ROLE_TEXT[role] || role });
}

function getSessionSync() {
  return normalizeSession(storage.get(STORAGE_KEYS.ADMIN_SESSION, null));
}

function login(password, role) {
  const target = role || ROLES.OWNER;
  // 调酒师端不在本阶段范围内，这里明确拒绝，避免与老板权限混淆
  if (target !== ROLES.OWNER) return api.fail(4031, '该角色暂未开放');
  if (!password) return api.fail(4001, '请输入口令');
  if (String(password) !== OWNER_PASSWORD) return api.fail(4002, '口令错误');

  const session = {
    role: ROLES.OWNER,
    name: '店主',
    loginAt: Date.now(),
    // 明确标记为模拟会话，界面需常驻「演示鉴权」
    mock: true
  };
  storage.set(STORAGE_KEYS.ADMIN_SESSION, session);
  return api.success(api.clone(normalizeSession(session)));
}

function getSession() {
  return api.success(api.clone(getSessionSync()));
}

// 页面守卫：管理端每个页面进页都调用，未登录直接拦下
function requireRole(role) {
  const session = getSessionSync();
  if (!session || session.role !== role) {
    return api.fail(4010, '请先登录老板后台');
  }
  return api.success(api.clone(session));
}

function requireOwner() {
  return requireRole(ROLES.OWNER);
}

// 兼容旧调用名（dev-check 等仍在用）
function requireAdmin() {
  return requireOwner();
}

function logout() {
  storage.remove(STORAGE_KEYS.ADMIN_SESSION);
  return api.success({});
}

module.exports = {
  ROLES,
  ROLE_TEXT,
  login,
  getSession,
  getSessionSync,
  requireRole,
  requireOwner,
  requireAdmin,
  logout
};