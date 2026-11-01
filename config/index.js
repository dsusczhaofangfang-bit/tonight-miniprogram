module.exports = {
  version: '0.1.0',
  // 当前阶段全部使用 Mock 数据；M4 接入 CloudBase 后切换
  useMock: true,
  // Mock 接口模拟延迟区间（毫秒）
  mockDelay: [120, 260],
  // 演示阶段管理员口令：仅在本地模拟鉴权时使用，上线前必须移除
  demoAdminPassword: '8888',
  demoMode: true,
  brand: {
    name: '柠舍唔同',
    nameEn: 'COCKTAIL & WHISKEY BAR',
    slogan: '今夜，来点不一样的。'
  }
};