const config = require('../config/index');

// Mock 接口统一响应：{ code: 0, data } 为成功，其余为业务错误
// 所有方法都返回 Promise，便于 M4 无缝替换为云函数实现
function randomDelay() {
  const [min, max] = config.mockDelay;
  return Math.floor(min + Math.random() * (max - min + 1));
}

function respond(payload) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(payload), randomDelay());
  });
}

function success(data) {
  return respond({ code: 0, data });
}

function fail(code, message) {
  return respond({ code, message });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

module.exports = { success, fail, respond, clone, nextId };