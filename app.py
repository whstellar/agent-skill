"""
app.py —— book2md 本地网页服务

接口:
  GET  /                -> 前端页面
  POST /api/convert     -> 上传单个文件，返回 {job_id, markdown, image_count}
  POST /api/publish     -> 把某个 job 的（可编辑后）markdown 发布到 GitHub

设计: 转换与发布分两步，用户在浏览器里能先预览/编辑 Markdown，再点发布。
job 数据暂存在内存（本地工具，足够）。
"""

from __future__ import annotations

import io
import json
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import converter
import github_publisher

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"

app = FastAPI(title="book2md")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# 内存 job 存储: job_id -> {"markdown": str, "images": {name: bytes}, "orig_name": str}
JOBS: dict[str, dict] = {}


@app.get("/", response_class=HTMLResponse)
def index():
    html = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.post("/api/convert")
async def api_convert(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "文件为空")
    try:
        result = converter.convert_file(file.filename or "book.pdf", data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # 转换失败给出可读错误
        raise HTTPException(500, f"转换失败: {e}")

    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "markdown": result["markdown"],
        "images": result["images"],
        "orig_name": file.filename or "book",
    }
    return {
        "job_id": job_id,
        "markdown": result["markdown"],
        "image_count": len(result["images"]),
        "orig_name": file.filename or "",
    }


@app.post("/api/publish")
async def api_publish(
    job_id: str = Form(...),
    token: str = Form(...),
    repo: str = Form(...),
    book_folder: str = Form(...),
    markdown: str = Form(""),
    private: bool = Form(True),
):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(400, "job 不存在或已过期，请重新上传转换")

    md = markdown if markdown.strip() else job["markdown"]

    try:
        summary = github_publisher.publish(
            token=token,
            repo_name=repo,
            book_folder=book_folder,
            markdown=md,
            images=job["images"],
            private=private,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"发布失败: {e}")

    # 发布后清理 job
    JOBS.pop(job_id, None)
    return summary


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787, reload=False)
