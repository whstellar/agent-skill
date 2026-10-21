"""生成一个贴近真实书籍的测试 EPUB，包含常见"脏"结构，用于诊断转换质量。"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

# 真实书籍常见结构：span 碎片、硬换行、页眉页脚、脚注、全角空格、嵌套强调、空链接、SVG 封面
CH1 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>第一章</title><link rel="stylesheet" href="../css/main.css"/></head>
<body>
<div class="chapter">
<h1 class="chapter-title"><span class="num">第一章</span><span class="txt">启程</span></h1>
<div class="page-header">第三章 启程</div>
<p class="indent">　　这是正文第一段，含有<span class="z">全角空格</span>和硬换行<br/>在段落中间。</p>
<p>混合格式：<span class="em-wrap"><em>斜体</em></span>、<strong><em>粗斜体</em></strong>、
<span style="font-style:italic;">样式斜体</span>。</p>
<blockquote class="epigraph"><p>题记：所有伟大的作品都始于一个念头。</p><p class="source">——某位作家</p></blockquote>
<div class="figure"><img src="../images/fig1.png" alt="图 1-1"/><p class="caption"><b>图 1-1</b>　示意图说明文字</p></div>
<h2>一、启程的清晨</h2>
<ul class="list"><li><p>要点一，包含多句描述。这是第一句。这是第二句。</p></li><li><p>要点二</p></li></ul>
<div class="footnote" epub:type="footnote"><p><a href="#fn1" id="fnref1">[1]</a> 脚注内容。</p></div>
<div class="page-footer">— 12 —</div>
</div>
</body></html>'''

CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body>
<h1>第二章　暗流</h1>
<p>正文。</p>
<table class="data"><caption>表 2-1　数据表</caption>
<thead><tr><th>指标</th><th>数值</th><th>备注</th></tr></thead>
<tbody><tr><td>甲</td><td>1.25</td><td rowspan="2">合并</td></tr><tr><td>乙</td><td>3.50</td></tr></tbody></table>
<figure><img src="../images/fig2.svg" alt="矢量图"/></figure>
<p><a href="http://example.com">外部链接</a> 和 <a href="#fn1">脚注回链</a></p>
</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>诊断测试书：真实结构</dc:title><dc:creator>测试作者</dc:creator>
<dc:identifier id="uid">urn:uuid:diag-001</dc:identifier><dc:language>zh-CN</dc:language>
<dc:publisher>测试出版社</dc:publisher>
</metadata>
<manifest>
<item id="css" href="css/main.css" media-type="text/css"/>
<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="f1" href="images/fig1.png" media-type="image/png"/>
<item id="f2" href="images/fig2.svg" media-type="image/svg+xml"/>
<item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
</manifest>
<spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>'''

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

p = OUT / "diag.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/css/main.css", "body{margin:0}")
    z.writestr("OEBPS/text/ch1.xhtml", CH1)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
    z.writestr("OEBPS/images/fig1.png", b"\x89PNG\r\n\x1a\n" + b"\x00"*60)
    z.writestr("OEBPS/images/fig2.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
    z.writestr("OEBPS/images/cover.jpg", b"\xff\xd8\xff\xe0" + b"\x00"*40)
print("生成:", p)
