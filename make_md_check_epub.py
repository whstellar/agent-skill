"""生成"元素大全"测试 EPUB：覆盖转换器支持的所有元素，
用于验证输出是否为**合法 Markdown**（用 CommonMark 解析器实测）。
"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

BODY = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title>
<style>.em{font-style:italic} .bd{font-weight:bold} .small{font-size:90%}</style>
</head><body>

<h2>第一章　元素大全</h2>

<h3>一、标题层级</h3>
<p>这是 h2 下的 h3。</p>
<h4>更深一层</h4>
<p>h4 内容。</p>

<h3>二、行内元素</h3>
<p>普通正文，<strong>加粗强调</strong>、<em>斜体</em>、<del>删除线</del>、
<code>行内代码</code>、<span class="em">样式斜体</span>。</p>
<p>含反引号的代码：<code>a`b</code>。</p>
<p>化学式 H<sub>2</sub>O，超标 x<sup>2</sup>。</p>
<p>日文注音 <ruby>漢<rt>かん</rt></ruby> 字。</p>
<p>整段加粗的噪音：<strong>这一整段很长的加粗文字应该被剥离掉</strong>。</p>

<h3>三、段落与引用</h3>
<p>第一段。这是第一句。这是第二句。</p>
<blockquote><p>题记内容。</p><p>——某位作家</p></blockquote>

<h3>四、列表</h3>
<ul><li>无序一</li><li>无序二</li></ul>
<ol><li>有序一</li><li>有序二</li></ol>
<ul><li>外层<ul><li>内层一</li><li>内层二</li></ul></li><li>另一项</li></ul>
<ol><li>第一项<ol><li>子项A</li></ol></li></ol>

<h3>五、代码块</h3>
<pre><code>def f():
    return 1
# 注释不是标题</code></pre>

<h3>六、表格</h3>
<table>
<caption>表 1-1 数据表</caption>
<tr><th>列A</th><th>列B</th><th>备注</th></tr>
<tr><td>值1</td><td>1.25</td><td>说明</td></tr>
<tr><td>值2</td><td>3.50</td><td>含|竖线</td></tr>
</table>

<h3>七、链接与图片</h3>
<p>外部链接：<a href="https://example.com">示例站点</a>。</p>
<p>内部链接：<a href="chapter2.xhtml">第二章</a>。</p>
<p>锚点链接：<a href="#section1">跳到某节</a>。</p>
<p><img src="../images/fig01.png" alt="图 1-1"/></p>
<figure><img src="../images/fig02.png" alt="图 1-2"/><figcaption>图 1-2 说明文字</figcaption></figure>

<h3>八、特殊内容</h3>
<p>页眉页脚不该出现：</p>
<div class="page-header"><p>第三章</p></div>
<div class="page-footer"><p>— 12 —</p></div>
<p>脚注该保留：</p>
<aside epub:type="footnote"><p>这是脚注正文。</p></aside>
<p>硬换行：<br/>这是换行后的内容。</p>
<p>全角标点：，。！？；：、</p>
<p>百分号 50%off 与实体&nbsp;测试。</p>

</body></html>'''

# 第二章：外部 SVG 图片
CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body>
<h2>第二章　矢量图与边界</h2>
<p>外部 SVG：</p>
<p><img src="../images/chart.svg" alt="矢量图"/></p>
<p>内联 SVG：</p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20" aria-label="示意图">
<rect width="100" height="20" fill="#eee"/><text x="5" y="14">图内文字</text>
</svg>
<p>这一段包含裸露的 * 星号和 _ 下划线，以及 <span class="small">缩小字号</span>。</p>
<p>混合中英文 the quick brown fox 与中文连排。</p>
</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Markdown 合规性测试</dc:title><dc:creator>测试作者</dc:creator>
<dc:publisher>测试出版社</dc:publisher><dc:language>zh-CN</dc:language>
<dc:identifier id="uid">urn:uuid:md-check-001</dc:identifier>
</metadata>
<manifest>
<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="f1" href="images/fig01.png" media-type="image/png"/>
<item id="f2" href="images/fig02.png" media-type="image/png"/>
<item id="sv" href="images/chart.svg" media-type="image/svg+xml" properties="cover-image"/>
</manifest>
<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>'''

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

# 最小合法 PNG
PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52])
SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

p = OUT / "md_check.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/text/ch1.xhtml", BODY)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
    z.writestr("OEBPS/images/fig01.png", PNG)
    z.writestr("OEBPS/images/fig02.png", PNG)
    z.writestr("OEBPS/images/chart.svg", SVG)
print("生成:", p)