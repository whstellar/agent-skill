"""生成"脏图名 + 脏格式"测试 EPUB。

真实电子书里图片文件名经常带空格、括号、中文、百分号、井号，引用路径有的
写原样、有的写 %20 编码。这些在浏览器里都正常，但转成 Markdown 后如果没转义，
GitHub 上就是一片裂图 —— 本项目此前正好没有覆盖这类样本。

同时把常见的格式坑也塞进来：表格里放图片、表格列数不齐、图片 alt 带竖线、
嵌套列表、长段落软换行、连续空段落。
"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52])
JPG = bytes([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])

CH1 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>脏图名</title></head>
<body>
<h2>第一章　图片文件名很脏</h2>

<p>空格：<img src="../images/my photo 1.jpg" alt="带空格的图"/></p>
<p>空格但引用用了 %20：<img src="../images/my%20photo%201.jpg" alt="同一张图的编码引用"/></p>
<p>括号：<img src="../images/figure(2).png" alt="带括号的图"/></p>
<p>中文：<img src="../images/中文插图.png" alt="中文文件名"/></p>
<p>百分号：<img src="../images/50%off.png" alt="五折"/></p>
<p>井号：<img src="../images/a#b.png" alt="井号图"/></p>
<p>问号：<img src="../images/q?x.png" alt="问号图"/></p>
<p>大写扩展名：<img src="../images/UP.JPG" alt="大写扩展名"/></p>

<p>alt 带竖线和方括号：<img src="../images/figure(2).png" alt="a|b[c]d"/></p>

<h3>表格里放图片</h3>
<table>
<tr><th>图</th><th>说明</th></tr>
<tr><td><img src="../images/figure(2).png" alt="表内图"/></td><td>第一行</td></tr>
<tr><td><img src="../images/中文插图.png" alt="表内中文图"/></td><td>第二行</td></tr>
</table>

<h3>表格列数不齐</h3>
<table>
<tr><th>A</th><th>B</th><th>C</th></tr>
<tr><td>1</td><td>2</td><td>3</td></tr>
<tr><td>只有两列</td><td>补上</td></tr>
<tr><td>1</td><td>2</td><td>3</td><td>4</td></tr>
</table>

<h3>嵌套列表</h3>
<ul>
  <li>第一层
    <ul><li>第二层<ul><li>第三层</li></ul></li></ul>
  </li>
  <li>另一个第一层</li>
</ul>

<h3>长段落软换行</h3>
<p>这一段在源文件里被硬折行了，
每一行末尾都有换行，
转换后应该拼成一整段而不是断成多段。

换行后有空行才是新段落。</p>

<h3>连续空段落</h3>
<p>上面有两个空段落。</p>
<p></p><p> </p><p>下面还有内容。</p>
</body></html>'''

CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>重复引用</title></head>
<body>
<h2>第二章　同一张图被重复引用</h2>
<p>再引一次空格图：<img src="../images/my photo 1.jpg" alt="复用"/></p>
<p>这次用编码路径：<img src="../images/%E4%B8%AD%E6%96%87%E6%8F%92%E5%9B%BE.png" alt="中文编码引用"/></p>
<p>大小写不同的路径：<img src="../Images/up.jpg" alt="大小写不同"/></p>
</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>脏文件名测试</dc:title><dc:creator>测试作者</dc:creator>
<dc:publisher>测试出版社</dc:publisher><dc:language>zh-CN</dc:language>
<dc:identifier id="uid">urn:uuid:dirty-001</dc:identifier>
</metadata>
<manifest>
<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="i1" href="images/my photo 1.jpg" media-type="image/jpeg"/>
<item id="i2" href="images/figure(2).png" media-type="image/png"/>
<item id="i3" href="images/中文插图.png" media-type="image/png"/>
<item id="i4" href="images/50%off.png" media-type="image/png"/>
<item id="i5" href="images/a#b.png" media-type="image/png"/>
<item id="i6" href="images/q?x.png" media-type="image/png"/>
<item id="i7" href="images/UP.JPG" media-type="image/jpeg"/>
<item id="i8" href="images/未被引用的孤儿图.png" media-type="image/png"/>
</manifest>
<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>'''

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

IMAGES = [
    "OEBPS/images/my photo 1.jpg",
    "OEBPS/images/figure(2).png",
    "OEBPS/images/中文插图.png",
    "OEBPS/images/50%off.png",
    "OEBPS/images/a#b.png",
    "OEBPS/images/q?x.png",
    "OEBPS/images/UP.JPG",
    "OEBPS/images/未被引用的孤儿图.png",
]

p = OUT / "dirty.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/text/ch1.xhtml", CH1)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
    for n in IMAGES:
        # 每张图的内容必须**互不相同**：配图现在会按内容去重，
        # 要是大家字节都一样，会被并成一张，这个样本想测的"各种文件名长相"就没得测了。
        base = JPG if n.lower().endswith((".jpg", ".jpeg")) else PNG
        z.writestr(n, base + n.encode("utf-8"))
print("生成:", p)
