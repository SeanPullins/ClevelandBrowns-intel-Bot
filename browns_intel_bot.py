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
DEFAULT_REFERER = "https://seanpullins.github.io/ClevelandBrowns-intel-Bot/"
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







# --- BROWNS MEDIA COLLECTION OVERRIDE START ---

# This override keeps the existing working article pipeline, then adds
# Browns-only YouTube and podcast discovery. It also filters every returned item
# so unrelated "Brown"/non-Browns links are removed before JSON is written.

BROWNS_POSITIVE_TERMS = [
    "cleveland browns",
    "browns",
    "dawg pound",
    "orange and brown",
    "myles garrett",
    "kevin stefanski",
    "andrew berry",
    "shedeur sanders",
    "dillon gabriel",
    "joe flacco",
    "kenny pickett",
    "deshaun watson",
]

BROWNS_NEGATIVE_TERMS = [
    "brown university",
    "brown bears",
    "brown county",
    "brown trout",
    "antonio brown",
    "james brown",
    "charlie brown",
    "cleveland guardians",
    "cleveland cavaliers",
    "cleveland monsters",
    "st. louis browns",
]

BROWNS_CONTEXT_TERMS = [
    "nfl",
    "football",
    "quarterback",
    "qb",
    "otas",
    "training camp",
    "roster",
    "draft",
    "coach",
    "injury",
    "contract",
    "offense",
    "defense",
    "wide receiver",
    "running back",
    "linebacker",
    "edge",
    "stadium",
]

KNOWN_BROWNS_SOURCES = [
    "cleveland browns",
    "cleveland browns daily",
    "orange and brown talk",
    "locked on browns",
    "ultimate cleveland sports show",
    "browns wire",
    "dawgs by nature",
    "cleveland.com",
    "news 5 cleveland",
    "wkyc",
    "espn cleveland",
    "92.3 the fan",
]

YOUTUBE_BROWNS_SEARCHES = [
    "Cleveland Browns official latest",
    "Cleveland Browns Daily",
    "Cleveland Browns quarterback news",
    "Cleveland Browns roster news",
    "Cleveland Browns OTAs",
    "Cleveland Browns draft news",
    "Orange and Brown Talk Cleveland Browns",
    "Locked On Browns Cleveland Browns",
    "Ultimate Cleveland Sports Show Browns",
    "WKYC Cleveland Browns",
    "News 5 Cleveland Browns",
    "cleveland.com Browns",
]

PODCAST_BROWNS_SEARCHES = [
    "Cleveland Browns Daily",
    "Orange and Brown Talk Cleveland Browns",
    "Locked On Browns",
    "Ultimate Cleveland Sports Show Browns",
    "ESPN Cleveland Browns",
    "Browns Wire podcast",
]


def _clean_media_text(value):
    try:
        return clean_text(value or "")
    except Exception:
        import html as _html
        import re as _re
        from bs4 import BeautifulSoup as _BeautifulSoup
        value = _html.unescape(value or "")
        value = _BeautifulSoup(value, "html.parser").get_text(" ", strip=True)
        return _re.sub(r"\s+", " ", value).strip()


def _known_browns_source(source_name="", url=""):
    haystack = f" {source_name} {url} ".lower()
    return any(term in haystack for term in KNOWN_BROWNS_SOURCES)


def strict_browns_relevant(title, summary="", source_name="", url=""):
    text = f" {title} {summary} {source_name} {url} ".lower()

    if any(term in text for term in BROWNS_NEGATIVE_TERMS):
        return False

    if "cleveland browns" in text:
        return True

    if any(term in text for term in [
        "dawg pound",
        "orange and brown",
        "myles garrett",
        "kevin stefanski",
        "andrew berry",
    ]):
        return True

    if any(term in text for term in [
        "shedeur sanders",
        "dillon gabriel",
        "joe flacco",
        "kenny pickett",
        "deshaun watson",
    ]):
        return "browns" in text or "cleveland" in text or _known_browns_source(source_name, url)

    # "Browns" is acceptable only with NFL/sports context or a known Browns source.
    if "browns" in text:
        return _known_browns_source(source_name, url) or any(term in text for term in BROWNS_CONTEXT_TERMS)

    # For known Browns podcasts/channels, allow sports/NFL episode titles even if "Browns"
    # is only in the podcast/channel name.
    if _known_browns_source(source_name, url):
        return any(term in text for term in BROWNS_CONTEXT_TERMS)

    return False


