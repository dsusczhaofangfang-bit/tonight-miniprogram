Component({
  properties: {
    categoryName: { type: String, value: '' },
    // md: 132×168（列表主图位）｜sm: 96×124（管理端行内）｜xs: 64×84（订单条目）
    size: { type: String, value: 'md' },
    demo: { type: Boolean, value: true }
  }
});