"""生成测试 EPUB：模拟真实书籍里"字号不一 + 随意加粗"的结构。

真实 EPUB 常见问题（扫描版转 OCR、或排版随意）：
- 正文 span 带 font-size:90%（缩小）用于塞更多字
- 装饰性 span 带 font-weight:bold 用于"伪标题"（其实还是正文）
- h1~h6 混用，甚至同一章用 h2 另一章用 h3
"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

# 第一章：字号不一 + 伪标题加粗（都是正文内容，字号/加粗无意义）
CH1 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title>
<style>
.txt{font-size:90%}
.big{font-size:110%}
.bold{font-weight:bold}
</style></head>
<body>
<h2>第一章　起风的日子</h2>
<p><span class="txt">这一段字号被压到 90%，</span><span class="big">另一段是 110%，</span>但它们其实都是正文，
视觉上忽大忽小很乱。</p>
<p><span class="bold">整段被加粗了</span>，但它并不是标题，只是原文排版时随手加粗。
<strong>这里也是加粗</strong>，还有 <b>这个</b>。</p>
<p>正常正文字号的一段，用来对比基准。</p>
<h3>一、其实是正文</h3>
<p>本该是正文小节，但有的书这里用 h3，有的用 h4。</p>
</body></html>'''

# 第二章：同样的内容但标题层级不同（h3 起始）
CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body>
<h3>第二章　落雨的时候</h3>
<p>正文。</p>
<p style="font-size:85%">整段字号缩小塞内容。</p>
<div><span style="font-weight:bold">div 里的加粗 span</span>，不属于强调语义。</div>
</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>字号与字重测试</dc:title><dc:creator>测试</dc:creator>
<dc:identifier id="uid">urn:uuid:style-001</dc:identifier><dc:language>zh-CN</dc:language>
</metadata>
<manifest>
<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>'''

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

p = OUT / "style_test.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/text/ch1.xhtml", CH1)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
print("生成:", p)