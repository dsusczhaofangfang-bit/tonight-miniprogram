# 第三方组件与素材声明

本项目（源代码与文档）以 [Apache License 2.0](LICENSE) 授权发布。
但下列**字体与素材**各自遵循其原始授权，不受 Apache-2.0 覆盖。

## 1. 字体

### 1.1 八公明朝（HakkouMincho）v1.004

| 项目 | 内容 |
| --- | --- |
| 用途 | 欢迎页中文正文与英文副标题 |
| 来源 | zfont.cn（原始发行包内的 `更多免费可商用字体.url`） |
| 版权 | 基于思源宋体（Source Han Serif）体系改刻，© 2017–2024 Adobe 及改刻作者 |
| 授权 | SIL Open Font License 1.1（全文见本文件第 3 节） |
| 是否入库 | **否**。原始文件 7.4 MB，`.gitignore` 已排除；需要用 `scripts/build_font.py` 重新子集化时请自行从发行方获取 |

### 1.2 思源宋体 SC（Source Han Serif SC）子集

| 项目 | 内容 |
| --- | --- |
| 用途 | 为八公明朝缺失的 6 个简体字（过、样、欢、进、馆 等）补字 |
| 版权 | © 2017–2024 Adobe |
| 授权 | SIL Open Font License 1.1 |
| 处理 | 取 43 字子集，按八公明朝字宽（650/1000）横向压缩、笔画粗细对齐；派生字体按 OFL 第 3 条**重命名为 `HakkouFallbackSC`**，保留版权与授权元数据 |

### 1.3 仓库中的字体产物

以下文件是上述字体的**子集 / 派生版本**，按 OFL 1.1 随本项目一同分发：

| 文件 | 说明 |
| --- | --- |
| `styles/font-hakkou.wxss` | 两个字体子集以 base64 内嵌（由 `scripts/build_font.py` 生成，请勿手改） |
| `assets/_src/fonts/hakkou-welcome-subset.ttf` | 八公明朝 43 字子集源文件 |
| `assets/_src/fonts/noto-sc-fallback-subset.ttf` | 思源宋体补字子集源文件 |

> OFL 要求：再分发时须保留版权声明与本授权文本（即本文件）；不得单独售卖字体；派生字体不得使用保留字体名（Reserved Font Name）。本项目已按此执行。

## 2. 其他素材

| 素材 | 来源 | 说明 |
| --- | --- | --- |
| `assets/icons/tab-*.png` | 本项目 `scripts/gen_icons.py` 生成 | 纯几何图形，随项目授权 |
| `assets/sounds/order-alert.wav` | 本项目 `scripts/gen_sound.py` 生成 | 程序合成的提示音，随项目授权 |
| `assets/_src/rose-main.png`、`assets/_src/petals/*`、`assets/rose/`、`assets/petals/` | 仓库维护者提供 / 生成 | **玫瑰相关视觉方案已废弃**，仅作历史记录保留，不进入小程序包。若计划公开商用，请自行确认这些源图的授权 |
| `docs/assets/*.png` | 仓库维护者提供 | 设计过程参考图，仅作文档配图 |

示例商品名称、价格、门店信息均为虚构，见 [README 的免责声明](README.md#免责声明)。

## 3. SIL Open Font License 1.1 全文

```text
Copyright (c) <dates>, <Copyright Holder> (<URL|email>),
with Reserved Font Name <Reserved Font Name>.
Copyright (c) <dates>, <additional Copyright Holder> (<URL|email>).

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```