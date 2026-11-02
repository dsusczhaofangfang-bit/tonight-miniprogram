// 示例商品数据：每类 6 款，共 24 款。
// 字段与 docs/01 第 5 章一致：id / name / category / price / description / image / isAvailable。
// 名称、价格、介绍均为示例，不代表酒馆真实酒单，后续由真实数据替换。
// category 取值与 utils/mock-data/categories.js 的 id 一一对应。
const GROUPS = [
  { category: 'traditional', label: '传统饮品', en: 'Classics', prices: [5800, 6800, 7800, 6200, 8800, 6800] },
  { category: 'signature', label: '特调饮品', en: 'Signature', prices: [6800, 7800, 8800, 9800, 7200, 8800] },
  { category: 'non_alcoholic', label: '无酒精饮品', en: 'Non-alcoholic', prices: [3200, 3600, 3800, 4200, 3600, 4600] },
  { category: 'snacks', label: '小吃', en: 'Snacks', prices: [2800, 3200, 3600, 4200, 2600, 3800] }
];

const DESCRIPTION = '示例数据：风味、配方与口感待替换为真实酒单内容。';

const products = [];

GROUPS.forEach((group) => {
  group.prices.forEach((price, index) => {
    const no = String(index + 1).padStart(2, '0');
    products.push({
      id: `p_${group.category}_${no}`,
      name: `示例·${group.label} ${no}`,
      nameEn: `Demo ${group.en} ${no}`,
      category: group.category,
      price,
      description: DESCRIPTION,
      // 暂无真实商品图：留空时页面统一显示 CSS 酒标式占位块
      image: '',
      isAvailable: true,
      tags: ['示例'],
      abv: null,
      sort: (index + 1) * 10
    });
  });
});

module.exports = products;