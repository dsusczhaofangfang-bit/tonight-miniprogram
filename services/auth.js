const api = require('./api');
const storage = require('../utils/storage');
const config = require('../config/index');
const { STORAGE_KEYS } = require('../utils/constants');

// 演示阶段的本地模拟鉴权：
// 只用于本地演示，**不是安全边界**。正式版必须由云函数校验 openid 白名单与角色，
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

// 两个角色的会话分开存：老板与调酒师可以在同一台设备上同时保持登录态，
// 页面守卫按角色读各自的 key，互不覆盖。
const SESSION_KEY_BY_ROLE = {
  owner: STORAGE_KEYS.ADMIN_SESSION,
  bartender: STORAGE_KEYS.BARTENDER_SESSION
};

const PASSWORD_BY_ROLE = {
  owner: String(config.demoOwnerPassword || config.demoAdminPassword || '8888'),
  bartender: String(config.demoBartenderPassword || '')
};

const SESSION_NAME_BY_ROLE = {
  owner: '店主',
  bartender: '调酒师'
};

// 动作级权限表：页面据此决定是否渲染入口，服务层据此拒绝越权操作。
// 正式版应把这张表放到云函数/数据库规则里，前端只做展示层裁剪。
const PERMISSIONS = {
  customer: ['order:create', 'order:read:self', 'order:cancel:self'],
  owner: ['*'],
  bartender: ['order:read', 'order:accept', 'order:complete', 'order:exception:create']
};

// 旧版本只存了 role: 'admin'，读出来统一归一到 owner
function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  const role = session.role === 'admin' ? ROLES.OWNER : session.role;
  return Object.assign({}, session, { role, roleText: ROLE_TEXT[role] || role });
}

function sessionKey(role) {
  const target = role || ROLES.OWNER;
  const key = SESSION_KEY_BY_ROLE[target];
  if (!key) throw new Error(`未知角色：${target}`);
  return key;
}

function getSessionSync(role) {
  return normalizeSession(storage.get(sessionKey(role), null));
}

function getSession(role) {
  return api.success(api.clone(getSessionSync(role)));
}

function login(password, role) {
  const target = role || ROLES.OWNER;
  if (target !== ROLES.OWNER && target !== ROLES.BARTENDER) {
    return api.fail(4031, '该角色暂未开放');
  }
  if (!password) return api.fail(4001, '请输入口令');

  const expected = PASSWORD_BY_ROLE[target];
  // 口令未配置时直接拒绝，避免空口令被当成正确口令
  if (!expected || String(password) !== expected) return api.fail(4002, '口令错误');

  const session = {
    role: target,
    name: SESSION_NAME_BY_ROLE[target],
    loginAt: Date.now(),
    // 明确标记为模拟会话，界面需常驻「演示鉴权」
    mock: true
  };
  storage.set(sessionKey(target), session);
  return api.success(api.clone(normalizeSession(session)));
}

// 页面守卫：对应角色的页面进页都调用，未登录直接拦下
function requireRole(role) {
  const target = role || ROLES.OWNER;
  const session = getSessionSync(target);
  if (!session || session.role !== target) {
    return api.fail(
      4010,
      target === ROLES.BARTENDER ? '请先登录调酒师工作台' : '请先登录老板后台'
    );
  }
  return api.success(api.clone(session));
}

function requireOwner() {
  return requireRole(ROLES.OWNER);
}

function requireBartender() {
  return requireRole(ROLES.BARTENDER);
}

// 兼容旧调用名（dev-check 等仍在用）
function requireAdmin() {
  return requireOwner();
}

function can(role, action) {
  const target = role || ROLES.CUSTOMER;
  const list = PERMISSIONS[target] || [];
  return list.indexOf('*') >= 0 || list.indexOf(action) >= 0;
}

// 退出只清对应角色的会话；默认退出老板会话，兼容旧调用
function logout(role) {
  storage.remove(sessionKey(role));
  return api.success({});
}

module.exports = {
  ROLES,
  ROLE_TEXT,
  PERMISSIONS,
  login,
  getSession,
  getSessionSync,
  requireRole,
  requireOwner,
  requireBartender,
  requireAdmin,
  can,
  logout
};