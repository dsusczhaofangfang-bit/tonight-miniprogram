"""生成 tabBar 占位图标（开发辅助脚本，可重复执行）。

用法：
    python scripts/gen_icons.py

输出：
    assets/icons/tab-home.png / tab-home-active.png
    assets/icons/tab-menu.png / tab-menu-active.png
    assets/icons/tab-my.png   / tab-my-active.png

说明：
    图标为占位素材，线性风格，81x81 透明 PNG。
    后续替换品牌图标时，保持文件名不变即可，无需改代码。
"""

import os

from PIL import Image, ImageDraw

SIZE = 81
SCALE = 4  # 超采样倍数，缩小后获得平滑边缘
STROKE = 5

COLOR_INACTIVE = (160, 143, 126, 255)  # #A08F7E
COLOR_ACTIVE = (217, 164, 91, 255)     # #D9A45B

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, "assets", "icons")


def new_canvas():
    return Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))


def dot(draw, point, color):
    """线端补圆点，模拟圆角端点。"""
    x, y = point
    r = STROKE * SCALE / 2.0
    draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def polyline(draw, points, color):
    scaled = [(x * SCALE, y * SCALE) for x, y in points]
    draw.line(scaled, fill=color, width=STROKE * SCALE, joint="curve")
    dot(draw, scaled[0], color)
    dot(draw, scaled[-1], color)


def draw_home(draw, color):
    # 屋顶
    polyline(draw, [(13, 39), (40.5, 14), (68, 39)], color)
    # 墙体
    polyline(draw, [(19, 37), (19, 66), (62, 66), (62, 37)], color)
    # 门
    polyline(draw, [(33, 66), (33, 49), (48, 49), (48, 66)], color)


def draw_menu(draw, color):
    # 马天尼杯杯身
    polyline(draw, [(20, 18), (61, 18), (40.5, 47), (20, 18)], color)
    # 杯茎
    polyline(draw, [(40.5, 47), (40.5, 64)], color)
    # 杯底
    polyline(draw, [(27, 66), (54, 66)], color)


def draw_my(draw, color):
    # 头部
    head = [30.5 * SCALE, 15 * SCALE, 50.5 * SCALE, 35 * SCALE]
    draw.ellipse(head, outline=color, width=STROKE * SCALE)
    # 肩部（半圆拱 + 底边）
    bbox = [17 * SCALE, 47 * SCALE, 64 * SCALE, 75 * SCALE]
    draw.arc(bbox, 180, 360, fill=color, width=STROKE * SCALE)
    polyline(draw, [(17, 61), (64, 61)], color)


ICONS = {
    "tab-home": draw_home,
    "tab-menu": draw_menu,
    "tab-my": draw_my,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, painter in ICONS.items():
        for suffix, color in (("", COLOR_INACTIVE), ("-active", COLOR_ACTIVE)):
            canvas = new_canvas()
            painter(ImageDraw.Draw(canvas), color)
            icon = canvas.resize((SIZE, SIZE), Image.LANCZOS)
            path = os.path.join(OUT_DIR, f"{name}{suffix}.png")
            icon.save(path)
            print("generated:", path)


if __name__ == "__main__":
    main()