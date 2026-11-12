module.exports = {
  version: '0.2.0',
  // 当前阶段全部使用 Mock 数据；M4 接入 CloudBase 后切换
  useMock: true,
  // Mock 接口模拟延迟区间（毫秒）
  mockDelay: [120, 260],
  // 演示阶段管理员口令：仅在本地模拟鉴权时使用，上线前必须移除
  demoAdminPassword: '8888',
  // 老板管理端口令（演示）。与 demoAdminPassword 分开，便于以后区分店主/调酒师
  demoOwnerPassword: '8888',
  // 调酒师工作台口令（演示）。与老板口令分开，Mock 阶段仅用于演示角色隔离
  demoBartenderPassword: '1234',
  demoMode: true,
  // 调酒师工作台「模拟实时」轮询间隔（毫秒）。M4 接 CloudBase 后改为订阅，不再轮询
  orderFeedIntervalMs: 5000,
  // 本地示例数据版本：改动 utils/mock-data 里的分类或商品后递增，
  // 客户端会在下次启动时自动重建缓存，不需要手动「重置演示数据」
  seedVersion: '2026-11-02-menu-v1',
  // 桌号表的种子版本：改 utils/mock-data/tables.js 后递增，客户端下次启动自动重建
  tableSeedVersion: '2026-11-02-tables-v1',
  brand: {
    name: 'Tonight',
    nameEn: 'COCKTAIL & WHISKEY BAR',
    slogan: '今夜，来点不一样的。'
  }
};