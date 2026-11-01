const FALLBACK_COVER = 'linear-gradient(135deg, #241610 0%, #3A2418 100%)';

const COVERS = {
  cat_cocktail: 'linear-gradient(135deg, #3A1420 0%, #6B1F2E 100%)',
  cat_whiskey: 'linear-gradient(135deg, #3A2A16 0%, #7A5520 100%)',
  cat_beer: 'linear-gradient(135deg, #3A3117 0%, #8A6E26 100%)',
  cat_snacks: 'linear-gradient(135deg, #32231A 0%, #5C3A26 100%)'
};

Component({
  properties: {
    product: {
      type: Object,
      value: {}
    }
  },

  data: {
    cover: FALLBACK_COVER,
    priceText: '0.00'
  },

  observers: {
    product(value) {
      if (!value || !value.id) return;
      this.setData({
        cover: COVERS[value.categoryId] || FALLBACK_COVER,
        priceText: ((Number(value.price) || 0) / 100).toFixed(2)
      });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('select', { product: this.data.product });
    },

    onAdd() {
      this.triggerEvent('add', { product: this.data.product });
    }
  }
});