def _media_parse_date(value):
    try:
        return parse_date(value)
    except Exception:
        import datetime as _dt
        if isinstance(value, (int, float)):
            return _dt.datetime.fromtimestamp(value, tz=_dt.timezone.utc)
        if isinstance(value, str) and value.isdigit() and len(value) == 8:
            try:
                return _dt.datetime.strptime(value, "%Y%m%d").replace(tzinfo=_dt.timezone.utc)
            except Exception:
                pass
        return now_utc()


def _media_domain(url):
    from urllib.parse import urlparse as _urlparse
    return _urlparse(url or "").netloc.replace("www.", "").lower()


def _media_id(title, url):
    import hashlib as _hashlib
    from urllib.parse import urlparse as _urlparse
    parsed = _urlparse(url or "")
    raw = f"{title.lower()}|{parsed.netloc}{parsed.path}".encode("utf-8")
    return _hashlib.sha1(raw).hexdigest()[:16]


def _media_category(title, summary):
    try:
        return category_for(f"{title} {summary}")
    except Exception:
        return "General Browns"


def _media_score(title, summary, source_weight, source_type):
    text = f" {title} {summary} ".lower()
    score = int(source_weight)
    reasons = [f"source_weight +{source_weight}"]

    if source_type == "youtube":
        score += 4
        reasons.append("youtube +4")
    elif source_type == "podcast":
        score += 5
        reasons.append("podcast +5")

    for term in BROWNS_POSITIVE_TERMS:
        if term in text:
            add = 8 if term in title.lower() else 3
            score += add
            reasons.append(f"{term} +{add}")

    for term in ["trade proposal", "bold prediction", "dream scenario", "way-too-early", "fan proposal"]:
        if term in text:
            score -= 8
            reasons.append(f"{term} -8")

    return score, reasons


def _make_media_item(title, url, summary, published, source_name, source_type, tier, weight):
    title = _clean_media_text(title)
    summary = _clean_media_text(summary)
    source_name = _clean_media_text(source_name or source_type.title())
    url = (url or "").strip()

    if not title or not url:
        return None

    if not strict_browns_relevant(title, summary, source_name, url):
        return None

    score, reasons = _media_score(title, summary, weight, source_type)

    if score < 10:
        return None

    return {
        "id": _media_id(title, url),
        "title": title,
        "url": url,
        "source_name": source_name,
        "source_type": source_type,
        "source_tier_label": tier,
        "credibility_score": min(100, max(0, int(weight) * 4)),
        "domain": _media_domain(url),
        "category": _media_category(title, summary),
        "published": published.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "summary": summary[:1500] if summary else "No source summary available.",
        "score": score,
        "score_reasons": reasons,
        "is_new": True,
    }


def _run_ytdlp_search(query, limit=8):
    import json as _json
    import subprocess as _subprocess

    cmd = [
        "yt-dlp",
        "--dump-json",
        "--skip-download",
        "--no-warnings",
        "--ignore-errors",
        f"ytsearch{limit}:{query}",
    ]

    try:
        proc = _subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except FileNotFoundError:
        print("WARNING: yt-dlp is not installed. Skipping YouTube collection.")
        return []
    except Exception as exc:
        print(f"WARNING: YouTube search failed for {query!r}: {exc}")
        return []

    rows = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(_json.loads(line))
        except Exception:
            continue

    return rows


def harvest_youtube_links(hours):
    import datetime as _dt

    cutoff = now_utc() - _dt.timedelta(hours=hours)
    items = []

    for query in YOUTUBE_BROWNS_SEARCHES:
        for row in _run_ytdlp_search(query, limit=8):
            title = row.get("title") or ""
            url = row.get("webpage_url") or row.get("url") or ""

            if url and not url.startswith("http"):
                url = f"https://www.youtube.com/watch?v={url}"

            channel = row.get("channel") or row.get("uploader") or "YouTube"
            desc = row.get("description") or ""
            published = _media_parse_date(row.get("timestamp") or row.get("upload_date") or row.get("release_timestamp"))

            if published < cutoff:
                continue

            weight = 14 if _known_browns_source(channel, url) else 8
            tier = "Browns YouTube" if _known_browns_source(channel, url) else "YouTube"

            item = _make_media_item(
                title=title,
                url=url,
                summary=desc,
                published=published,
                source_name=channel,
                source_type="youtube",
                tier=tier,
                weight=weight,
            )

            if item:
                items.append(item)

    return items


