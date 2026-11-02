// 示例分类数据：可增删、排序，结构后续直接迁移到云数据库。
// id 即商品的 category 字段取值，四个固定分类：traditional / signature / non_alcoholic / snacks。
// 首页分类入口与酒单页共用这一份数据（都通过 services/categories 读取），不在页面里重复定义。
module.exports = [
  { id: 'traditional', name: '传统饮品', nameEn: 'Classics', sort: 10, enabled: true },
  { id: 'signature', name: '特调饮品', nameEn: 'Signature', sort: 20, enabled: true },
  { id: 'non_alcoholic', name: '无酒精饮品', nameEn: 'Non-alcoholic', sort: 30, enabled: true },
  { id: 'snacks', name: '小吃', nameEn: 'Snacks', sort: 40, enabled: true }
];