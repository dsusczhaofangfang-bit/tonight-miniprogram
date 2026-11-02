// 首页推荐位：把 utils/mock-data/recommend.js 里的 id 与商品表 join，
// 已下架或已删除的商品自动跳过，不用改页面。
const api = require('./api');
const productService = require('./products');
const recommendSeed = require('../utils/mock-data/recommend');

function getHome() {
  return productService.listProducts({}).then((res) => {
    if (res.code !== 0) return res;

    const products = res.data;
    const map = {};
    products.forEach((product) => {
      map[product.id] = product;
    });

    const featured = (recommendSeed.featured || [])
      .map((id) => map[id])
      .filter(Boolean)
      .slice(0, 3);

    const seasonal = (recommendSeed.seasonal || [])
      .map((entry) => ({ note: entry.note, product: map[entry.productId] }))
      .filter((entry) => Boolean(entry.product));

    return api.success({
      season: recommendSeed.season || '',
      featured,
      seasonal,
      totalCount: products.length
    });
  });
}

module.exports = { getHome };