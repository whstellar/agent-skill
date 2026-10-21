"""
converter.py —— 把 PDF / EPUB 转换成 Markdown，并抽出图片。

返回结构:
    {
        "markdown": str,                       # 主 Markdown 文本（图片用相对路径引用）
        "images": { "images/xxx.png": bytes }, # 图片名 -> 二进制内容
    }

设计要点:
- PDF: 优先用 pymupdf4llm（保留标题/列表/表格结构，图片落盘到 images/）。
  若不可用则退化为 PyMuPDF 纯文本提取。
- EPUB: 用 ebooklib 读取各 XHTML 章节，markdownify 转 MD，图片从 EPUB 压缩包抽取。
"""

from __future__ import annotations

import io
import os
import re
import zipfile
from pathlib import Path

# ----------------------------------------------------------------------------
# PDF  (仅依赖 PyMuPDF：自带 markdown 结构化文本提取 + 独立抽图，全程内存可控)
# ----------------------------------------------------------------------------
def _convert_pdf(data: bytes) -> dict:
    import pymupdf as fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    images: dict[str, bytes] = {}
    parts: list[str] = []

    for page_index in range(len(doc)):
        page = doc.load_page(page_index)
        # 抽取页面中的图片
        for img_index, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            try:
                base = doc.extract_image(xref)
            except Exception:
                continue
            ext = (base.get("ext") or "png").lower()
            if ext not in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
                ext = "png"
            name = f"images/page{page_index + 1}_img{img_index + 1}.{ext}"
            images[name] = base["image"]
        # 抽取文字（优先 markdown 结构化；老版本回退纯文本）
        try:
            text = page.get_text("markdown")
        except Exception:
            text = page.get_text()
        parts.append(text)

    markdown = "\n\n".join(p.strip() for p in parts if p.strip())
    return {"markdown": markdown, "images": images}


# ----------------------------------------------------------------------------
# EPUB
# ----------------------------------------------------------------------------
def _convert_epub(data: bytes) -> dict:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup
    from markdownify import markdownify as md

    book = epub.read_epub(io.BytesIO(data))
    images: dict[str, bytes] = {}

    # 1) 收集 EPUB 内图片资源（href -> bytes）
    epub_images: dict[str, bytes] = {}
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_IMAGE:
            epub_images[item.get_name()] = item.get_content()

    # 2) 逐章节转换为 Markdown
    chapters_md: list[str] = []
    seen_doc_items = []

    def _order_key(item):
        # 尽量按 spine 顺序；epub 库读不到时退化为文件名
        return item.get_name()

    doc_items = [it for it in book.get_items() if it.get_type() == ebooklib.ITEM_DOCUMENT]
    for item in sorted(doc_items, key=_order_key):
        html = item.get_content()
        if isinstance(html, bytes):
            html = html.decode("utf-8", errors="replace")
        # 去掉 XML 声明 / DOCTYPE，避免被 markdownify 当成文本保留
        html = re.sub(r"<\?xml[^>]*\?>", "", html, flags=re.IGNORECASE).strip()
        html = re.sub(r"<!DOCTYPE[^>]*>", "", html, flags=re.IGNORECASE).strip()
        soup = BeautifulSoup(html, "html.parser")
        # 去掉脚本/样式
        for tag in soup(["script", "style"]):
            tag.decompose()
        chapter_md = md(str(soup), heading_style="ATX")
        # 归一化图片链接：把 EPUB 内相对路径替换为 images/<basename>
        for img_tag in soup.find_all("img"):
            src = img_tag.get("src") or ""
            if not src:
                continue
            # 解析相对路径，定位 epub_images 中的真实 name
            resolved = _resolve_href(item.get_name(), src)
            if resolved in epub_images and resolved not in images:
                base = os.path.basename(resolved)
                images[f"images/{base}"] = epub_images[resolved]
                # 在已生成的 markdown 文本中替换引用
                chapter_md = chapter_md.replace(src, f"images/{base}")
        if chapter_md.strip():
            chapters_md.append(chapter_md.strip())

    markdown = "\n\n---\n\n".join(chapters_md)
    return {"markdown": markdown, "images": images}


def _resolve_href(base_name: str, src: str) -> str:
    """把文档内相对 src 解析为 EPUB 内的绝对资源名（简单实现）。"""
    if src.startswith("/"):
        return src.lstrip("/")
    base_dir = os.path.dirname(base_name)
    # 处理 ../ 与 ./ 
    parts = []
    for seg in (base_dir.split("/") if base_dir else []) + src.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
        else:
            parts.append(seg)
    return "/".join(parts)


# ----------------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------------
def convert_file(filename: str, data: bytes) -> dict:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return _convert_pdf(data)
    elif ext in (".epub",):
        return _convert_epub(data)
    else:
        raise ValueError(f"不支持的文件类型: {ext}（仅支持 .pdf / .epub）")


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("用法: python converter.py <输入文件> <输出.md>")
        sys.exit(1)
    with open(sys.argv[1], "rb") as f:
        blob = f.read()
    res = convert_file(sys.argv[1], blob)
    Path(sys.argv[2]).write_text(res["markdown"], encoding="utf-8")
    print(f"已转换: {sys.argv[1]} -> {sys.argv[2]} ({len(res['images'])} 张图片)")
