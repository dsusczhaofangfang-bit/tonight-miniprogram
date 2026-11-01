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

module.exports = {
  pad2,
  fenToYuan,
  dateKey,
  formatDate,
  formatTime,
  formatDateTime,
  isToday
};