"""欢迎页字体构建（开发辅助，不进包）。

做五件事：
  1. 读取页面实际文案，逐字判断八公明朝有没有字形；
  2. 有字形的 → 子集化八公明朝，只保留用到的字符（原始文件不改）；
  3. 没字形的 → 用思源宋体 SC（Noto Serif SC，同为 OFL、同为思源宋体体系）
     补，并**把它的字面压成八公明朝的窄字面**（这是本页混排不出戏的关键）；
  4. 两个子集转 base64 写进 styles/font-hakkou.wxss，打印每个字的来源；
  5. 校验字宽是否真的对齐。

为什么要压字面：
    八公明朝是窄体，中文前进宽度 650/1000 em；思源宋体 SC 是标准全角 1000/1000。
    同一字号下，思源的字会宽出 1.54 倍，混在八公明朝里"柠""进"会明显大一圈。
    压缩只作用于我们自己生成的子集，原件不动。

字重为什么是 630：
    横向压缩会把竖笔画一起压细。经实测（440px 渲染、横向墨色游程中位数）：
      八公明朝 27.0px / 思源 wght600 压缩后 25.0 / wght630 压缩后 27.0 / wght650 后 28.0
    所以取 630，压缩后笔画粗细与八公明朝一致。

用法：
    python scripts/build_font.py
    python scripts/verify_font.py

依赖：fontTools（本机装在 .pylib/py，脚本自动挂上）。
原始字体：HakkouMincho-v1.004/HakkouMincho.ttf（7.4 MB，不入库，见 docs/08）
备用字体：C:\\Windows\\Fonts\\NotoSerifSC-VF.ttf（OFL）
"""

import base64
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".pylib", "py"))

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HAKKOU_SRC = os.path.join(ROOT, "HakkouMincho-v1.004", "HakkouMincho.ttf")
NOTO_SRC = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
OUT_DIR = os.path.join(ROOT, "assets", "_src", "fonts")
WXSS_OUT = os.path.join(ROOT, "styles", "font-hakkou.wxss")
WXML = os.path.join(ROOT, "pages", "welcome", "welcome.wxml")

# 除页面文案外，额外保留数字与常用标点（英文/数字/空格/标点要求）
ASCII_EXTRA = " ".join(["0123456789", ".,:;!?'\"()[]/-&+%#@*"])

# 备用字体实例化的字重：使横向压缩后的笔画粗细与八公明朝一致（见文件头说明）
FALLBACK_WEIGHT = 630
FALLBACK_FAMILY = "HakkouFallbackSC"


def page_text():
    """从 welcome.wxml 里抽出可见文案字符。"""
    src = open(WXML, encoding="utf-8").read()
    body = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    body = re.sub(r"<[^>]+>", "\n", body)          # 去标签
    body = body.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    chars = "".join(ch for ch in body if ch.strip())
    return "".join(dict.fromkeys(chars))


def subset_font(src_path, chars):
    opts = subset.Options()
    opts.name_IDs = ["*"]          # 保留 Family Name 与授权信息
    opts.name_legacy = True
    opts.name_languages = ["*"]
    opts.layout_features = ["*"]
    opts.drop_tables = []
    opts.glyph_names = False
    opts.hinting = True
    font = subset.load_font(src_path, opts)
    s = subset.Subsetter(options=opts)
    s.populate(text=chars)
    s.subset(font)
    return font


def is_cjk(ch):
    o = ord(ch)
    return 0x3400 <= o <= 0x4DBF or 0x4E00 <= o <= 0x9FFF


