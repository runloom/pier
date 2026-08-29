#!/usr/bin/env python3
"""从 CHANGELOG.md 提取指定版本条目，生成博客文章（中文必生成，英文/日文/韩文可选 LLM 翻译）。

用法：
    python3 release-to-blog.py --changelog CHANGELOG.md --version v0.1.33 --out /tmp/blog-posts

输出（--out 目录）：
    slug           生成的文章 slug（无条目时不写此文件，退出码 0）
    zh/<slug>.md   中文文章
    en/<slug>.md   英文文章（默认生成，可用 TRANSLATE_LANGS 调整）

可选环境变量（翻译，默认 DeepSeek，OpenAI 兼容接口）：
    LLM_API_KEY      DeepSeek API 密钥；不设置则只生成中文
    LLM_BASE_URL     接口地址，默认 https://api.deepseek.com/v1（可换成其它兼容服务）
    LLM_MODEL        模型名，默认 deepseek-chat
    TRANSLATE_LANGS  逗号分隔的目标语言，默认 "en,ja,ko"；置空则只生成中文
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENTRY_RE = re.compile(r"^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$")
BULLET_RE = re.compile(r"^\s*-\s+(.+)$")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
HEADING_RE = re.compile(r"^### (.+)$", re.M)

LANG_NAMES = {"en": "English", "ja": "Japanese", "ko": "Korean"}
SECTION_HEADINGS = {
    "Added": "新增",
    "Changed": "变更",
    "Deprecated": "弃用",
    "Removed": "移除",
    "Fixed": "修复",
    "Security": "安全",
}


def parse_changelog(text: str):
    """返回 {版本: {"date": str, "start": 行号(条目标题行)}}，保持文件顺序。"""
    entries = {}
    for i, line in enumerate(text.splitlines()):
        m = ENTRY_RE.match(line.strip())
        if m:
            entries[m.group(1)] = {"date": m.group(2), "start": i}
    return entries


def extract_entry(text: str, version: str, entries: dict) -> str | None:
    """取版本条目正文（不含标题行）；版本不存在返回 None。"""
    clean = version.lstrip("vV")
    if clean not in entries:
        return None
    names = list(entries)
    idx = names.index(clean)
    lines = text.splitlines()
    start = entries[clean]["start"] + 1
    end = entries[names[idx + 1]]["start"] if idx + 1 < len(names) else len(lines)
    body = "\n".join(lines[start:end]).strip()
    # 小节标题降一级，Keep a Changelog 英文小节改成中文（### Changed → ## 变更）
    def replace_heading(match: re.Match[str]) -> str:
        name = match.group(1).strip()
        return "## " + SECTION_HEADINGS.get(name, name)

    return HEADING_RE.sub(replace_heading, body)


def first_bullet(body: str) -> str:
    for line in body.splitlines():
        m = BULLET_RE.match(line)
        if m:
            return m.group(1).strip()
    return ""


def make_title(version: str, bullet: str) -> str:
    ver = version.lstrip("vV")
    m = BOLD_RE.search(bullet)
    if m:
        title = m.group(1).strip().rstrip("。.，,")
        if title:
            short = title[:40] + "…" if len(title) > 40 else title
            return f"Pier {ver}：{short}"
    return f"Pier {ver} 发布"


def make_description(bullet: str) -> str:
    desc = bullet.replace("**", "").strip()
    return desc[:150] + "…" if len(desc) > 150 else desc


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def parse_yaml_string(raw: str) -> str | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        if len(raw) >= 2 and raw[0] == raw[-1] == '"':
            return raw[1:-1]
        return raw
    return value if isinstance(value, str) else None


def build_zh(version: str, date: str, body: str) -> str:
    bullet = first_bullet(body)
    title = make_title(version, bullet)
    desc = make_description(bullet) if bullet else f"Pier {version.lstrip('vV')}（{date}）的更新内容。"
    frontmatter = (
        "---\n"
        f"title: {yaml_string(title)}\n"
        f"description: {yaml_string(desc)}\n"
        f"pubDate: {date}\n"
        "lang: zh\n"
        "---\n"
    )
    return (
        f"{frontmatter}\n"
        f"Pier {version.lstrip('vV')}（{date}）发布。本版更新内容如下。\n\n"
        f"{body}\n"
    )


def call_llm(prompt: str) -> str | None:
    key = os.environ.get("LLM_API_KEY", "").strip()
    if not key:
        return None
    base = os.environ.get("LLM_BASE_URL") or "https://api.deepseek.com/v1"
    base = base.rstrip("/")
    model = os.environ.get("LLM_MODEL") or "deepseek-chat"
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        }
    ).encode()
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            print("[warn] LLM 翻译失败：empty content", file=sys.stderr)
            return None
        return content.strip()
    except (
        urllib.error.URLError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
        json.JSONDecodeError,
    ) as e:
        print(f"[warn] LLM 翻译失败：{e}", file=sys.stderr)
        return None


def translate_doc(zh: str, lang: str) -> str | None:
    """把中文文章翻译成目标语言：title/description/正文三次请求，保留 frontmatter 结构。"""
    name = LANG_NAMES.get(lang, lang)
    front, _, body = zh.partition("\n---\n")
    title_match = re.search(r"^title:\s*(.*)$", front, re.M)
    desc_match = re.search(r"^description:\s*(.*)$", front, re.M)
    date = re.search(r"^pubDate: (.+)$", front, re.M)
    title = parse_yaml_string(title_match.group(1)) if title_match else None
    desc = parse_yaml_string(desc_match.group(1)) if desc_match else None

    en_title = (
        call_llm(
            f"Translate the following Chinese blog post title into natural {name}. "
            f"Return only the translated title, no quotes.\n\n{title}"
        )
        if title
        else None
    )
    en_desc = (
        call_llm(
            f"Translate the following Chinese blog post description into natural {name}. "
            f"Return only the translated description, no quotes.\n\n{desc}"
        )
        if desc
        else None
    )
    en_body = call_llm(
        f"Translate the following Chinese tech changelog into natural {name}. "
        "Keep all markdown structure (headings, bullets, bold). "
        "Return only the translated markdown, no code fence.\n\n"
        f"{body}"
    )
    if not en_body:
        return None
    parts = ["---"]
    if en_title:
        parts.append(f"title: {yaml_string(en_title)}")
    if en_desc:
        parts.append(f"description: {yaml_string(en_desc)}")
    if date:
        parts.append(f"pubDate: {date.group(1)}")
    parts.append(f"lang: {lang}\n---\n")
    return "\n".join(parts) + "\n" + en_body + "\n"


def slug_for(version: str) -> str:
    return "pier-" + version.lstrip("vV").replace(".", "-")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--changelog", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    text = Path(args.changelog).read_text(encoding="utf-8")
    entries = parse_changelog(text)
    body = extract_entry(text, args.version, entries)
    if body is None:
        print(f"[skip] CHANGELOG 中未找到版本 {args.version.lstrip('vV')} 的条目，跳过")
        return 0

    entry = entries[args.version.lstrip("vV")]
    slug = slug_for(args.version)
    out = Path(args.out)
    langs_raw = os.environ.get("TRANSLATE_LANGS")
    # 未设置 → 默认 en/ja/ko；显式置空（""）→ 只生成中文
    if langs_raw is None:
        langs = ["en", "ja", "ko"]
    else:
        langs = [lang.strip() for lang in langs_raw.split(",") if lang.strip()]
    for lang_dir in set(langs) | {"zh"}:
        (out / lang_dir).mkdir(parents=True, exist_ok=True)

    zh = build_zh(args.version, entry["date"], body)
    (out / "zh" / f"{slug}.md").write_text(zh, encoding="utf-8")

    translated = []
    for lang in langs:
        if lang in ("zh",):
            continue
        translated_doc = translate_doc(zh, lang)
        if translated_doc:
            (out / lang / f"{slug}.md").write_text(translated_doc, encoding="utf-8")
            translated.append(lang)

    if translated:
        print(f"[ok] 已生成 {slug}.md（zh + {', '.join(translated)}，模型翻译）")
    else:
        print(f"[ok] 已生成 {slug}.md（zh；未配置 LLM_API_KEY，跳过翻译）")

    (out / "slug").write_text(slug, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
