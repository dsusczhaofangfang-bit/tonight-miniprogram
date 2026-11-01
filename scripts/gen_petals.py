"""生成欢迎页玫瑰花瓣占位素材（开发辅助脚本，可重复执行）。

用法：
    python scripts/gen_petals.py

输出：
    assets/petals/petal-01.png ~ petal-04.png

说明：
    1. 4 种形态，128x128 RGBA 透明底，显示尺寸由 WXSS 控制在 18–48rpx。
    2. 素材为占位玫瑰花瓣，不含文字、Logo、印章或水印；
       后续有真实素材时，保持文件名不变直接替换即可，不需要改页面代码。
    3. 只使用 Pillow，不依赖网络；重复执行会覆盖同名文件。
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter


SIZE = 128
SCALE = 4
CANVAS = SIZE * SCALE
OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets",
    "petals",
)


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def mix(color_a, color_b, t):
    return tuple(lerp(color_a[i], color_b[i], t) for i in range(3))


def gradient_stops(t, stops):
    """在一组 (位置, RGB) 停靠点之间做线性插值。"""
    if t <= stops[0][0]:
        return stops[0][1]
    for index in range(1, len(stops)):
        left_pos, left_color = stops[index - 1]
        right_pos, right_color = stops[index]
        if t <= right_pos:
            local = (t - left_pos) / (right_pos - left_pos)
            return mix(left_color, right_color, local)
    return stops[-1][1]


def make_gradient():
    """上浅下深的玫瑰色竖向渐变，底部接近酒红。"""
    stops = [
        (0.0, (198, 86, 107)),
        (0.45, (163, 43, 65)),
        (1.0, (112, 27, 43)),
    ]
    column = Image.new("RGB", (1, CANVAS))
    pixels = column.load()
    for y in range(CANVAS):
        pixels[0, y] = gradient_stops(y / (CANVAS - 1), stops)
    return column.resize((CANVAS, CANVAS), Image.BILINEAR).convert("RGBA")


def petal_outline(config):
    """用逐层宽度生成柔和的单瓣轮廓，返回多边形顶点。"""
    width = config["width"] * CANVAS
    power = config["power"]
    lean = config["lean"] * CANVAS
    asym = config["asym"]
    phase = config["phase"]

    left_points = []
    right_points = []
    steps = 180

    for index in range(steps + 1):
        t = index / steps
        # 两端收窄、中段饱满；power 越小，顶部越圆润。
        width_at_t = math.sin(math.pi * t) ** power
        # 花瓣根部收成窄柄，避免像一片叶子直接贴在画布底边。
        base_taper = min(1.0, t / 0.18)
        edge_ripple = 1.0 + 0.018 * math.sin(2 * math.pi * 3 * t + phase)
        half = width * width_at_t * base_taper * edge_ripple

        center = lean * math.sin(math.pi * t) * (1.0 - 0.25 * t)
        center += asym * width * 0.55 * math.sin(math.pi * t) * (0.5 - t)

        y = CANVAS * 0.5 - (t - 0.5) * CANVAS * 0.92
        left = CANVAS * 0.5 + center - half * (1.0 + asym * 0.35)
        right = CANVAS * 0.5 + center + half * (1.0 - asym * 0.35)
        left_points.append((left, y))
        right_points.append((right, y))

    points = left_points + list(reversed(right_points))
    return [(int(round(x)), int(round(y))) for x, y in points]


def build_petal(config):
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    points = petal_outline(config)

    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(SCALE * 0.65))

    body = make_gradient()

    # 上段柔光：让花瓣有一点透光感，而不是纯色块。
    highlight = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(highlight)
    cx, cy = CANVAS * 0.45, CANVAS * 0.38
    rx, ry = CANVAS * 0.30, CANVAS * 0.24
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(224, 128, 146, 58))
    highlight = highlight.filter(ImageFilter.GaussianBlur(CANVAS * 0.055))
    body = Image.alpha_composite(body, highlight)

    # 极淡的脉络，只在近看时成立，缩小后不会形成脏线。
    veins = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    vein_draw = ImageDraw.Draw(veins)
    for offset, alpha in ((-0.13, 38), (0.02, 48), (0.16, 34)):
        start = (CANVAS * (0.5 + offset), CANVAS * 0.88)
        control = (CANVAS * (0.5 + offset * 1.8), CANVAS * 0.54)
        end = (CANVAS * (0.5 + offset * 0.55), CANVAS * 0.16)
        path = []
        for step in range(41):
            t = step / 40
            x = (
                (1 - t) * (1 - t) * start[0]
                + 2 * (1 - t) * t * control[0]
                + t * t * end[0]
            )
            y = (
                (1 - t) * (1 - t) * start[1]
                + 2 * (1 - t) * t * control[1]
                + t * t * end[1]
            )
            path.append((x, y))
        vein_draw.line(path, fill=(92, 20, 35, alpha), width=SCALE * 2)
    veins = veins.filter(ImageFilter.GaussianBlur(SCALE * 0.8))
    body = Image.alpha_composite(body, veins)

    # 边缘压暗一圈，增加花瓣的厚度。
    edge = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(edge).line(
        points + [points[0]],
        fill=(88, 18, 32, 58),
        width=SCALE * 3,
        joint="curve",
    )
    edge = edge.filter(ImageFilter.GaussianBlur(SCALE * 1.1))
    body = Image.alpha_composite(body, edge)

    body.putalpha(mask)

    if config["angle"]:
        body = body.rotate(
            config["angle"],
            resample=Image.BICUBIC,
            expand=False,
        )

    return body.resize((SIZE, SIZE), Image.LANCZOS)


PETALS = (
    {
        "name": "petal-01",
        "width": 0.34,
        "power": 0.38,
        "lean": 0.00,
        "asym": 0.00,
        "phase": 0.0,
        "angle": 8,
    },
    {
        "name": "petal-02",
        "width": 0.23,
        "power": 0.62,
        "lean": 0.02,
        "asym": 0.06,
        "phase": 1.7,
        "angle": -14,
    },
    {
        "name": "petal-03",
        "width": 0.30,
        "power": 0.46,
        "lean": 0.09,
        "asym": 0.14,
        "phase": 3.1,
        "angle": 22,
    },
    {
        "name": "petal-04",
        "width": 0.28,
        "power": 0.32,
        "lean": -0.04,
        "asym": -0.10,
        "phase": 4.4,
        "angle": -5,
    },
)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for config in PETALS:
        image = build_petal(config)
        path = os.path.join(OUT_DIR, f"{config['name']}.png")
        image.save(path, "PNG", optimize=True)
        print("generated:", path)


if __name__ == "__main__":
    main()