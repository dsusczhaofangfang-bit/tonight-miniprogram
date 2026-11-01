// 欢迎页花瓣场。
//
// 两组花瓣：
//   hero   —— 12 片，起始坐标全部落在玫瑰中央 30–66% 区间，被不透明的玫瑰完全遮住；
//             玫瑰 1.0s 开始淡出时它们同时向外冲，视觉上是"玫瑰在解体"，不是换图。
//   ambient—— 12 片，无限循环，从 2.0s 起接管画面，保证 9s 后仍然在下花瓣。
//
// 所有参数一次算好写进 data，动画全部交给 WXSS，运行期不再 setData、不建定时器。
// 尺寸归一化：素材画布四周留白 3.6%–11.1%，用 k 把"声明尺寸"换算成"画布尺寸"，
// 这样同一 size 的六种花瓣看起来一样大。

// 画布宽 66vw = 495rpx（1vw = 7.5rpx），高 495 × 673 / 754 = 442rpx。
// hero 原点固定在玫瑰中心（top: 30vh + 221rpx，left: 50%），写在 .pf__hero-item 里；
// 改 rose-stage 的 width/top 时必须同步修改该规则。

const SHAPES = {
  'petal-01': { k: 1.133, ratio: 0.813, portrait: true },
  'petal-02': { k: 1.094, ratio: 1.571, portrait: false },
  'petal-03': { k: 1.150, ratio: 1.391, portrait: false },
  'petal-04': { k: 1.097, ratio: 1.542, portrait: false },
  'petal-05': { k: 1.140, ratio: 1.515, portrait: false },
  'petal-06': { k: 1.105, ratio: 1.274, portrait: false }
};

// 主体尺寸：size 为花瓣长边的视觉尺寸（rpx）
function sizeOf(shape, size) {
  const meta = SHAPES[shape];
  let width;
  let height;
  if (meta.portrait) {
    height = size * meta.k;
    width = height * meta.ratio;
  } else {
    width = size * meta.k;
    height = width / meta.ratio;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

// id, 形态, 镜像, 簇内 x%, 簇内 y%, 放射 dx, 放射 dy, 终态旋转, size, opacity
const HERO = [
  ['h01', 'petal-01', false, 38, 40, -150, -90, -330, 60, 0.90],
  ['h02', 'petal-02', true, 56, 34, 120, -110, 260, 54, 0.85],
  ['h03', 'petal-03', false, 46, 52, -60, -160, -300, 48, 0.80],
  ['h04', 'petal-04', false, 62, 48, 170, -30, 300, 66, 0.92],
  ['h05', 'petal-05', true, 34, 56, -190, -20, -240, 58, 0.88],
  ['h06', 'petal-06', false, 52, 62, 40, -180, 180, 44, 0.75],
  ['h07', 'petal-02', false, 44, 30, -90, -140, -160, 40, 0.70],
  ['h08', 'petal-04', true, 66, 60, 200, 40, 320, 62, 0.90],
  ['h09', 'petal-01', true, 30, 44, -170, 60, -280, 52, 0.85],
  ['h10', 'petal-05', false, 58, 40, 90, -150, 200, 46, 0.72],
  ['h11', 'petal-03', true, 40, 64, -40, -200, -190, 38, 0.68],
  ['h12', 'petal-06', true, 54, 46, 140, -70, 240, 42, 0.66]
];

// 低端机只保留 8 片：左右均衡、含全部四种形态
const HERO_LITE = ['h01', 'h02', 'h04', 'h05', 'h06', 'h08', 'h09', 'h12'];

// id, left%, 形态, size, opacity, 时长 s, 错峰延迟 s, 轨迹, 是否近景
const AMBIENT = [
  ['a01', 4, 'petal-03', 24, 0.34, 10.6, 0.0, 'track-a', false],
  ['a02', 16, 'petal-01', 28, 0.38, 9.4, 1.4, 'track-c', false],
  ['a03', 40, 'petal-06', 20, 0.30, 11.0, 0.6, 'track-b', false],
  ['a04', 62, 'petal-02', 26, 0.42, 9.8, 2.2, 'track-d', false],
  ['a05', 88, 'petal-05', 22, 0.36, 10.2, 1.0, 'track-a', false],
  ['a06', 12, 'petal-04', 36, 0.62, 8.2, 0.4, 'track-c', false],
  ['a07', 34, 'petal-02', 44, 0.72, 7.4, 1.8, 'track-a', false],
  ['a08', 44, 'petal-06', 50, 0.58, 8.8, 0.2, 'track-d', false],
  ['a09', 70, 'petal-03', 40, 0.68, 7.0, 2.6, 'track-b', false],
  ['a10', 1, 'petal-04', 130, 0.92, 6.2, 0.8, 'near-a', true],
  ['a11', 86, 'petal-01', 112, 0.90, 6.8, 1.6, 'near-b', true],
  ['a12', 84, 'petal-05', 96, 0.88, 5.8, 0.4, 'near-a', true]
];

const AMBIENT_LITE = ['a01', 'a04', 'a05', 'a07', 'a09', 'a10'];

function buildHero(burstAt, lite) {
  const keep = lite ? HERO_LITE : null;
  return HERO.filter((row) => !keep || keep.indexOf(row[0]) >= 0).map((row) => {
    const [id, shape, mirror, x, y, dx, dy, rot, size, opacity] = row;
    const box = sizeOf(shape, size);
    return {
      id,
      cls: 'hero-' + id.slice(1),
      image: '/assets/petals/' + shape + '-lit.png',
      mirror,
      style: 'animation-delay:' + burstAt + 'ms;',
      imgStyle:
        'width:' + box.width + 'rpx;height:' + box.height + 'rpx;opacity:' + opacity + ';'
    };
  });
}

function buildAmbient(ambientDelay, lite) {
  const keep = lite ? AMBIENT_LITE : null;
  return AMBIENT.filter((row) => !keep || keep.indexOf(row[0]) >= 0).map((row) => {
    const [id, left, shape, size, opacity, duration, stagger, track, near] = row;
    const box = sizeOf(shape, size);
    const suffix = near ? '-soft' : '-lit';
    const delay = (ambientDelay / 1000 + stagger).toFixed(1);
    return {
      id,
      cls: track,
      image: '/assets/petals/' + shape + suffix + '.png',
      style:
        'left:' + left + '%;width:' + box.width + 'rpx;height:' + box.height + 'rpx;' +
        'opacity:' + opacity + ';animation-duration:' + duration + 's;animation-delay:' + delay + 's;'
    };
  });
}

Component({
  properties: {
    // 主角花瓣数量；≤5 时视为降级，走 8 片编排
    count: { type: Number, value: 12 },
    // full | lite
    quality: { type: String, value: 'full' },
    // hero 开始散开的时刻（ms），与玫瑰淡出对齐
    burstAt: { type: Number, value: 1000 },
    // 环境层开始接管的时刻（ms）
    ambientDelay: { type: Number, value: 2000 }
  },

  data: {
    hero: [],
    ambient: [],
    paused: false
  },

  attached() {
    this.refresh();
  },

  observers: {
    'count, quality, burstAt, ambientDelay': function () {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const lite = this.data.quality === 'lite' || this.data.count <= 5;
      // attached 与 observers 都会触发，去重避免首次挂载多渲染一次
      const signature = [lite, this.data.burstAt, this.data.ambientDelay].join('|');
      if (this._signature === signature) {
        return;
      }
      this._signature = signature;
      this.setData({
        hero: buildHero(this.data.burstAt, lite),
        ambient: buildAmbient(this.data.ambientDelay, lite)
      });
    }
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