def _itunes_podcast_feeds(search_term, limit=2):
    import requests as _requests
    from urllib.parse import quote_plus as _quote_plus

    try:
        url = f"https://itunes.apple.com/search?media=podcast&limit={limit}&term={_quote_plus(search_term)}"
        data = _requests.get(url, timeout=20).json()
    except Exception:
        return []

    feeds = []
    for result in data.get("results", []):
        feed_url = result.get("feedUrl")
        name = result.get("collectionName") or search_term
        if feed_url:
            feeds.append({"name": name, "url": feed_url})

    return feeds


def harvest_podcast_links(hours):
    import datetime as _dt
    import feedparser as _feedparser

    cutoff = now_utc() - _dt.timedelta(hours=hours)
    items = []
    seen_feeds = set()

    feeds = []
    for term in PODCAST_BROWNS_SEARCHES:
        feeds.extend(_itunes_podcast_feeds(term, limit=2))

    for feed_meta in feeds:
        feed_url = feed_meta.get("url", "")
        podcast_name = _clean_media_text(feed_meta.get("name", "Podcast"))

        if not feed_url or feed_url in seen_feeds:
            continue

        seen_feeds.add(feed_url)

        try:
            feed = _feedparser.parse(feed_url)
        except Exception:
            continue

        for entry in feed.entries[:12]:
            published = _media_parse_date(
                getattr(entry, "published_parsed", None)
                or getattr(entry, "published", None)
                or getattr(entry, "updated", None)
            )

            if published < cutoff:
                continue

            title = getattr(entry, "title", "")
            link = getattr(entry, "link", "") or feed_url
            summary = getattr(entry, "summary", "") or getattr(entry, "description", "")

            weight = 14 if _known_browns_source(podcast_name, link) else 8
            tier = "Browns Podcast" if _known_browns_source(podcast_name, link) else "Podcast"

            item = _make_media_item(
                title=title,
                url=link,
                summary=summary,
                published=published,
                source_name=podcast_name,
                source_type="podcast",
                tier=tier,
                weight=weight,
            )

            if item:
                items.append(item)

    return items


def _dedupe_and_browns_filter(items):
    seen = set()
    output = []

    for item in items:
        title = item.get("title", "")
        summary = item.get("summary", "")
        source_name = item.get("source_name", "")
        url = item.get("url", "")

        if not strict_browns_relevant(title, summary, source_name, url):
            continue

        ident = item.get("id") or _media_id(title, url)

        if ident in seen:
            continue

        seen.add(ident)
        output.append(item)

    output.sort(key=lambda x: (x.get("score", 0), x.get("published", "")), reverse=True)
    return output


def source_type_counts(items):
    counts = {"article": 0, "youtube": 0, "podcast": 0}

    for item in items:
        source_type = item.get("source_type") or "article"
        counts[source_type] = counts.get(source_type, 0) + 1

    return counts


try:
    _previous_harvest_items = harvest_items
except NameError:
    _previous_harvest_items = None


def harvest_items(hours):
    items = []

    if _previous_harvest_items is not None:
        try:
            items.extend(_previous_harvest_items(hours))
        except Exception as exc:
            print(f"WARNING: existing article harvest failed: {exc}")

    try:
        items.extend(harvest_youtube_links(hours))
    except Exception as exc:
        print(f"WARNING: YouTube harvest failed: {exc}")

    try:
        items.extend(harvest_podcast_links(hours))
    except Exception as exc:
        print(f"WARNING: podcast harvest failed: {exc}")

    return _dedupe_and_browns_filter(items)


def grouped_source_notes(items):
    groups = [
        ("Articles", [item for item in items if item.get("source_type") == "article"]),
        ("YouTube", [item for item in items if item.get("source_type") == "youtube"]),
        ("Podcasts", [item for item in items if item.get("source_type") == "podcast"]),
    ]

    lines = []
    source_num = 1

    for group_name, group_items in groups:
        if not group_items:
            continue

        lines.append(f"\n## {group_name}\n")

        for item in group_items[:18]:
            lines.append(
                f"[{source_num}]\n"
                f"title: {item.get('title')}\n"
                f"url: {item.get('url')}\n"
                f"source_name: {item.get('source_name')}\n"
                f"source_type: {item.get('source_type')}\n"
                f"source_tier_label: {item.get('source_tier_label')}\n"
                f"credibility_score: {item.get('credibility_score')}\n"
                f"category: {item.get('category')}\n"
                f"published: {item.get('published')}\n"
                f"summary: {item.get('summary')}\n"
            )
            source_num += 1

            if source_num > 42:
                return "\n---\n".join(lines)

    return "\n---\n".join(lines)

# --- BROWNS MEDIA COLLECTION OVERRIDE END ---


if __name__ == "__main__":
    sys.exit(main())
