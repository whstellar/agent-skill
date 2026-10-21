"""
github_publisher.py —— 把转换得到的 Markdown + 图片发布到 GitHub 仓库。

行为:
- 用 Personal Access Token 登录。
- 若目标仓库不存在则创建（可指定 public / private）。
- 把书籍放到 <书名>/ 目录下：
      <书名>/<书名>.md
      <书名>/images/xxx.png
- 已存在的文件路径**跳过**，不覆盖（满足“追加新书而非覆盖”的诉求）。
- 返回结构化的上传日志。
"""

from __future__ import annotations

import os
from typing import Optional

from github import Github, GithubException
from github.InputFileContent import InputFileContent


def publish(
    token: str,
    repo_name: str,            # 形如 "owner/repo" 或仅 "repo"（用登录用户作 owner）
    book_folder: str,          # 书名目录，如 "三体"
    markdown: str,
    images: dict[str, bytes],  # {"images/xxx.png": bytes}
    *,
    private: bool = True,
    auto_init: bool = True,
    commit_message: Optional[str] = None,
) -> dict:
    if not token:
        raise ValueError("GitHub Token 不能为空")
    if not repo_name:
        raise ValueError("仓库名不能为空")

    gh = Github(token)
    user = gh.get_user()
    owner = user.login

    # 归一化 repo 名称
    if "/" in repo_name:
        owner, repo_name = repo_name.split("/", 1)

    # 1) 取得或创建仓库
    repo = None
    try:
        repo = gh.get_repo(f"{owner}/{repo_name}")
        created = False
    except GithubException as e:
        if e.status != 404:
            raise
        # 创建仓库
        repo = user.create_repo(
            repo_name,
            private=private,
            auto_init=auto_init,
            description="由 book2md 自动发布的电子书 Markdown 仓库",
        )
        created = True

    folder = book_folder.strip().strip("/")
    if not folder:
        folder = "book"

    log: list[str] = []
    uploaded: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []

    def _exists(path: str) -> bool:
        try:
            repo.get_contents(path)
            return True
        except GithubException:
            return False

    def _put(path: str, content) -> bool:
        """上传单文件。存在则跳过。返回是否上传成功（跳过也算成功但标记 skipped）。"""
        if _exists(path):
            skipped.append(path)
            log.append(f"[跳过] 已存在: {path}")
            return False
        msg = commit_message or f"add {path}"
        try:
            repo.create_file(path, msg, content)
            uploaded.append(path)
            log.append(f"[上传] {path}")
            return True
        except GithubException as e:
            failed.append(path)
            log.append(f"[失败] {path}: {e.data.get('message', str(e)) if hasattr(e, 'data') else e}")
            return False

    # 2) 上传主 Markdown 文件
    md_path = f"{folder}/{folder}.md"
    _put(md_path, markdown)

    # 3) 上传图片
    for img_rel, img_bytes in images.items():
        # img_rel 形如 "images/xxx.png"，放到 <folder>/images/ 下
        img_name = img_rel.split("/")[-1]
        img_path = f"{folder}/images/{img_name}"
        _put(img_path, InputFileContent(img_bytes))

    summary = {
        "repo": f"{owner}/{repo_name}",
        "created_repo": created,
        "book_folder": folder,
        "uploaded": uploaded,
        "skipped": skipped,
        "failed": failed,
        "log": log,
    }
    return summary


if __name__ == "__main__":
    import sys
    # 简单 CLI 自测（需环境变量 TOKEN / REPO）
    tok = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TOKEN", "")
    repo = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("REPO", "")
    res = publish(tok, repo, "测试书", "# 测试\n\nhello", {})
    print(res)
