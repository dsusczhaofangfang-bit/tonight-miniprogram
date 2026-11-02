"""欢迎页字体构建（开发辅助，不进包）。

做四件事：
  1. 读取页面实际文案，逐字判断八公明朝有没有字形；
  2. 有字形的 → 子集化八公明朝，只保留用到的字符（不改原字体文件）；
  3. 没字形的 → 用思源宋体 SC（Noto Serif SC，同为 OFL、同为思源宋体体系）
     按八公明朝的字重实例化后子集化，只保留缺字；
  4. 两个子集转 base64 写进 styles/font-hakkou.wxss，并打印每个字的来源。

用法：
    python scripts/build_font.py

依赖：fontTools（本机装在 .pylib/py，脚本会自动挂上）。
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
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HAKKOU_SRC = os.path.join(ROOT, "HakkouMincho-v1.004", "HakkouMincho.ttf")
NOTO_SRC = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
OUT_DIR = os.path.join(ROOT, "assets", "_src", "fonts")
WXSS_OUT = os.path.join(ROOT, "styles", "font-hakkou.wxss")
WXML = os.path.join(ROOT, "pages", "welcome", "welcome.wxml")

# 除页面文案外，额外保留数字与常用标点（英文/数字/空格/标点要求）
ASCII_EXTRA = " ".join(["0123456789", ".,:;!?'\"()[]/-&+%#@*"])


def page_text():
    """从 welcome.wxml 里抽出可见文案字符。"""
    src = open(WXML, encoding="utf-8").read()
    body = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    body = re.sub(r"<[^>]+>", "\n", body)          # 去标签
    body = body.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    chars = "".join(ch for ch in body if ch.strip())
    return "".join(dict.fromkeys(chars))


def subset_to(src_path, chars, out_path, drop_variations=False):
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
    font.save(out_path)
    font.close()
    return out_path


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    text = page_text()
    ascii_set = "".join(c for c in ASCII_EXTRA if c not in text)
    print("页面文案字符数: %d" % len(text))

    hakkou = TTFont(HAKKOU_SRC)
    hakkou_cmap = hakkou.getBestCmap()
    weight = hakkou["OS/2"].usWeightClass
    print("八公明朝 usWeightClass = %d" % weight)

    have = [c for c in text if ord(c) in hakkou_cmap]
    miss = [c for c in text if ord(c) not in hakkou_cmap]
    ascii_have = [c for c in ascii_set if ord(c) in hakkou_cmap]
    ascii_miss = [c for c in ascii_set if ord(c) not in hakkou_cmap]

    print("八公明朝有字形: %d 个；缺字 %d 个: %s" % (len(have), len(miss), "".join(miss) or "无"))
    if ascii_miss:
        print("可打印 ASCII 中八公明朝缺: %s" % "".join(ascii_miss))

    # 1) 八公明朝子集（只放有字形的字符）
    hakkou_out = os.path.join(OUT_DIR, "hakkou-welcome-subset.ttf")
    subset_to(HAKKOU_SRC, "".join(have + ascii_have), hakkou_out)
    print("八公明朝子集: %d 字节 (%.1f KB)" % (os.path.getsize(hakkou_out), os.path.getsize(hakkou_out) / 1024))

    # 2) 备用字体：先在完整 VF 上子集化，再实例化到同一字重（快很多）
    noto_out = os.path.join(OUT_DIR, "noto-sc-fallback-subset.ttf")
    if miss:
        vf_out = os.path.join(OUT_DIR, "_noto-vf-subset.ttf")
        subset_to(NOTO_SRC, "".join(miss), vf_out)
        vf = TTFont(vf_out)
        inst = instantiateVariableFont(vf, {"wght": weight}, inplace=True, updateFontNames=False)
        inst.save(noto_out)
        inst.close()
        vf.close()
        os.remove(vf_out)
        print("备用字体子集: %d 字节 (%.1f KB)" % (os.path.getsize(noto_out), os.path.getsize(noto_out) / 1024))
    else:
        noto_out = None
        print("无缺字，不需要备用字体")

    # 3) 校验：重新打开子集，确认覆盖与名称
    check = TTFont(hakkou_out)
    ccmap = check.getBestCmap()
    lost = [c for c in have if ord(c) not in ccmap]
    fam = [r.toUnicode() for r in check["name"].names if r.nameID in (1, 16)]
    lic = [r.toUnicode() for r in check["name"].names if r.nameID == 13]
    print("子集校验: 丢失字形 %s | nameID1/16=%s" % (lost or "无", fam[:2]))
    print("授权信息保留: %s" % (lic[0][:60] + "..." if lic else "缺失"))
    check.close()

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
        "   两者均为 SIL OFL 1.1。 */\n\n" % (len(miss), "".join(miss) or "无")
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