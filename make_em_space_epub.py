"""生成"强调标记内侧带空白"复现书。

真实电子书里，<b>/<i> 内层带首尾空白极其常见：
  · 源码里标签前后换行缩进：<b>\\n      绝对优</b> → 内层文本以空格开头
  · 作者在标签里补了空格：<b>绝对优 </b>
  · 全角空格（U+3000）当缩进

这些写法生成 `** 绝对优**` / `**绝对优 **`，CommonMark 认为**没闭合**，
GitHub 会把星号原样印在正文里。而页面里的正则预览认这种写法，
于是出现"本地看是粗体、上传后是星号"的分裂 —— 用户在书里看到的
`**绝对优**势` 就是这么来的。
"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)

CH1 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>

<h2>第一章　锁与并发</h2>
<p>该专门生产锁，总共生产<strong>6 把锁</strong>。</p>
<p>技能工人同样具有<strong>绝对优</strong>势，这体现在参数上。</p>

<h2>第二章　标签里多了空格</h2>
<p>这一句的粗体<strong> 前面有一个空格</strong>，应当照样加粗。</p>
<p>这一句的粗体<strong>后面有一个空格 </strong>，也应当照样加粗。</p>
<p>这一句用的是全角空格：<strong>　绝对优</strong>势。</p>
<p>这一句的斜体<em>以一个空格开头 </em>，后面接着正文。</p>
<p><del> 这段是删掉的 </del>后面还有内容。</p>

<h2>第三章　源码换行缩进</h2>
<p>
  <strong>
      循证经济学习题
  </strong>
</p>
<p>标签内部换了行再缩进，内层文本就会以空格开头 —— 也是最常见的踩坑姿势。</p>

<h2>第四章　嵌套强调</h2>
<p><strong><em>重要</em></strong>的事情先说。</p>
<p>正文里还有一些<em>正常的斜体</em>与<strong>正常的粗体</strong>。</p>

<h2>第五章　逐字加粗的姓名</h2>
<p><strong>徐</strong><strong>浩</strong><strong>庆</strong>，中国社会科学院经济研究所研究员。</p>
<p>这一行的每个字各包一个 <code>&lt;strong&gt;</code>（常见于字间距排版的作者名），
拼出来就是 <code>**徐****浩****庆**</code> —— 相邻接缝要并成一个 <code>**徐浩庆**</code>。</p>

</body></html>'''

CH2 = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第五章</title></head><body>

<h2>第六章　不该动的东西</h2>
<p>有些排版粗糙的书会在正文里直接写 ** 而不加空格，那是原文，照原样保留。</p>
<p>公式里也是：<code>x ** 2</code> 与 <code>2 ** y</code>，星号不是标记。</p>
<p>价格 5*3 元，这不是斜体；设 a*b 为积，也不是。</p>

</body></html>'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>强调标记内侧空白复现</dc:title><dc:creator>测试</dc:creator>
<dc:identifier id="uid">urn:uuid:em-space-001</dc:identifier><dc:language>zh-CN</dc:language>
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

p = OUT / "em_space.epub"
with zipfile.ZipFile(p, "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    z.writestr("OEBPS/text/ch1.xhtml", CH1)
    z.writestr("OEBPS/text/ch2.xhtml", CH2)
print("生成:", p)
