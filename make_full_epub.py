"""生成一个更真实的测试 EPUB：多章节 + 图片 + 嵌套路径 + 各种行内元素。"""
import zipfile, struct
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

# 造两个极小的合法 PNG（1x1 像素）
def make_png(w, h, rgb):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib_crc(c) & 0xffffffff)
    import zlib as _z
    def zlib_crc(b):
        return _z.crc32(b)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    raw = b''
    for y in range(h):
        raw += b'\x00' + bytes(rgb) * w
    idat = _z.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

png1 = make_png(2, 2, (255, 0, 0))
png2 = make_png(2, 2, (0, 0, 255))

CHAPTER1 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title>
<style>p{color:red}</style></head>
<body>
<h1>第一章 开始</h1>
<p>普通段落，包含 <b>粗体</b>、<i>斜体</i>、<code>inline_code</code>。</p>
<p>看图：<img src="../Images/pic1.png" alt="图一"/></p>
<h2>小节</h2>
<ul><li>列表项一</li><li>列表项二<ul><li>嵌套项</li></ul></li></ul>
<ol><li>有序一</li><li>有序二</li></ol>
<blockquote>引用内容</blockquote>
<pre><code>print("hello")
x = 1</code></pre>
<table><tr><th>列A</th><th>列B</th></tr><tr><td>值1</td><td>值2</td></tr></table>
<p>链接：<a href="chapter2.xhtml">下一章</a></p>
</body></html>'''

CHAPTER2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch2</title></head>
<body>
<h1>第二章</h1>
<p>第二张图：<img src="../Images/sub/pic2.png" alt="图二"/></p>
<p>结束。</p>
</body></html>'''

OPF = '''<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>测试书：完整功能</dc:title><dc:creator>张三</dc:creator>
<dc:identifier id="id">urn:uuid:test123</dc:identifier><dc:language>zh-CN</dc:language>
</metadata>
<manifest>
<item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/>
<item id="i1" href="Images/pic1.png" media-type="image/png"/>
<item id="i2" href="Images/sub/pic2.png" media-type="image/png"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>'''

CONTAINER = '''<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'''

p = OUT / "full.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/Text/chapter1.xhtml", CHAPTER1)
    z.writestr("OEBPS/Text/chapter2.xhtml", CHAPTER2)
    z.writestr("OEBPS/Images/pic1.png", png1)
    z.writestr("OEBPS/Images/sub/pic2.png", png2)
print("生成:", p)
