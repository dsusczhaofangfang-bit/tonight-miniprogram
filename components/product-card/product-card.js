const FALLBACK_COVER = 'linear-gradient(135deg, #241610 0%, #3A2418 100%)';

// 分类色：与 utils/mock-data/categories.js 的 id 对应
const COVERS = {
  traditional: 'linear-gradient(135deg, #3A1420 0%, #6B1F2E 100%)',
  signature: 'linear-gradient(135deg, #3A2416 0%, #7A4A22 100%)',
  non_alcoholic: 'linear-gradient(135deg, #1F2A22 0%, #3D5445 100%)',
  snacks: 'linear-gradient(135deg, #32231A 0%, #5C3A26 100%)'
};

// 双列商品卡：M0 版式，第三阶段酒单已改为编辑式列表，本组件暂时不再被引用。
// 按 docs/05 §6 的要求保留代码，便于后台商品列表或以后复用。
Component({
  properties: {
    product: {
      type: Object,
      value: {}
    }
  },

  data: {
    cover: FALLBACK_COVER,
    priceText: '0.00',
    image: '',
    imageFailed: false
  },

  observers: {
    product(value) {
      if (!value || !value.id) return;
      this.setData({
        cover: COVERS[value.category] || FALLBACK_COVER,
        priceText: ((Number(value.price) || 0) / 100).toFixed(2),
        image: value.image || '',
        imageFailed: false
      });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('select', { product: this.data.product });
    },

    onAdd() {
      if (this.data.product && this.data.product.isAvailable === false) return;
      this.triggerEvent('add', { product: this.data.product });
    },

    onImageError() {
      this.setData({ imageFailed: true });
    }
  }
});