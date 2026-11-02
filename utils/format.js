function pad2(value) {
  return String(value).padStart(2, '0');
}

// 分 → 元，字符串保留两位小数
function fenToYuan(fen) {
  const value = Number(fen);
  return (Number.isFinite(value) ? value / 100 : 0).toFixed(2);
}

// YYYYMMDD，用于按天聚合
function dateKey(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDateTime(timestamp) {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

function isToday(timestamp) {
  return dateKey(timestamp) === dateKey();
}

// 表单里的「元」→ 整数分：只接受非负、最多两位小数，非法返回 null。
// 用字符串拼整数，避免 parseFloat('58.05') * 100 = 5804.999… 这类浮点误差。
function yuanToFen(input) {
  const raw = String(input === undefined || input === null ? '' : input).trim();
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const yuan = parseInt(match[1], 10) * 100;
  const fen = match[2] ? parseInt(match[2].padEnd(2, '0'), 10) : 0;
  return yuan + fen;
}

// 分 → 元（表单回填用，固定两位小数）
function fenToYuanInput(fen) {
  const value = Number(fen);
  return (Number.isFinite(value) ? value / 100 : 0).toFixed(2);
}

module.exports = {
  pad2,
  fenToYuan,
  fenToYuanInput,
  yuanToFen,
  dateKey,
  formatDate,
  formatTime,
  formatDateTime,
  isToday
};