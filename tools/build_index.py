#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_index.py —— 扫描 papers/ 目录，生成 papers/index.json（可选功能）

什么时候用：
  网站默认走 GitHub API 列论文，无需本脚本。只有当 GitHub API 匿名限流
  （60 次/小时/IP，常见于校园网等共享出口 IP）成为问题时，才：
    1) 运行本脚本生成 index.json
    2) 在 config.js 里把 useIndexJson 设为 true
  注意：开启后每次增删论文都要重跑本脚本并提交，否则新论文不会出现。

用法：
  python tools/build_index.py            # 默认扫描本仓库的 papers/
  python tools/build_index.py 其他目录
"""

import datetime
import json
import re
import sys
from pathlib import Path

FM_RE = re.compile(r"^---[ \t]*\r?\n(.*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)", re.S)
KV_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]?(.*)$")


def strip_quotes(v: str) -> str:
    v = (v or "").strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1].strip()
    if len(v) >= 2 and v[0] == "[" and v[-1] == "]":
        return v[1:-1].strip()
    return v


def split_list(v: str):
    return [s.strip() for s in re.split(r"[,，;；、]+", strip_quotes(v)) if s.strip()]


def parse_front_matter(text: str):
    meta, body = {}, text
    m = FM_RE.match(text)
    if m:
        body = text[m.end():]
        key, block, buf = None, False, []
        for line in m.group(1).splitlines():
            kv = KV_RE.match(line)
            if kv:
                if key and block:
                    meta[key] = " ".join(buf).strip()
                key, block, buf = kv.group(1).lower(), False, []
                v = kv.group(2).strip()
                if v in ("|", ">", "|-", ">-"):
                    block = True
                else:
                    meta[key] = v
                    key = None
            elif key and block and line.strip():
                buf.append(line.strip())
        if key and block:
            meta[key] = " ".join(buf).strip()
    return meta, body


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def build_entry(p: Path) -> dict:
    entry = {
        "name": p.name,
        "type": "md" if p.suffix.lower() in (".md", ".markdown") else "pdf",
        "title": p.stem,
        "author": "",
        "date": "",
        "abstract": "",
        "tags": [],
        "code": [],
        "size": p.stat().st_size,
    }
    if entry["type"] == "md":
        meta, _ = parse_front_matter(read_text(p))
        entry["title"] = strip_quotes(meta.get("title")) or entry["title"]
        entry["author"] = strip_quotes(meta.get("author", meta.get("authors", "")))
        entry["date"] = strip_quotes(meta.get("date", meta.get("published", "")))
        entry["abstract"] = strip_quotes(meta.get("abstract", meta.get("summary", "")))
        entry["tags"] = split_list(meta.get("tags", meta.get("keywords", "")))
        entry["code"] = split_list(meta.get("code", meta.get("repo", "")))
    else:
        sidecar = p.with_name(p.name + ".json")
        if sidecar.exists():
            try:
                s = json.loads(read_text(sidecar))
                entry["title"] = s.get("title") or entry["title"]
                entry["author"] = s.get("author", "")
                entry["date"] = s.get("date", "")
                entry["abstract"] = s.get("abstract", "")
                entry["tags"] = list(s.get("tags", []))
                entry["code"] = list(s.get("code", []))
            except Exception as e:
                print(f"[警告] {sidecar.name} 解析失败：{e}")
    return entry


def main() -> None:
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "papers"
    if not base.is_dir():
        print(f"[错误] 目录不存在：{base}")
        sys.exit(1)

    papers, skipped = [], []
    for p in sorted(base.iterdir()):
        if not p.is_file() or p.name.startswith(".") or p.name.startswith("_"):
            continue
        if p.suffix.lower() == ".json":
            continue
        if p.suffix.lower() in (".md", ".markdown", ".pdf"):
            papers.append(build_entry(p))
        else:
            skipped.append(p.name)

    def date_key(e):
        d = e.get("date", "")
        try:
            return datetime.datetime.fromisoformat(str(d)[:10]).timestamp() if d else 0
        except ValueError:
            return 0

    papers.sort(key=date_key, reverse=True)

    out = base / "index.json"
    payload = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "generator": "tools/build_index.py",
        "papers": papers,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"已生成 {out}（共 {len(papers)} 篇）")
    for e in papers:
        print(f"  - [{e['type']}] {e['title']}  ({e['date'] or '无日期'})")
    if skipped:
        print(f"已跳过非 md/pdf 文件：{', '.join(skipped)}")
    print("别忘了：要在网站启用它，还需在 config.js 里设置 useIndexJson: true，"
          "并且以后每次增删论文后重跑本脚本。")


if __name__ == "__main__":
    main()
