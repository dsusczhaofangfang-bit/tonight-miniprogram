"""欢迎页玫瑰素材预处理（开发辅助脚本，可重复执行）。

用法：
    python scripts/prepare_rose_assets.py

读取（原图，只读，绝不覆盖）：
    assets/_src/rose-main.png
    assets/_src/petals/petal-01.png ~ petal-06.png

输出（派生素材）：
    assets/rose/rose-main-lit.png      暗部提亮的摄影分级版
    assets/petals/petal-0X-lit.png     统一亮度档的花瓣
    assets/petals/petal-0X-soft.png    近景预模糊版（预乘 alpha 模糊，无黑边）
    docs/refs/grading-preview.png      原图/分级版在 #0B0A09 上的对照条

设计约束：
    1. 只写 *-lit / *-soft，源文件名保持不变；重复执行结果一致。
    2. 模糊必须在预乘 alpha 空间做，否则半透明边缘会吸黑，暗底上出现脏边。
    3. 分级目标：保留暗部（#0B0A09 上的黑场不能发灰），只抬中暗调，
       让花瓣纹理在近黑背景上可见。目标 p95 约 150（玫瑰）/ 130（花瓣）。
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 源图放在 assets/_src（不进小程序包），派生图放在 assets/rose、assets/petals（进包）
SRC_DIR = os.path.join(ROOT, "assets", "_src")
PETAL_SRC_DIR = os.path.join(SRC_DIR, "petals")
ROSE_DIR = os.path.join(ROOT, "assets", "rose")
PETAL_DIR = os.path.join(ROOT, "assets", "petals")
PREVIEW_DIR = os.path.join(ROOT, "docs", "refs")

BG = (0x0B, 0x0A, 0x09)
LATIN_FONT = r"C:\Windows\Fonts\georgia.ttf"

PETAL_NAMES = ["petal-%02d" % i for i in range(1, 7)]

# 分级曲线参数：y = x(1+a)/(1+ax)，再做高光软肩 + 轻微提饱和。
# 玫瑰是主体，目标更亮；花瓣统一到同一档，避免同 opacity 下深浅不一。
ROSE_CURVE_A = 4.2
ROSE_SAT = 1.05
ROSE_TARGET_P95 = 150.0
PETAL_CURVE_A = 4.6
PETAL_SAT = 1.04
PETAL_TARGET_P95 = 132.0
# 近景模糊半径 = 长边 * 该系数（约等于显示尺寸下 2.5 CSS px）
SOFT_RATIO = 0.028
# 花瓣落地尺寸上限：展示最大 140rpx = 70 CSS px，@3x 约 210px，256 留足余量。
# 主包上限 2MB，玫瑰 PNG 已占约 745KB，所以花瓣必须控制在这个量级。
PETAL_MAX_EDGE = 256
# 只有近景 3 片需要预模糊版，其余不生成，省包体。
SOFT_NAMES = ("petal-01", "petal-04", "petal-05")


def luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def curve(x, a):
    """x 为 0..255 的浮点；映射抬中暗调、压高光、保住纯黑点。"""
    t = x / 255.0
    y = t * (1.0 + a) / (1.0 + a * t)
    # 高光软肩：避免提亮后高光糊成一片死白
    y = y * (1.0 - 0.10 * np.clip(y, 0.0, 1.0) ** 4)
    return np.clip(y, 0.0, 1.0) * 255.0


def grade(arr, a, sat):
    """arr: HxWx4 float32 (RGBA 0..255)。只在 alpha>0 的区域分级。"""
    out = arr.copy()
    rgb = out[..., :3]
    lit = curve(rgb, a)
    # 以亮度为轴提饱和，避免直接乘通道造成色相偏移
    g = luma(lit)[..., None]
    lit = g + (lit - g) * sat
    out[..., :3] = np.clip(lit, 0.0, 255.0)
    return out


def fit_p95(arr, a, sat, target):
    """先套基础曲线，再用 gamma 微调，把不透明区 p95 拉到目标值。

    目的不是"变亮"，而是让六片花瓣在同 opacity 下有相同的存在感；
    同时保证高光不糊（输出会打印 clip>200 供核对）。
    """
    lit = grade(arr, a, sat)
    mask = arr[..., 3] > 200
    if not mask.any():
        return lit
    p95 = float(np.percentile(luma(lit[..., :3])[mask], 95))
    if p95 < 1.0:
        return lit
    gamma = math.log(target / 255.0) / math.log(p95 / 255.0)
    rgb = np.power(np.clip(lit[..., :3] / 255.0, 0.0, 1.0), gamma) * 255.0
    out = lit.copy()
    out[..., :3] = np.clip(rgb, 0.0, 255.0)
    return out


def bleed_edge(rgba, max_iterations=200):
    """把不透明区的颜色向外扩散到半透明/透明边缘。

    抠图素材的 alpha 过渡带里 RGB 往往不可信（混入了原背景，或多半是黑的）。
    提亮后这些像素会比本体更亮，在暗底上形成一圈光晕。
    这里用邻域平均逐层外扩，一直铺满整张图：半透明像素取最近的不透明颜色，
    透明像素的 RGB 也一并填满，这样 GPU 双线性采样时不会吸到黑色。
    alpha 通道完全不变。
    """
    arr = rgba.astype(np.float32).copy()
    alpha = arr[..., 3]
    rgb = arr[..., :3]
    filled = alpha > 250
    if not filled.any():
        return arr
    for _ in range(max_iterations):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(rgb, (dy, dx), (0, 1)) * np.roll(filled, (dy, dx), (0, 1))[..., None]
            cnt += np.roll(filled, (dy, dx), (0, 1))
        new = (~filled) & (cnt > 0)
        if not new.any():
            break
        rgb[new] = acc[new] / cnt[new][..., None]
        filled |= new
    arr[..., :3] = rgb
    return arr


def premultiply_resize(image, size):
    """在预乘 alpha 空间缩放，避免透明区颜色渗进边缘形成暗边。"""
    arr = np.asarray(image.convert("RGBA"), dtype=np.float32)
    alpha = arr[..., 3:4] / 255.0
    pm = np.concatenate([arr[..., :3] * alpha, arr[..., 3:4]], axis=-1)
    resized = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)
    r = np.asarray(resized, dtype=np.float32)
    a2 = np.clip(r[..., 3:4] / 255.0, 1e-4, 1.0)
    rgb = r[..., :3] / a2
    return Image.fromarray(
        np.clip(np.concatenate([rgb, r[..., 3:4]], axis=-1), 0, 255).astype(np.uint8),
        "RGBA",
    )


def premultiply_blur(image, radius):
    """在预乘 alpha 空间做高斯模糊，避免半透明边缘吸黑。"""
    arr = np.asarray(image.convert("RGBA"), dtype=np.float32)
    alpha = arr[..., 3:4] / 255.0
    pm = np.concatenate([arr[..., :3] * alpha, arr[..., 3:4]], axis=-1)
    pm_img = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), "RGBA")
    blurred = pm_img.filter(ImageFilter.GaussianBlur(radius))
    b = np.asarray(blurred, dtype=np.float32)
    a2 = np.clip(b[..., 3:4] / 255.0, 1e-4, 1.0)
    rgb = b[..., :3] / a2
    return Image.fromarray(
        np.clip(np.concatenate([rgb, b[..., 3:4]], axis=-1), 0, 255).astype(np.uint8),
        "RGBA",
    )


def measure(image, label):
    arr = np.asarray(image.convert("RGBA"), dtype=np.float32)
    alpha = arr[..., 3]
    mask = alpha > 200
    if not mask.any():
        return {"label": label}
    px = arr[mask][:, :3]
    lum = luma(px)
    return {
        "label": label,
        "mean": round(float(lum.mean()), 1),
        "p50": round(float(np.percentile(lum, 50)), 1),
        "p95": round(float(np.percentile(lum, 95)), 1),
        "p99": round(float(np.percentile(lum, 99)), 1),
        "clip200": round(float((lum > 200).mean() * 100), 2),
        "dark10": round(float((lum < 10).mean() * 100), 2),
    }


def normalisation(image):
    """按不透明外接框算尺寸归一化系数：让相同 size 声明对应相同视觉大小。"""
    arr = np.asarray(image.convert("RGBA"))
    ys, xs = np.where(arr[..., 3] > 12)
    h, w = arr.shape[:2]
    frac_w = (xs.max() - xs.min() + 1) / w
    frac_h = (ys.max() - ys.min() + 1) / h
    return round(1.0 / max(frac_w, frac_h), 3)


def label_font(size=22):
    try:
        return ImageFont.truetype(LATIN_FONT, size)
    except Exception:
        return ImageFont.load_default()


def build_preview(rose_src, rose_lit, petal_lits):
    """在原/分级两组素材铺到 #0B0A09 上，供人工核对。"""
    cell = 300
    pad = 24
    width = pad + (cell + pad) * 2
    height = pad + (cell + pad) + 40 + (cell // 2 + pad) * 2 + 52
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    big = label_font(24)
    small = label_font(18)

    def paste_dark(canvas, image, box_w, box_h, x, y):
        thumb = image.copy()
        thumb.thumbnail((box_w, box_h), Image.LANCZOS)
        canvas.paste(thumb, (x + (box_w - thumb.width) // 2, y + (box_h - thumb.height) // 2), thumb)

    # 第一行：玫瑰 原图 / 分级
    y0 = pad
    for index, (image, caption) in enumerate(((rose_src, "rose-main  ORIGINAL"), (rose_lit, "rose-main  GRADED"))):
        x = pad + index * (cell + pad)
        draw.rectangle([x, y0, x + cell, y0 + cell], outline=(40, 30, 26))
        paste_dark(sheet, image, cell, cell, x, y0)
        draw.text((x, y0 + cell + 6), caption, font=small, fill=(150, 136, 120))

    # 第二行：6 片花瓣 原图
    y1 = y0 + cell + 44
    pc = cell // 2
    for index, name in enumerate(PETAL_NAMES):
        x = pad + (index % 6) * (pc + 8)
        draw.rectangle([x, y1, x + pc, y1 + pc], outline=(40, 30, 26))
        src = Image.open(os.path.join(PETAL_SRC_DIR, name + ".png"))
        paste_dark(sheet, src, pc, pc, x, y1)
    draw.text((pad, y1 + pc + 4), "petals  ORIGINAL", font=small, fill=(150, 136, 120))

    # 第三行：6 片花瓣 分级
    y2 = y1 + pc + 34
    for index, image in enumerate(petal_lits):
        x = pad + (index % 6) * (pc + 8)
        draw.rectangle([x, y2, x + pc, y2 + pc], outline=(40, 30, 26))
        paste_dark(sheet, image, pc, pc, x, y2)
    draw.text((pad, y2 + pc + 4), "petals  GRADED (lit)", font=small, fill=(150, 136, 120))

    draw.text((pad, height - 30), "preview only - not shipped in miniprogram", font=small, fill=(90, 80, 70))
    out = os.path.join(PREVIEW_DIR, "grading-preview.png")
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sheet.save(out, "PNG", optimize=True)
    return out


def main():
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    report = []

    rose_path = os.path.join(SRC_DIR, "rose-main.png")
    rose = Image.open(rose_path).convert("RGBA")
    rose_lit_arr = fit_p95(np.asarray(rose, dtype=np.float32), ROSE_CURVE_A, ROSE_SAT, ROSE_TARGET_P95)
    rose_lit_arr = bleed_edge(rose_lit_arr)
    rose_lit = Image.fromarray(np.clip(rose_lit_arr, 0, 255).astype(np.uint8), "RGBA")
    rose_lit.save(os.path.join(ROSE_DIR, "rose-main-lit.png"), "PNG", optimize=True)
    report.append(measure(rose, "rose-main            src"))
    report.append(measure(rose_lit, "rose-main-lit        out"))

    petal_lits = []
    for name in PETAL_NAMES:
        src_path = os.path.join(PETAL_SRC_DIR, name + ".png")
        src = Image.open(src_path).convert("RGBA")
        lit_arr = fit_p95(np.asarray(src, dtype=np.float32), PETAL_CURVE_A, PETAL_SAT, PETAL_TARGET_P95)
        lit_arr = bleed_edge(lit_arr)
        lit = Image.fromarray(np.clip(lit_arr, 0, 255).astype(np.uint8), "RGBA")
        if max(lit.size) > PETAL_MAX_EDGE:
            ratio = PETAL_MAX_EDGE / max(lit.size)
            lit = premultiply_resize(lit, (round(lit.width * ratio), round(lit.height * ratio)))
        lit.save(os.path.join(PETAL_DIR, name + "-lit.png"), "PNG", optimize=True)

        radius = round(max(lit.size) * SOFT_RATIO, 2)
        if name in SOFT_NAMES:
            soft = premultiply_blur(lit, radius)
            soft.save(os.path.join(PETAL_DIR, name + "-soft.png"), "PNG", optimize=True)

        petal_lits.append(lit)
        report.append(measure(src, name + "               src"))
        report.append(measure(lit, name + "-lit           out"))

    preview = build_preview(rose, rose_lit, petal_lits)

    print("%-26s %6s %6s %6s %6s %8s %8s" % ("asset", "mean", "p50", "p95", "p99", "clip>200", "dark<10"))
    for row in report:
        if "mean" not in row:
            continue
        print("%-26s %6.1f %6.1f %6.1f %6.1f %7.2f%% %7.2f%%" % (
            row["label"], row["mean"], row["p50"], row["p95"], row["p99"], row["clip200"], row["dark10"]))

    print("\n尺寸归一化系数（size 声明 × k = 实际画布边长）:")
    for name in PETAL_NAMES:
        src = Image.open(os.path.join(PETAL_SRC_DIR, name + ".png"))
        print("  %s  k=%.3f  canvas=%s" % (name, normalisation(src), src.size))

    print("\npreview:", os.path.relpath(preview, ROOT))


if __name__ == "__main__":
    main()