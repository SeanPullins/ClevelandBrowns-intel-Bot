#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote_plus, urlparse

import feedparser
import requests
import yaml
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DOCS_DIR = ROOT / "docs"
PUBLIC_ARCHIVE = PUBLIC_DIR / "archive"
DOCS_ARCHIVE = DOCS_DIR / "archive"
CONFIG_PATH = ROOT / "config.yaml"

DEFAULT_MODEL = "openai/gpt-5.2"
DEFAULT_REFERER = "https://seanpullins.github.io/ClevenadBrowns-intel-Bot/"
DEFAULT_TITLE = "Browns Intelligence Command Center"

SOURCE_FEEDS = [
    {
        "name": "Official Browns News",
        "url": "https://news.google.com/rss/search?q=site%3Aclevelandbrowns.com%2Fnews%20%22Cleveland%20Browns%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 1 Official",
        "weight": 25,
    },
    {
        "name": "NFL.com Browns",
        "url": "https://news.google.com/rss/search?q=site%3Anfl.com%20%22Cleveland%20Browns%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 1 League",
        "weight": 22,
    },
    {
        "name": "ESPN Browns",
        "url": "https://news.google.com/rss/search?q=site%3Aespn.com%20%22Cleveland%20Browns%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 2 Reporting",
        "weight": 18,
    },
    {
        "name": "Cleveland.com Browns",
        "url": "https://news.google.com/rss/search?q=site%3Acleveland.com%2Fbrowns%20Browns%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 2 Local Reporting",
        "weight": 18,
    },
    {
        "name": "Akron Beacon Journal Browns",
        "url": "https://news.google.com/rss/search?q=site%3Abeaconjournal.com%20%22Cleveland%20Browns%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 2 Local Reporting",
        "weight": 16,
    },
    {
        "name": "News 5 Cleveland Browns",
        "url": "https://news.google.com/rss/search?q=site%3Anews5cleveland.com%2Fsports%2Fbrowns%20Browns%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 2 Local Reporting",
        "weight": 16,
    },
    {
        "name": "WKYC Browns",
        "url": "https://news.google.com/rss/search?q=site%3Awkyc.com%20%22Cleveland%20Browns%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 2 Local Reporting",
        "weight": 16,
    },
    {
        "name": "Pro Football Talk Browns",
        "url": "https://news.google.com/rss/search?q=site%3Anbcsports.com%2Fnfl%2Fprofootballtalk%20%22Cleveland%20Browns%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 2 National Reporting",
        "weight": 16,
    },
    {
        "name": "Dawgs By Nature",
        "url": "https://www.dawgsbynature.com/rss/current.xml",
        "tier": "Tier 3 Browns Analysis",
        "weight": 10,
    },
    {
        "name": "Browns Wire",
        "url": "https://news.google.com/rss/search?q=site%3Abrownswire.usatoday.com%20Browns%20when%3A7d&hl=en-US&gl=US&ceid=US:en",
        "tier": "Tier 3 Browns Analysis",
        "weight": 10,
    },
]

CATEGORIES = {
    "QB Room": ["quarterback", " qb ", "flacco", "pickett", "gabriel", "shedeur", "watson"],
    "Draft Intel": ["draft", "prospect", "mock", "combine", "senior bowl", "top 30", "visit"],
    "Roster / Injury": ["injury", "injured", "roster", "signed", "waived", "released", "trade", "contract"],
    "Front Office / Coaching": ["andrew berry", "kevin stefanski", "coach", "coordinator", "haslam"],
    "Betting / Market": ["odds", "spread", "win total", "betting", "futures"],
    "Offense": ["offense", "receiver", "running back", "tight end", "offensive line", "tackle"],
    "Defense": ["defense", "myles garrett", "cornerback", "linebacker", "edge", "safety"],
}

PRIORITY_TERMS = [
    "cleveland browns",
    "browns",
    "quarterback",
    "injury",
    "trade",
    "draft",
    "andrew berry",
    "kevin stefanski",
    "myles garrett",
    "shedeur",
    "dillon gabriel",
]

NOISE_TERMS = [
    "bold prediction",
    "trade proposal",
    "dream scenario",
    "way-too-early",
    "fan proposal",
]


