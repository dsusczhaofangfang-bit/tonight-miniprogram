// 花瓣编排表：位置、大小、时长、延迟、透明度均一次性生成；
// 动画本身完全交给 WXSS，循环期间不触发 setData。
const FULL_LAYOUT = [
  { id: 'back-1', shape: 'petal-01', layer: 'back', track: 'a', left: 6, size: 46, duration: 9.6, delay: 0.4, opacity: 0.38 },
  { id: 'back-2', shape: 'petal-03', layer: 'back', track: 'c', left: 70, size: 42, duration: 10, delay: 1.6, opacity: 0.42 },
  { id: 'back-3', shape: 'petal-02', layer: 'back', track: 'd', left: 88, size: 36, duration: 9.2, delay: 2.6, opacity: 0.36 },
  { id: 'front-1', shape: 'petal-04', layer: 'front', track: 'b', left: 14, size: 26, duration: 7.2, delay: 0.8, opacity: 0.88 },
  { id: 'front-2', shape: 'petal-02', layer: 'front', track: 'd', left: 34, size: 30, duration: 8.4, delay: 2.9, opacity: 0.76 },
  { id: 'front-3', shape: 'petal-01', layer: 'front', track: 'a', left: 54, size: 20, duration: 6.4, delay: 1.1, opacity: 0.92 },
  { id: 'front-4', shape: 'petal-03', layer: 'front', track: 'c', left: 73, size: 28, duration: 8.8, delay: 2.1, opacity: 0.72 },
  { id: 'front-5', shape: 'petal-04', layer: 'front', track: 'b', left: 89, size: 22, duration: 7.6, delay: 0.2, opacity: 0.82 }
];

const LITE_LAYOUT = [
  { id: 'back-1', shape: 'petal-01', layer: 'back', track: 'a', left: 8, size: 44, duration: 10, delay: 0.3, opacity: 0.36 },
  { id: 'back-2', shape: 'petal-03', layer: 'back', track: 'c', left: 76, size: 38, duration: 9.4, delay: 1.7, opacity: 0.42 },
  { id: 'front-1', shape: 'petal-04', layer: 'front', track: 'b', left: 24, size: 24, duration: 7.4, delay: 0.7, opacity: 0.84 },
  { id: 'front-2', shape: 'petal-02', layer: 'front', track: 'd', left: 66, size: 20, duration: 6.8, delay: 2.4, opacity: 0.9 }
];

function withImage(layout) {
  return layout.map((item) =>
    Object.assign({}, item, {
      image: `/assets/petals/${item.shape}.png`
    })
  );
}

Component({
  properties: {
    // 默认 8 片；传 4（或更小）时使用低端机降级编排。
    count: {
      type: Number,
      value: 8
    }
  },

  data: {
    petals: [],
    paused: false
  },

  attached() {
    const layout = Number(this.data.count) <= 5 ? LITE_LAYOUT : FULL_LAYOUT;
    this.setData({ petals: withImage(layout) });
  },

  pageLifetimes: {
    hide() {
      if (!this.data.paused) {
        this.setData({ paused: true });
      }
    },

    show() {
      if (this.data.paused) {
        this.setData({ paused: false });
      }
    }
  }
});