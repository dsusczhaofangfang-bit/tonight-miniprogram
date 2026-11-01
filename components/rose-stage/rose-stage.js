// 玫瑰本体：显形 → 保持 → 解体淡出，全程 CSS 动画，无定时器、无 setData。
//
// 三层各管一件事，避免多个动画抢同一属性：
//   .rose__dissolve  管 1.0s 之后的整体淡出（含子元素）
//   .rose__appear    管 0.05s 的显形（缩放 + 位移）
//   .rose__halo      管顶部偏上的红色轮廓光（实测素材光源在上方）
Component({
  properties: {
    src: { type: String, value: '/assets/rose/rose-main-lit.png' },
    // 显示宽度；高度由图片比例（754:673）自动决定
    width: { type: String, value: '66vw' },
    top: { type: String, value: '30vh' },
    appearDelay: { type: Number, value: 50 },
    // 开始淡出的时刻（ms），必须与 petal-field 的 burstAt 一致
    dissolveAt: { type: Number, value: 1000 },
    dissolveMs: { type: Number, value: 650 },
    halo: { type: Boolean, value: true }
  }
});