"""欢迎页字体验收（开发辅助，不进包）。

不依赖肉眼看图，用三项可判定的检查：
  1. base64 回解后与 .ttf 是否逐字节一致；
  2. 每个文案字符由哪个字体提供（查 cmap）；
  3. 用 Pillow 实际渲染每个字符，与其 .notdef（私用区字符）比对——
     完全相同说明是缺字豆腐块，不同说明真有字形。

用法：python scripts/verify_font.py
"""

import base64
import hashlib
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".pylib", "py"))

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "assets", "_src", "fonts")
WXSS = os.path.join(ROOT, "styles", "font-hakkou.wxss")
WXML = os.path.join(ROOT, "pages", "welcome", "welcome.wxml")

HAKKOU = os.path.join(FONT_DIR, "hakkou-welcome-subset.ttf")
NOTO = os.path.join(FONT_DIR, "noto-sc-fallback-subset.ttf")

errors = []


def page_text():
    src = open(WXML, encoding="utf-8").read()
    body = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    body = re.sub(r"<[^>]+>", "\n", body)
    body = body.replace("&amp;", "&")
    return "".join(dict.fromkeys(ch for ch in body if ch.strip()))


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def bitmap(path, ch, size=72):
    f = ImageFont.truetype(path, size)
    img = Image.new("L", (size * 2, size * 2), 0)
    ImageDraw.Draw(img).text((size // 3, size // 3), ch, fill=255, font=f)
    return img


def ink(img):
    return sum(1 for p in img.getdata() if p > 8)


def main():
    # 1. base64 与文件一致性
    css = open(WXSS, encoding="utf-8").read()
    blobs = re.findall(r"base64,([A-Za-z0-9+/=]+)", css)
    print("=== 1. 内嵌数据校验 ===")
    print("wxss 中的 @font-face 数量: %d" % css.count("@font-face"))
    if len(blobs) < 1:
        errors.append("wxss 里没有 base64 数据")
    for i, blob in enumerate(blobs):
        raw = base64.b64decode(blob)
        target = HAKKOU if i == 0 else NOTO
        same = hashlib.sha256(raw).hexdigest() == sha(target)
        print("  块%d: %d 字节, 与 %s 一致: %s" % (i + 1, len(raw), os.path.basename(target), same))
        if not same:
            errors.append("块%d 与 %s 不一致" % (i + 1, os.path.basename(target)))

    # 2. 覆盖表
    hc = TTFont(HAKKOU).getBestCmap()
    nc = TTFont(NOTO).getBestCmap() if os.path.exists(NOTO) else {}
    text = page_text()
    print("\n=== 2. 逐字来源（cmap）===")
    src_map = {}
    for ch in text:
        src_map[ch] = "八公" if ord(ch) in hc else ("思源" if ord(ch) in nc else "无")
        if src_map[ch] == "无":
            errors.append("字符 %s 两个字体都没有" % ascii(ch))
    mixed = [c for c in text if src_map[c] == "思源"]
    print("  八公明朝: %d 字 | 备用宋体: %d 字 %s" % (
        len([c for c in text if src_map[c] == "八公"]), len(mixed), ascii("".join(mixed))))

    # 3. 渲染校验：与 .notdef 比对
    print("\n=== 3. 渲染校验（豆腐块检测）===")
    tofu_h = bitmap(HAKKOU, "\ue000")
    tofu_n = bitmap(NOTO, "\ue000") if nc else None
    bad = []
    for ch in text:
        if ch == " ":
            continue
        provider = src_map[ch]
        path = HAKKOU if provider == "八公" else NOTO
        ref = tofu_h if provider == "八公" else tofu_n
        img = bitmap(path, ch)
        is_tofu = img.tobytes() == ref.tobytes() or ink(img) == 0
        if is_tofu:
            bad.append(ch)
            errors.append("%s(%s) 渲染成了豆腐块" % (ascii(ch), provider))
        print("  %-6s U+%04X  %-4s 墨量 %4d  %s" % (
            ascii(ch)[1:-1], ord(ch), provider, ink(img), "缺字!" if is_tofu else "ok"))
    if not bad:
        print("  全部字符都有真实字形，无豆腐块")

    # 4. 缺字在八公明朝里确实是豆腐（证明混排是必要的）
    print("\n=== 4. 备用字体的必要性 ===")
    for ch in mixed:
        h_img = bitmap(HAKKOU, ch)
        n_img = bitmap(NOTO, ch)
        h_tofu = h_img.tobytes() == tofu_h.tobytes()
        print("  %-6s 八公明朝渲染: %s | 备用宋体: %s" % (
            ascii(ch)[1:-1], "豆腐块" if h_tofu else "有字形", "有字形" if ink(n_img) else "空白"))
        if not h_tofu:
            errors.append("%s 在八公明朝里竟然有字形，与 cmap 判断矛盾" % ascii(ch))

    # 5. 字面一致性：备用字体的字宽/字面尺寸/笔画粗细必须与八公明朝对齐
    print("\n=== 5. 混排字面一致性 ===")
    hfont = TTFont(HAKKOU)
    nfont = TTFont(NOTO)
    hc2 = hfont.getBestCmap()
    cjk = [c for c in text if 0x4E00 <= ord(c) <= 0x9FFF and ord(c) in hc2]
    h_adv = sorted({hfont["hmtx"][hc2[ord(c)]][0] for c in cjk})
    print("  八公明朝中文字宽: %s" % h_adv)

    def bbox_ratio(path, ch, size=200):
        img = bitmap(path, ch, size)
        px = img.load()
        w, h = img.size
        x0, y0, x1, y1 = w, h, -1, -1
        runs = []
        for y in range(h):
            run = 0
            for x in range(w):
                if px[x, y] > 128:
                    run += 1
                    x0, y0 = min(x0, x), min(y0, y)
                    x1, y1 = max(x1, x), max(y1, y)
                elif run:
                    runs.append(run)
                    run = 0
            if run:
                runs.append(run)
        runs.sort()
        bw = (x1 - x0 + 1) if x1 >= x0 else 1
        bh = (y1 - y0 + 1) if y1 >= y0 else 1
        return bw / bh, (runs[len(runs) // 2] if runs else 0)

    ref = [bbox_ratio(HAKKOU, c) for c in cjk]
    ref_wh = sorted(r[0] for r in ref)[len(ref) // 2]
    ref_run = sorted(r[1] for r in ref)[len(ref) // 2]
    print("  八公明朝参考: 宽高比 %.3f / 竖笔中位 %d" % (ref_wh, ref_run))
    for ch in mixed:
        wh, run = bbox_ratio(NOTO, ch)
        adv = nfont["hmtx"][nfont.getBestCmap()[ord(ch)]][0]
        ok_adv = adv in h_adv
        ok_wh = abs(wh - ref_wh) <= 0.06
        ok_run = abs(run - ref_run) <= max(2, ref_run * 0.12)
        print("  %-6s 字宽 %d %s | 宽高比 %.3f %s | 竖笔 %d %s" % (
            ascii(ch)[1:-1], adv, "ok" if ok_adv else "!!", wh, "ok" if ok_wh else "!!",
            run, "ok" if ok_run else "!!"))
        if not ok_adv:
            errors.append("%s 字宽 %d 与八公明朝 %s 不一致" % (ascii(ch), adv, h_adv))
        if not ok_wh:
            errors.append("%s 字面宽高比 %.3f 偏离 %.3f" % (ascii(ch), wh, ref_wh))
        if not ok_run:
            errors.append("%s 笔画粗细 %d 偏离 %d" % (ascii(ch), run, ref_run))

    print("\n" + ("全部通过" if not errors else "未通过: " + "; ".join(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())