#!/usr/bin/env python3
"""Update a Google Doc with recent Cleveland Browns Daily YouTube transcripts.

This script is designed for unattended GitHub Actions runs.

Required environment variables:
  GOOGLE_SERVICE_ACCOUNT_JSON  Raw service-account JSON or base64-encoded JSON
  GOOGLE_DOC_ID                Target Google Doc ID

Optional environment variables:
  BROWNS_YOUTUBE_CHANNEL_URL   Defaults to https://www.youtube.com/@browns/videos
  MAX_BROWNS_DAILY_VIDEOS      Defaults to 5
  TRANSCRIPT_LANGUAGES         Defaults to en,en-US,en-orig
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

import yt_dlp
from google.oauth2 import service_account
from googleapiclient.discovery import build

CHANNEL_URL = os.getenv("BROWNS_YOUTUBE_CHANNEL_URL", "https://www.youtube.com/@browns/videos")
MAX_VIDEOS = int(os.getenv("MAX_BROWNS_DAILY_VIDEOS", "5"))
TRANSCRIPT_LANGUAGES = [lang.strip() for lang in os.getenv("TRANSCRIPT_LANGUAGES", "en,en-US,en-orig").split(",") if lang.strip()]
DOC_ID = os.getenv("GOOGLE_DOC_ID")
SERVICE_ACCOUNT_ENV = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")

TITLE_PATTERNS = (
    "cleveland browns daily",
    "browns daily",
)

SCOPES = ["https://www.googleapis.com/auth/documents"]


@dataclass(frozen=True)
class Video:
    title: str
    url: str
    video_id: str
    upload_date: str | None = None


@dataclass(frozen=True)
class Transcript:
    video: Video
    text: str


def log(message: str) -> None:
    print(f"[browns-daily-transcripts] {message}", flush=True)


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


def youtube_watch_url(video_id: str | None, fallback_url: str | None = None) -> str:
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    return fallback_url or ""


def normalize_upload_date(raw: str | None) -> str | None:
    if not raw:
        return None
    if re.fullmatch(r"\d{8}", raw):
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw


def is_browns_daily_title(title: str) -> bool:
    lowered = title.lower()
    return any(pattern in lowered for pattern in TITLE_PATTERNS)


def find_recent_browns_daily_videos() -> list[Video]:
    log(f"Scanning channel: {CHANNEL_URL}")
    opts = {
        "quiet": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "playlistend": 40,
        "ignoreerrors": True,
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(CHANNEL_URL, download=False)

    entries = info.get("entries") or []
    videos: list[Video] = []

    for entry in entries:
        if not entry:
            continue
        title = entry.get("title") or ""
        video_id = entry.get("id")
        url = youtube_watch_url(video_id, entry.get("url"))
        if title and is_browns_daily_title(title):
            videos.append(
                Video(
                    title=title,
                    url=url,
                    video_id=video_id or url,
                    upload_date=normalize_upload_date(entry.get("upload_date")),
                )
            )
        if len(videos) >= MAX_VIDEOS:
            break

    log(f"Found {len(videos)} Browns Daily videos.")
    return videos


def choose_subtitle_file(directory: Path) -> Path | None:
    subtitle_files = sorted(directory.glob("*.vtt")) + sorted(directory.glob("*.srv3")) + sorted(directory.glob("*.ttml"))
    if not subtitle_files:
        return None

    # Prefer English-looking files first, but allow any downloaded subtitle file as fallback.
    preferred = [p for p in subtitle_files if any(f".{lang}." in p.name or p.name.endswith(f".{lang}.vtt") for lang in TRANSCRIPT_LANGUAGES)]
    return preferred[0] if preferred else subtitle_files[0]


def download_subtitle(video: Video, *, auto: bool) -> Path | None:
    with tempfile.TemporaryDirectory() as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        outtmpl = str(tmpdir / "%(id)s.%(ext)s")
        opts = {
            "quiet": True,
            "skip_download": True,
            "writesubtitles": not auto,
            "writeautomaticsub": auto,
            "subtitleslangs": TRANSCRIPT_LANGUAGES,
            "subtitlesformat": "vtt/best",
            "outtmpl": outtmpl,
            "ignoreerrors": True,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([video.url])
        except Exception as exc:  # noqa: BLE001
            log(f"Subtitle download failed for {video.title!r}: {exc}")
            return None

        subtitle_file = choose_subtitle_file(tmpdir)
        if subtitle_file is None:
            return None

        persistent = Path(tempfile.gettempdir()) / f"{video.video_id}.{'auto' if auto else 'manual'}.{subtitle_file.suffix.lstrip('.')}"
        persistent.write_text(subtitle_file.read_text(encoding="utf-8", errors="ignore"), encoding="utf-8")
        return persistent


def clean_vtt(raw: str) -> str:
    cleaned_lines: list[str] = []
    last_line = ""

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("WEBVTT"):
            continue
        if line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if "-->" in line:
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if line.startswith("NOTE"):
            continue

        # Remove common VTT tags and inline timestamps.
        line = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", line)
        line = re.sub(r"</?c[^>]*>", "", line)
        line = re.sub(r"</?v[^>]*>", "", line)
        line = re.sub(r"<[^>]+>", "", line)
        line = line.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")
        line = re.sub(r"\[(music|applause|laughter|inaudible)\]", "", line, flags=re.IGNORECASE).strip()
        line = re.sub(r"\s+", " ", line).strip()

        if not line or line == last_line:
            continue
        cleaned_lines.append(line)
        last_line = line

    # YouTube auto-captions can repeat overlapping fragments. Keep exact de-dupe conservative.
    result: list[str] = []
    seen_recent: list[str] = []
    for line in cleaned_lines:
        key = line.lower()
        if key in seen_recent:
            continue
        result.append(line)
        seen_recent.append(key)
        if len(seen_recent) > 8:
            seen_recent.pop(0)

    return "\n".join(result).strip()


def get_transcript(video: Video) -> Transcript | None:
    log(f"Pulling transcript: {video.title}")

    subtitle_path = download_subtitle(video, auto=False)
    if subtitle_path is None:
        subtitle_path = download_subtitle(video, auto=True)

    if subtitle_path is None:
        log(f"No captions found, skipping: {video.title}")
        return None

    raw = subtitle_path.read_text(encoding="utf-8", errors="ignore")
    text = clean_vtt(raw)
    try:
        subtitle_path.unlink(missing_ok=True)
    except Exception:
        pass

    if not text:
        log(f"Caption file was empty after cleaning, skipping: {video.title}")
        return None

    return Transcript(video=video, text=text)


def build_document(transcripts: Iterable[Transcript]) -> str:
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %I:%M %p %Z")
    transcripts = list(transcripts)

    parts = [
        "# Browns Daily Transcript Feed",
        "",
        f"Last updated: {now}",
        "",
        "This document is automatically refreshed from recent Cleveland Browns Daily YouTube captions so NotebookLM can use it as a synced source.",
        "",
    ]

    if not transcripts:
        parts.extend([
            "## No transcripts available",
            "",
            "No Browns Daily captions were found during this run.",
            "",
        ])
        return "\n".join(parts)

    for idx, item in enumerate(transcripts, start=1):
        video = item.video
        parts.extend([
            f"## {idx}. {video.title}",
            "",
            f"YouTube: {video.url}",
        ])
        if video.upload_date:
            parts.append(f"Upload date: {video.upload_date}")
        parts.extend([
            "",
            "### Transcript",
            "",
            item.text,
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

    videos = find_recent_browns_daily_videos()
    transcripts: list[Transcript] = []

    for video in videos:
        transcript = get_transcript(video)
        if transcript is not None:
            transcripts.append(transcript)

    if not transcripts:
        log("No transcripts were collected. Updating doc with a no-transcripts status page.")

    document_text = build_document(transcripts)
    replace_google_doc_text(DOC_ID, document_text)


if __name__ == "__main__":
    main()
