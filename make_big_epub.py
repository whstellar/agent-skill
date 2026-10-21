"""生成一本"真实规模"的测试书：300 张图 + 30 章，模拟大书的负载。"""
import zipfile, random
from pathlib import Path

OUT = Path(__file__).resolve().parent / "samples"
OUT.mkdir(exist_ok=True)
random.seed(42)

N_IMG = 300
N_CH = 30
IMG_KB = 40                      # 每张图 40KB
# 生成不可压缩的随机字节当图片（JPEG 本身也不可压缩）
IMG = bytes(random.getrandbits(8) for _ in range(IMG_KB * 1024))

chapters = []
imgs = []
for i in range(N_IMG):
    imgs.append(f'<p>段落 {i}。</p><p><img src="../images/img{i:03d}.jpg" alt="图 {i}"/></p>')

per = N_IMG // N_CH
for c in range(N_CH):
    body = "".join(imgs[c*per:(c+1)*per])
    chapters.append(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第 %d 章</title></head><body>\n'
        '<h2>第 %d 章　测试</h2>\n' % (c+1, c+1) + body + '</body></html>')

manifest = "\n".join(
    '<item id="c%d" href="text/ch%02d.xhtml" media-type="application/xhtml+xml"/>' % (i, i)
    for i in range(N_CH))
manifest += "\n" + "\n".join(
    '<item id="i%d" href="images/img%03d.jpg" media-type="image/jpeg"/>' % (i, i)
    for i in range(N_IMG))

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>大书压力测试</dc:title><dc:creator>测试</dc:creator>
<dc:identifier id="uid">urn:uuid:big-001</dc:identifier><dc:language>zh-CN</dc:language>
</metadata>
<manifest>%s</manifest>
<spine>%s</spine>
</package>''' % (manifest, "".join('<itemref idref="c%d"/>' % i for i in range(N_CH)))

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

p = OUT / "big.epub"
with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/content.opf", OPF)
    for i, ch in enumerate(chapters):
        z.writestr("OEBPS/text/ch%02d.xhtml" % i, ch)
    for i in range(N_IMG):
        # 每张图的字节必须不同，否则会被"按内容去重"并成一张，
        # 这本压力样本（几百张图）就失去意义了。
        z.writestr("OEBPS/images/img%03d.jpg" % i, IMG + b"__%03d" % i)
print("生成:", p, "%.1f MB" % (p.stat().st_size / 1048576))
print("规模: %d 章 / %d 图 / 每图 %d KB" % (N_CH, N_IMG, IMG_KB))