def cjk_advance(font, chars):
    """页面里中文字符的前进宽度中位数（八公明朝是 650）。

    只统计 CJK 汉字，拉丁字母宽度完全不同，混进去会把中位数拉偏。
    """
    cmap = font.getBestCmap()
    advs = sorted(font["hmtx"][cmap[ord(c)]][0] for c in chars if ord(c) in cmap and is_cjk(c))
    return advs[len(advs) // 2]


def conform_to(font, chars, target_adv, family):
    """把字面横向压到目标字宽，并改名（这是修改后的派生字体，需区别于原字体）。"""
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()

    src_advs = sorted(hmtx[cmap[ord(c)]][0] for c in chars)
    src_adv = src_advs[len(src_advs) // 2]
    sx = target_adv / src_adv

    for ch in chars:
        name = cmap[ord(ch)]
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(TransformPen(pen, (sx, 0, 0, 1, 0, 0)))
        new = pen.glyph()
        new.recalcBounds(glyf)
        glyf[name] = new
        hmtx[name] = (target_adv, new.xMin)

    for rec in font["name"].names:
        if rec.nameID in (1, 4, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = "Regular"
        elif rec.nameID == 6:
            rec.string = family + "-Regular"
    return sx


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    text = page_text()
    ascii_set = "".join(c for c in ASCII_EXTRA if c not in text)
    print("页面文案字符数: %d" % len(text))

    hakkou = TTFont(HAKKOU_SRC)
    hakkou_cmap = hakkou.getBestCmap()

    have = [c for c in text if ord(c) in hakkou_cmap]
    miss = [c for c in text if ord(c) not in hakkou_cmap]
    ascii_have = [c for c in ascii_set if ord(c) in hakkou_cmap]
    ascii_miss = [c for c in ascii_set if ord(c) not in hakkou_cmap]

    print("八公明朝有字形: %d 个；缺字 %d 个: %s" % (len(have), len(miss), "".join(miss) or "无"))
    if ascii_miss:
        print("可打印 ASCII 中八公明朝缺: %s" % "".join(ascii_miss))

    target_adv = cjk_advance(hakkou, have)
    print("八公明朝中文字宽 = %d/1000 em" % target_adv)

    # 1) 八公明朝子集（只放有字形的字符）
    hakkou_out = os.path.join(OUT_DIR, "hakkou-welcome-subset.ttf")
    font = subset_font(HAKKOU_SRC, "".join(have + ascii_have))
    font.save(hakkou_out)
    font.close()
    print("八公明朝子集: %d 字节 (%.1f KB)" % (os.path.getsize(hakkou_out), os.path.getsize(hakkou_out) / 1024))

    # 2) 备用字体：子集 → 实例化到匹配字重 → 压成窄字面 → 改名
    noto_out = os.path.join(OUT_DIR, "noto-sc-fallback-subset.ttf")
    if miss:
        fb = subset_font(NOTO_SRC, "".join(miss))
        fb = instantiateVariableFont(fb, {"wght": FALLBACK_WEIGHT}, inplace=True, updateFontNames=False)
        sx = conform_to(fb, miss, target_adv, FALLBACK_FAMILY)
        fb.save(noto_out)
        fb.close()
        print("备用字体子集: %d 字节 (%.1f KB)，横向压缩系数 %.3f（字重 %d）" % (
            os.path.getsize(noto_out), os.path.getsize(noto_out) / 1024, sx, FALLBACK_WEIGHT))
    else:
        noto_out = None
        print("无缺字，不需要备用字体")

    # 3) 校验：重新打开子集，确认覆盖、字宽与名称
    check = TTFont(hakkou_out)
    ccmap = check.getBestCmap()
    lost = [c for c in have if ord(c) not in ccmap]
    fam = [r.toUnicode() for r in check["name"].names if r.nameID in (1, 16)]
    lic = [r.toUnicode() for r in check["name"].names if r.nameID == 13]
    print("八公校验: 丢失字形 %s | nameID1/16=%s" % (lost or "无", fam[:2]))
    print("授权信息保留: %s" % (lic[0][:60] + "..." if lic else "缺失"))
    check.close()

    if noto_out:
        chk = TTFont(noto_out)
        advs = sorted({chk["hmtx"][chk.getBestCmap()[ord(c)]][0] for c in miss})
        fbfam = [r.toUnicode() for r in chk["name"].names if r.nameID == 1]
        fblic = [r.toUnicode() for r in chk["name"].names if r.nameID == 13]
        print("备用校验: 字宽=%s (目标 %d) | 字体名=%s | 授权保留=%s" % (
            advs, target_adv, fbfam[:1], bool(fblic)))
        chk.close()

    # 4) 生成 wxss
    def b64(path):
        return base64.b64encode(open(path, "rb").read()).decode("ascii")

    blocks = [
        "@font-face {\n"
        '  font-family: "HakkouMincho";\n'
        '  src: url("data:font/ttf;base64,%s") format("truetype");\n'
        "  font-weight: normal;\n"
        "  font-style: normal;\n"
        "}" % b64(hakkou_out)
    ]
    if noto_out:
        blocks.append(
            "@font-face {\n"
            '  font-family: "HakkouFallbackSC";\n'
            '  src: url("data:font/ttf;base64,%s") format("truetype");\n'
            "  font-weight: normal;\n"
            "  font-style: normal;\n"
            "}" % b64(noto_out)
        )

    header = (
        "/* 由 scripts/build_font.py 生成，不要手改。\n"
        "   HakkouMincho：八公明朝子集，只含欢迎页用到的字符（原始 7.4 MB，未修改）。\n"
        "   HakkouFallbackSC：思源宋体 SC 子集，只补八公明朝缺的 %d 个字：%s\n"
        "   该子集已按八公明朝的字宽压缩（目标 %d/1000 em）、字重 %d，\n"
        "   目的是让缺字与全页字面宽度、笔画粗细一致。\n"
        "   两者均为 SIL OFL 1.1。 */\n\n" % (len(miss), "".join(miss) or "无", target_adv, FALLBACK_WEIGHT)
    )
    with open(WXSS_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + "\n\n".join(blocks) + "\n")
    print("已写入 %s (%.1f KB)" % (os.path.relpath(WXSS_OUT, ROOT), os.path.getsize(WXSS_OUT) / 1024))

    # 5) 逐字来源表
    print("\n字符来源（八公=八公明朝 / 思源=备用宋体）:")
    for c in text:
        print("  %-6s U+%04X  %s" % (ascii(c)[1:-1], ord(c), "八公" if ord(c) in ccmap else "思源"))
    mixed = [c for c in text if ord(c) not in ccmap]
    print("\n混排位置(ascii): %s" % ascii("".join(mixed)))
    print("混排字数: %d / %d" % (len(mixed), len(text)))


if __name__ == "__main__":
    main()