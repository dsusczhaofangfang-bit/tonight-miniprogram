// 订单「实时」抽象层。
//
// 当前为 Mock 阶段：用 setInterval 定时轮询本地 orders 存储，页面常驻「模拟实时」标识。
// **这不是真正的实时通信**，只是本地轮询；不要让 UI 文案写成「实时推送」。
//
// M4 接 CloudBase 时，只需把 createOrderFeed 的实现换成云端监听，页面代码不动：
//   const watcher = db.collection('orders').where({ status: 'pending' }).watch({
//     onChange: (snapshot) => onPoll(snapshot.docs),
//     onError: (error) => onError(error)
//   });
//   return { start, stop: () => watcher.close() };
// 云端实现必须处理：断线重连、重复事件（按订单 id 去重）、状态冲突（带期望状态更新）。
const config = require('../config/index');

function createOrderFeed(options = {}) {
  const intervalMs = Math.max(1000, Number(options.intervalMs) || config.orderFeedIntervalMs || 5000);
  let timer = null;
  let running = false;
  let inFlight = false;

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    if (running) return;
    running = true;

    // 首次立即拉取，之后按间隔轮询；上一轮未结束时跳过，避免请求堆积
    const tick = () => {
      if (!running || inFlight) return;
      inFlight = true;
      Promise.resolve()
        .then(() => options.onPoll && options.onPoll())
        .catch((error) => options.onError && options.onError(error))
        .then(() => {
          inFlight = false;
        });
    };

    tick();
    timer = setInterval(tick, intervalMs);
  }

  return {
    start,
    stop,
    isRunning: () => running,
    intervalMs
  };
}

module.exports = { createOrderFeed };