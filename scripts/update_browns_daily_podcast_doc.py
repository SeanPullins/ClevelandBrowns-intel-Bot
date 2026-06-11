#!/usr/bin/env python3
"""Transcribe recent Cleveland Browns Daily podcast episodes and update a Google Doc.

This avoids YouTube's bot checks by using the public podcast RSS/audio feed.

Required environment variables:
  GOOGLE_SERVICE_ACCOUNT_JSON  Raw service-account JSON or base64-encoded JSON
  GOOGLE_DOC_ID                Target Google Doc ID

Optional environment variables:
  PODCAST_RSS_URL              Direct RSS feed URL. If omitted, script resolves Apple podcast ID.
  APPLE_PODCAST_ID             Defaults to 452827225
  MAX_PODCAST_EPISODES         Defaults to 1
  WHISPER_MODEL_SIZE           Defaults to tiny. Good options: tiny, base, small
  EPISODE_TITLE_FILTERS        Defaults to Cleveland Browns Daily,Browns Daily
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

import feedparser
import requests
from dateutil import parser as date_parser
from faster_whisper import WhisperModel
from google.oauth2 import service_account
from googleapiclient.discovery import build

DOC_ID = os.getenv("GOOGLE_DOC_ID")
SERVICE_ACCOUNT_ENV = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
APPLE_PODCAST_ID = os.getenv("APPLE_PODCAST_ID", "452827225")
PODCAST_RSS_URL = os.getenv("PODCAST_RSS_URL", "").strip()
MAX_EPISODES = int(os.getenv("MAX_PODCAST_EPISODES", "1"))
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "tiny")
EPISODE_TITLE_FILTERS = [
    item.strip().lower()
    for item in os.getenv("EPISODE_TITLE_FILTERS", "Cleveland Browns Daily,Browns Daily").split(",")
    if item.strip()
]

SCOPES = ["https://www.googleapis.com/auth/documents"]
USER_AGENT = "Mozilla/5.0 BrownsDailyTranscriptBot/1.0"


@dataclass(frozen=True)
class Episode:
    title: str
    audio_url: str
    page_url: str | None = None
    published: str | None = None
    summary: str | None = None


@dataclass(frozen=True)
class Transcript:
    episode: Episode
    text: str


def log(message: str) -> None:
    print(f"[browns-daily-podcast] {message}", flush=True)


def fail(message: str, code: int = 1) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def load_service_account_info() -> dict:
    if not SERVICE_ACCOUNT_ENV:
        fail("Missing GOOGLE_SERVICE_ACCOUNT_JSON secret.")

    raw = SERVICE_ACCOUNT_ENV.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        return json.loads(decoded)
    except Exception as exc:  # noqa: BLE001
        fail(f"GOOGLE_SERVICE_ACCOUNT_JSON is neither raw JSON nor base64 JSON: {exc}")


def resolve_rss_url() -> str:
    if PODCAST_RSS_URL:
        log(f"Using PODCAST_RSS_URL: {PODCAST_RSS_URL}")
        return PODCAST_RSS_URL

    lookup_url = f"https://itunes.apple.com/lookup?id={APPLE_PODCAST_ID}"
    log(f"Resolving Apple podcast RSS feed from: {lookup_url}")
    response = requests.get(lookup_url, headers={"User-Agent": USER_AGENT}, timeout=30)
    response.raise_for_status()
    data = response.json()
    results = data.get("results") or []
    if not results:
        fail(f"Apple lookup returned no results for podcast ID {APPLE_PODCAST_ID}.")
    feed_url = results[0].get("feedUrl")
    if not feed_url:
        fail("Apple lookup did not include a feedUrl.")
    log(f"Resolved RSS feed: {feed_url}")
    return feed_url


def normalize_date(entry: dict) -> str | None:
    raw = entry.get("published") or entry.get("updated") or entry.get("pubDate")
    if not raw:
        return None
    try:
        parsed = date_parser.parse(raw)
        return parsed.strftime("%Y-%m-%d %I:%M %p %Z").strip()
    except Exception:
        return str(raw)


def get_audio_url(entry: dict) -> str | None:
    for enclosure in entry.get("enclosures") or []:
        href = enclosure.get("href")
        if href:
            return href
    for link in entry.get("links") or []:
        href = link.get("href")
        link_type = (link.get("type") or "").lower()
        rel = (link.get("rel") or "").lower()
        if href and ("audio" in link_type or rel == "enclosure"):
            return href
    return None


def looks_like_browns_daily(entry: dict) -> bool:
    blob = " ".join(
        str(entry.get(key) or "")
        for key in ("title", "summary", "description")
    ).lower()
    return any(token in blob for token in EPISODE_TITLE_FILTERS)


def get_recent_episodes() -> list[Episode]:
    feed_url = resolve_rss_url()
    log("Parsing podcast feed.")
    parsed = feedparser.parse(feed_url)
    if parsed.bozo:
        log(f"Feed parser warning: {parsed.bozo_exception}")
    entries = parsed.entries or []
    if not entries:
        fail("No podcast episodes found in RSS feed.")

    selected: list[Episode] = []
    for entry in entries:
        if not looks_like_browns_daily(entry):
            continue
        audio_url = get_audio_url(entry)
        if not audio_url:
            log(f"Skipping episode with no audio enclosure: {entry.get('title', 'Untitled')}")
            continue
        selected.append(
            Episode(
                title=entry.get("title") or "Untitled episode",
                audio_url=audio_url,
                page_url=entry.get("link"),
                published=normalize_date(entry),
                summary=re.sub(r"<[^>]+>", "", entry.get("summary") or "").strip() or None,
            )
        )
        if len(selected) >= MAX_EPISODES:
            break

    if not selected:
        log("No title-filtered episodes found. Falling back to newest audio episode.")
        for entry in entries:
            audio_url = get_audio_url(entry)
            if not audio_url:
                continue
            selected.append(
                Episode(
                    title=entry.get("title") or "Untitled episode",
                    audio_url=audio_url,
                    page_url=entry.get("link"),
                    published=normalize_date(entry),
                    summary=re.sub(r"<[^>]+>", "", entry.get("summary") or "").strip() or None,
                )
            )
            break

    log(f"Selected {len(selected)} podcast episode(s).")
    for episode in selected:
        log(f"Selected episode: {episode.title}")
    return selected


def extension_from_url(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in {".mp3", ".m4a", ".mp4", ".wav", ".aac"}:
        return suffix
    return ".mp3"


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)[:80] or "episode"


def download_audio(episode: Episode) -> Path:
    suffix = extension_from_url(episode.audio_url)
    audio_path = Path(tempfile.gettempdir()) / f"{safe_filename(episode.title)}{suffix}"
    log(f"Downloading audio: {episode.audio_url}")
    with requests.get(episode.audio_url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=60) as response:
        response.raise_for_status()
        with audio_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    size_mb = audio_path.stat().st_size / (1024 * 1024)
    log(f"Downloaded audio to {audio_path} ({size_mb:.1f} MB).")
    return audio_path


def transcribe_audio(audio_path: Path) -> str:
    log(f"Loading Whisper model: {WHISPER_MODEL_SIZE}")
    # int8 keeps GitHub Actions CPU memory usage manageable.
    model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    log("Transcribing audio. This can take several minutes.")
    segments, info = model.transcribe(str(audio_path), beam_size=1, language="en", vad_filter=True)
    log(f"Detected language: {info.language} probability={info.language_probability:.2f}")

    lines: list[str] = []
    for segment in segments:
        text = re.sub(r"\s+", " ", segment.text).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()


def build_document(transcripts: Iterable[Transcript]) -> str:
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %I:%M %p %Z")
    transcripts = list(transcripts)

    parts = [
        "# Browns Daily Podcast Transcript Feed",
        "",
        f"Last updated: {now}",
        "",
        "This document is automatically refreshed from the Cleveland Browns podcast audio feed and transcribed with Whisper so NotebookLM can use it as a synced source.",
        "",
    ]

    if not transcripts:
        parts.extend([
            "## No transcripts available",
            "",
            "No podcast audio could be transcribed during this run. Check the GitHub Actions logs.",
            "",
        ])
        return "\n".join(parts)

    for idx, item in enumerate(transcripts, start=1):
        episode = item.episode
        parts.extend([
            f"## {idx}. {episode.title}",
            "",
        ])
        if episode.published:
            parts.append(f"Published: {episode.published}")
        if episode.page_url:
            parts.append(f"Episode page: {episode.page_url}")
        parts.append(f"Audio source: {episode.audio_url}")
        if episode.summary:
            parts.extend(["", "### Episode summary from feed", "", episode.summary])
        parts.extend([
            "",
            "### Transcript",
            "",
            item.text or "Transcript was empty.",
            "",
            "---",
            "",
        ])

    return "\n".join(parts).strip() + "\n"


def get_docs_service():
    info = load_service_account_info()
    credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("docs", "v1", credentials=credentials)


def replace_google_doc_text(document_id: str, text: str) -> None:
    service = get_docs_service()
    document = service.documents().get(documentId=document_id).execute()
    body = document.get("body", {}).get("content", [])
    end_index = body[-1].get("endIndex", 1) if body else 1

    requests = []
    if end_index > 2:
        requests.append({"deleteContentRange": {"range": {"startIndex": 1, "endIndex": end_index - 1}}})
    requests.append({"insertText": {"location": {"index": 1}, "text": text}})

    service.documents().batchUpdate(documentId=document_id, body={"requests": requests}).execute()
    log("Google Doc updated successfully.")


def main() -> None:
    if not DOC_ID:
        fail("Missing GOOGLE_DOC_ID secret.")

    episodes = get_recent_episodes()
    transcripts: list[Transcript] = []

    for episode in episodes:
        audio_path: Path | None = None
        try:
            audio_path = download_audio(episode)
            text = transcribe_audio(audio_path)
            transcripts.append(Transcript(episode=episode, text=text))
        except Exception as exc:  # noqa: BLE001
            log(f"Failed to process episode {episode.title!r}: {exc}")
        finally:
            if audio_path:
                try:
                    audio_path.unlink(missing_ok=True)
                except Exception:
                    pass

    document_text = build_document(transcripts)
    replace_google_doc_text(DOC_ID, document_text)


if __name__ == "__main__":
    main()