def clean_text(value: str) -> str:
    value = html.unescape(value or "")
    value = BeautifulSoup(value, "html.parser").get_text(" ", strip=True)
    return re.sub(r"\s+", " ", value).strip()


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_date(value: Any) -> dt.datetime:
    if not value:
        return now_utc()
    try:
        parsed = dt.datetime(*value[:6], tzinfo=dt.timezone.utc) if isinstance(value, tuple) else None
        if parsed:
            return parsed
    except Exception:
        pass
    try:
        from dateutil import parser as date_parser
        parsed = date_parser.parse(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except Exception:
        return now_utc()


def item_id(title: str, url: str) -> str:
    raw = f"{title.lower()}|{urlparse(url).netloc}{urlparse(url).path}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def category_for(text: str) -> str:
    low = f" {text.lower()} "
    best = "General Browns"
    best_score = 0
    for cat, terms in CATEGORIES.items():
        score = sum(1 for t in terms if t in low)
        if score > best_score:
            best = cat
            best_score = score
    return best


def score_item(title: str, summary: str, source_weight: int) -> tuple[int, List[str]]:
    low = f" {title} {summary} ".lower()
    score = source_weight
    reasons = [f"source_weight +{source_weight}"]

    for term in PRIORITY_TERMS:
        if term in low:
            add = 8 if term in title.lower() else 3
            score += add
            reasons.append(f"{term} +{add}")

    for term in NOISE_TERMS:
        if term in low:
            score -= 8
            reasons.append(f"{term} -8")

    return score, reasons


def load_config() -> Dict[str, Any]:
    if CONFIG_PATH.exists():
        try:
            return yaml.safe_load(CONFIG_PATH.read_text()) or {}
        except Exception:
            return {}
    return {}


def harvest_items(hours: int) -> List[Dict[str, Any]]:
    cutoff = now_utc() - dt.timedelta(hours=hours)
    items: List[Dict[str, Any]] = []
    seen = set()

    for source in SOURCE_FEEDS:
        feed = feedparser.parse(source["url"])
        for entry in feed.entries[:25]:
            title = clean_text(getattr(entry, "title", ""))
            url = getattr(entry, "link", "")
            summary = clean_text(getattr(entry, "summary", "")) or clean_text(getattr(entry, "description", ""))
            published = parse_date(getattr(entry, "published_parsed", None) or getattr(entry, "published", None) or getattr(entry, "updated", None))

            if not title or not url:
                continue
            if published < cutoff:
                continue

            ident = item_id(title, url)
            if ident in seen:
                continue
            seen.add(ident)

            combined = f"{title} {summary}"
            score, reasons = score_item(title, summary, int(source["weight"]))

            if score < 10:
                continue

            domain = urlparse(url).netloc.replace("www.", "")

            items.append({
                "id": ident,
                "title": title,
                "url": url,
                "source_name": source["name"],
                "source_type": "article",
                "source_tier_label": source["tier"],
                "credibility_score": min(100, max(0, int(source["weight"]) * 4)),
                "domain": domain,
                "category": category_for(combined),
                "published": published.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "summary": summary[:1200] if summary else "No source summary available.",
                "score": score,
                "score_reasons": reasons,
                "is_new": True,
            })

    items.sort(key=lambda x: (x["score"], x["published"]), reverse=True)
    return items


def fallback_brief(items: List[Dict[str, Any]], hours: int, status: str) -> str:
    if not items:
        return (
            "# Executive Brief\n"
            f"No real Browns source items were collected in the latest {hours}-hour run.\n\n"
            "# Strong Signals\n"
            "No real source-backed strong signals available.\n\n"
            "# Developing Signals\n"
            "No real source-backed developing signals available.\n\n"
            "# Noise / Low-Confidence Chatter\n"
            "No fake or fallback rumor items were generated.\n\n"
            "# Watch List\n"
            "Check source configuration, network access, and feed availability."
        )

    lines = [
        "# Executive Brief",
        f"Collected {len(items)} real Browns-related public source items over the latest {hours} hours.",
        f"AI provider status: {status}. This is a non-AI fallback brief generated from real source cards only.",
        "",
        "# Strong Signals",
    ]

    for i, item in enumerate(items[:8], 1):
        lines.append(f"- [{i}] {item['title']} — {item['source_name']} ({item['source_tier_label']})")

    lines += [
        "",
        "# Watch List",
        "- Re-run with OpenRouter enabled for deeper source-grounded synthesis.",
        "- Verify source links before treating any item as confirmed.",
    ]
    return "\n".join(lines)


def call_openrouter(messages, model=None, temperature=0.2, max_tokens=3500, timeout=120):
    api_key = os.getenv("OPENROUTER_API_KEY")
    selected_model = model or os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)

    if not api_key:
        return {"ok": False, "content": "", "model": selected_model, "status": "missing_api_key"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": os.getenv("OPENROUTER_REFERER", DEFAULT_REFERER),
        "X-OpenRouter-Title": os.getenv("OPENROUTER_APP_TITLE", DEFAULT_TITLE),
    }

    payload = {
        "model": selected_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        res = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=timeout)
        if not res.ok:
            return {"ok": False, "content": "", "model": selected_model, "status": "openrouter_error"}
        data = res.json()
        content = data["choices"][0]["message"]["content"]
        return {"ok": True, "content": content, "model": selected_model, "status": "ok"}
    except Exception:
        return {"ok": False, "content": "", "model": selected_model, "status": "openrouter_error"}


