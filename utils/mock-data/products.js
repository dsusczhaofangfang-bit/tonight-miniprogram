// 示例商品数据：每类 6 款，共 24 款。
// 注意：名称、价格、简介均为示例，不代表酒馆真实酒单，后续由真实数据替换。
const GROUPS = [
  {
    categoryId: 'cat_cocktail',
    nameCn: '鸡尾酒',
    nameEn: 'Cocktail',
    prices: [5800, 6800, 7800, 6800, 8800, 6200]
  },
  {
    categoryId: 'cat_whiskey',
    nameCn: '威士忌',
    nameEn: 'Whiskey',
    prices: [8800, 9800, 10800, 12800, 7800, 15800]
  },
  {
    categoryId: 'cat_beer',
    nameCn: '啤酒',
    nameEn: 'Beer',
    prices: [2800, 3200, 3800, 4200, 3600, 4800]
  },
  {
    categoryId: 'cat_snacks',
    nameCn: '小食',
    nameEn: 'Snacks',
    prices: [2800, 3200, 3600, 4200, 2600, 3800]
  }
];

const products = [];

GROUPS.forEach((group) => {
  const categoryKey = group.categoryId.replace('cat_', '');
  group.prices.forEach((price, index) => {
    const no = String(index + 1).padStart(2, '0');
    products.push({
      id: `p_${categoryKey}_${no}`,
      categoryId: group.categoryId,
      name: `示例·${group.nameCn} ${no}`,
      nameEn: `Demo ${group.nameEn} ${no}`,
      desc: '示例数据，待替换为真实酒单。',
      price,
      image: '',
      tags: ['示例'],
      abv: null,
      status: 'on',
      sort: (index + 1) * 10,
      isDemo: true
    });
  });
});

module.exports = products;