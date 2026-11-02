// 首页推荐位：替换真实酒单时只改这一个文件，不用动页面。
// featured：今晚推荐（带图块与加购入口，按顺序最多取 3 款）
// seasonal：当季推荐（纯编辑文字，每款配一句推荐语）
// 所有商品 id 必须存在于 utils/mock-data/products.js；失效 id 会被服务层自动跳过。
module.exports = {
  season: '冬季',
  featured: ['p_signature_03', 'p_traditional_01', 'p_non_alcoholic_02'],
  seasonal: [
    { productId: 'p_signature_01', note: '柑橘皮与苦精收尾，冷天里最干净的一杯。' },
    { productId: 'p_traditional_05', note: '酒体偏重，适合坐到打烊。' },
    { productId: 'p_non_alcoholic_04', note: '不喝酒也有仪式感，酸甜平衡。' }
  ]
};