def make_ai_brief(items: List[Dict[str, Any]], hours: int, skip_ai: bool):
    model = os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)

    if skip_ai:
        return fallback_brief(items, hours, "skipped"), "skipped", model

    if not items:
        return fallback_brief([], hours, "fallback"), "fallback", model

    source_notes = []
    for i, item in enumerate(items[:35], 1):
        source_notes.append(
            f"[{i}]\n"
            f"title: {item['title']}\n"
            f"url: {item['url']}\n"
            f"source_name: {item['source_name']}\n"
            f"source_type: {item['source_type']}\n"
            f"source_tier_label: {item['source_tier_label']}\n"
            f"credibility_score: {item['credibility_score']}\n"
            f"category: {item['category']}\n"
            f"published: {item['published']}\n"
            f"summary: {item['summary']}\n"
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are Sean's Cleveland Browns intelligence analyst. Produce a source-grounded Browns "
                "intelligence briefing from collected public articles. Do not invent facts. Separate confirmed "
                "reporting from opinion/speculation. Treat official/team and established reporting as strongest. "
                "Use source numbers like [1], [2]. If the data is thin, say so."
            ),
        },
        {
            "role": "user",
            "content": (
                "Create a detailed Browns Intelligence Report using only the source notes below.\n\n"
                "Required sections:\n"
                "# Executive Brief\n# Strong Signals\n# Developing Signals\n# Noise / Low-Confidence Chatter\n"
                "# QB Room Movement\n# Roster / Injury Movement\n# Draft Intel\n# Front Office / Coaching\n"
                "# Market / Betting Implications\n# What Changed Since Last Run\n# Watch List\n# Questions for Tomorrow\n\n"
                + "\n---\n".join(source_notes)
            ),
        },
    ]

    result = call_openrouter(messages, model=model)
    if result["ok"]:
        return result["content"], result["status"], result["model"]

    return fallback_brief(items, hours, result["status"]), result["status"], result["model"]


def write_json_outputs(output: Dict[str, Any]) -> None:
    for folder in [PUBLIC_DIR, DOCS_DIR, PUBLIC_ARCHIVE, DOCS_ARCHIVE]:
        folder.mkdir(parents=True, exist_ok=True)

    for path in [PUBLIC_DIR / "latest.json", DOCS_DIR / "latest.json"]:
        path.write_text(json.dumps(output, indent=2), encoding="utf-8")

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")
    archive_name = f"report_{stamp}.json"

    for archive_dir in [PUBLIC_ARCHIVE, DOCS_ARCHIVE]:
        archive_path = archive_dir / archive_name
        archive_path.write_text(json.dumps(output, indent=2), encoding="utf-8")

        index_path = archive_dir / "index.json"
        if index_path.exists():
            try:
                index = json.loads(index_path.read_text())
            except Exception:
                index = {"reports": []}
        else:
            index = {"reports": []}

        rel_path = f"archive/{archive_name}"
        index["reports"] = [
            {
                "path": rel_path,
                "generated_at": output["generated_at"],
                "item_count": len(output["items"]),
                "new_count": sum(1 for item in output["items"] if item.get("is_new")),
                "ai_provider": output["ai_provider"],
                "ai_provider_status": output["ai_provider_status"],
                "ai_model": output["ai_model"],
            }
        ] + [r for r in index.get("reports", []) if r.get("path") != rel_path]

        index["reports"] = index["reports"][:50]
        index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")


def test_openrouter_connection() -> int:
    result = call_openrouter([{"role": "user", "content": "Say: OpenRouter connected for Browns bot."}], max_tokens=50)
    if result["ok"]:
        print("SUCCESS: OpenRouter connected.")
        print(f"Model: {result['model']}")
        print(result["content"])
        return 0
    print(f"FAILURE: {result['status']}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Browns Intelligence Bot")
    parser.add_argument("--hours", type=int, default=72)
    parser.add_argument("--skip-ai", action="store_true")
    parser.add_argument("--test-openrouter", action="store_true")
    parser.add_argument("--memory-stats", action="store_true")
    args = parser.parse_args()

    if args.test_openrouter:
        return test_openrouter_connection()

    if args.memory_stats:
        print("Memory database is not enabled in this no-mock build.")
        return 0

    items = harvest_items(args.hours)
    ai_brief, status, model = make_ai_brief(items, args.hours, args.skip_ai)

    output = {
        "generated_at": now_utc().strftime("%Y-%m-%d %H:%M:%S UTC"),
        "hours": args.hours,
        "ai_provider": "openrouter",
        "ai_provider_status": status,
        "ai_model": model,
        "ai_brief": ai_brief,
        "items": items,
    }

    write_json_outputs(output)

    print(f"Latest JSON: {PUBLIC_DIR / 'latest.json'}")
    print(f"Docs mirror: {DOCS_DIR / 'latest.json'}")
    print(f"Items collected: {len(items)}")
    print(f"AI status: {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
