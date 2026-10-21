"""生成"重复配图"复现书：同一张装饰图被引用多次（不同文件名 / 同一文件名）。

真实书里这种现象非常常见：章末分隔线、出版社 logo、公式编号图标，
被每一章引用一次 —— 《现代》那本实测 4827 张图里有 71 张内容完全相同，
其中 image_000.png 一个文件就出现了 26 次。不去重就是白传 25 个一模一样的文件。
"""
import base64, zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

# 一张 1x1 的 PNG，故意用三个不同文件名引用（内容完全相同）
PNG = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMB/6X0"
    b"AAAAAElFTkSuQmCC"
)
# 另一张不同的图（不能和上面并成一张）
PNG2 = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGA"
    b"WjR9awAAAABJRU5ErkJggg=="
)

CH1 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>
<h2>第一章　装饰图</h2>
<p>章首有一张装饰图：<img src="../images/divider_01.png" alt="分隔线"/></p>
<p>章末还有同一张（换了个文件名）：<img src="../images/divider_02.png" alt="分隔线"/></p>
<p>另外这张是另一张图：<img src="../images/other.png" alt="另一张"/></p>
</body></html>'''

CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body>
<h2>第二章　又是同一张</h2>
<p>第二章章首：<img src="../images/divider_03.png" alt="分隔线"/></p>
<p>结尾再用一次：<img src="../images/divider_01.png" alt="分隔线"/></p>
</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>重复配图复现</dc:title><dc:creator>测试</dc:creator>
<dc:identifier id="uid">urn:uuid:dup-img-001</dc:identifier><dc:language>zh-CN</dc:language>
</metadata>
<manifest>
<item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="i1" href="images/divider_01.png" media-type="image/png"/>
<item id="i2" href="images/divider_02.png" media-type="image/png"/>
<item id="i3" href="images/divider_03.png" media-type="image/png"/>
<item id="i4" href="images/other.png" media-type="image/png"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>'''

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

p = OUT / "dup_img.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/text/ch1.xhtml", CH1)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
    z.writestr("OEBPS/images/divider_01.png", PNG)
    z.writestr("OEBPS/images/divider_02.png", PNG)   # 内容完全相同
    z.writestr("OEBPS/images/divider_03.png", PNG)   # 内容完全相同
    z.writestr("OEBPS/images/other.png", PNG2)
print("生成:", p)
