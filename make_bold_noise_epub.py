"""生成"粗体误报"复现书：正文里大量合法的 ** 出现方式，
用于验证自检器不会把它们误判成"粗体未闭合"。

真实书籍里这些情况非常常见：
  · 代码块里的 Python **kwargs / glob 通配符 **/*.txt
  · 行内代码里的 ** 
  · 转义过的 \\*\\* 字面量
  · 数学公式里的乘号
"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

BODY = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第三章</title></head><body>

<h2>第三章　公式与代码</h2>

<h3>一、代码块里的双星号</h3>
<pre><code>def f(**kwargs):
    return sorted(glob.glob("**/*.txt"))

# 双星号在通配符里出现，如 **/*.md
result = {**a, **b}</code></pre>

<h3>二、行内代码里的双星号</h3>
<p>调用方式为 <code>**options</code>，或使用 <code>dict(**d)</code> 展开。</p>

<h3>三、正文里的强调（真正该被识别成粗体的）</h3>
<p>这里是<strong>真正的粗体</strong>，还有<strong>另一处</strong>。</p>

<h3>四、公式中的双星号</h3>
<p>在正则里 <code>a**b</code> 表示 a 后跟零个或多个 b。</p>

<h3>五、单个星号（斜体标记）</h3>
<p>这是<em>斜体</em>，这不是 * 裸星号。</p>

<h3>六、正文中的裸双星号</h3>
<p>有些排版粗糙的书会在正文里直接写 ** 而不加空格，应当原样保留。</p>

</body></html>'''

CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第四章</title></head>
<body>
<h2>第四章　更多公式</h2>
<pre><code>a = b ** c
d = e ** f ** g</code></pre>
<p>数学里的 <code>x ** 2</code> 与 <code>2 ** y</code>。</p>
<p>真正的<strong>强调一</strong>和<strong>强调二</strong>。</p>
</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>双星号误报复现</dc:title><dc:creator>测试</dc:creator>
<dc:identifier id="uid">urn:uuid:bold-001</dc:identifier><dc:language>zh-CN</dc:language>
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

p = OUT / "bold_noise.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/text/ch1.xhtml", BODY)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
print("生成:", p)