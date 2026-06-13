#!/usr/bin/env python3
"""Transcribe recent Browns-related podcast episodes and update one Google Doc.

This avoids YouTube's bot checks by using public podcast RSS/audio feeds.
The document is treated as a rolling archive: new episodes are prepended,
duplicates are skipped, and the archive is trimmed to RETAIN_EPISODES.

Required environment variables:
  GOOGLE_SERVICE_ACCOUNT_JSON  Raw service-account JSON or base64-encoded JSON
  GOOGLE_DOC_ID                Target Google Doc ID

Optional environment variables:
  PODCAST_SPECS                Pipe-separated specs: apple_id::display_name::optional_filter_terms
                               Example: 452827225::Cleveland Browns Podcast Network::Cleveland Browns Daily,Browns Daily|1033244883::The Ken Carman Show with Anthony Lima::
  MAX_EPISODES_PER_PODCAST     Defaults to 1
  RETAIN_EPISODES              Defaults to 100 total episodes across all podcasts
  WHISPER_MODEL_SIZE           Defaults to tiny. Good options: tiny, base, small
  TARGET_PODCAST_DATE          Optional target publish date, e.g. 2026-06-12 or 6/12/2026
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
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
MAX_EPISODES_PER_PODCAST = int(os.getenv("MAX_EPISODES_PER_PODCAST", "1"))
RETAIN_EPISODES = int(os.getenv("RETAIN_EPISODES", "100"))
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "tiny")
TARGET_PODCAST_DATE_RAW = os.getenv("TARGET_PODCAST_DATE", "").strip()
PODCAST_SPECS_ENV = os.getenv(
    "PODCAST_SPECS",
    "452827225::Cleveland Browns Podcast Network::Cleveland Browns Daily,Browns Daily|1033244883::The Ken Carman Show with Anthony Lima::",
)

SCOPES = ["https://www.googleapis.com/auth/documents"]
USER_AGENT = "Mozilla/5.0 BrownsPodcastTranscriptBot/1.0"


@dataclass(frozen=True)
class PodcastSpec:
    apple_id: str
    display_name: str
    filters: tuple[str, ...] = ()


@dataclass(frozen=True)
class Episode:
    podcast_name: str
    title: str
    audio_url: str
    page_url: str | None = None
    published: str | None = None
    summary: str | None = None

    @property
    def key(self) -> str:
        stable = f"{self.podcast_name}|{self.title}|{self.audio_url}"
        return hashlib.sha256(stable.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Transcript:
    episode: Episode
    text: str


def log(message: str) -> None:
    print(f"[browns-podcast-transcripts] {message}", flush=True)


def fail(message: str, code: int = 1) -> None:
    print(f"ERROR: {message}", flush=True)
    raise SystemExit(code)


def parse_target_date() -> object | None:
    """Return a date object for TARGET_PODCAST_DATE, or None when not requested."""
    raw = TARGET_PODCAST_DATE_RAW.strip()
    if not raw:
        return None

    default = datetime(datetime.now().year, 1, 1)
    try:
        return date_parser.parse(raw, default=default).date()
    except Exception as exc:  # noqa: BLE001
        fail(f"Bad TARGET_PODCAST_DATE value {raw!r}. Use YYYY-MM-DD, e.g. 2026-06-12. Error: {exc}")


def parse_entry_datetime(entry: dict) -> datetime | None:
    raw = entry.get("published") or entry.get("updated") or entry.get("pubDate")
    if not raw:
        return None
    try:
        return date_parser.parse(raw)
    except Exception:
        return None


def entry_matches_target_date(entry: dict, target_date: object | None) -> bool:
    if target_date is None:
        return True
    parsed = parse_entry_datetime(entry)
    if parsed is None:
        return False
    return parsed.date() == target_date


def parse_podcast_specs() -> list[PodcastSpec]:
    specs: list[PodcastSpec] = []
    for raw_spec in PODCAST_SPECS_ENV.split("|"):
        raw_spec = raw_spec.strip()
        if not raw_spec:
            continue
        parts = raw_spec.split("::")
        if len(parts) < 2:
            fail(f"Bad PODCAST_SPECS entry: {raw_spec!r}")
        apple_id = parts[0].strip()
        display_name = parts[1].strip() or f"Apple Podcast {apple_id}"
        filters: tuple[str, ...] = ()
        if len(parts) >= 3 and parts[2].strip():
            filters = tuple(item.strip().lower() for item in parts[2].split(",") if item.strip())
        specs.append(PodcastSpec(apple_id=apple_id, display_name=display_name, filters=filters))
    if not specs:
        fail("No podcast specs configured.")
    return specs


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


def resolve_rss_url(spec: PodcastSpec) -> str:
    lookup_url = f"https://itunes.apple.com/lookup?id={spec.apple_id}"
    log(f"Resolving RSS feed for {spec.display_name}: {lookup_url}")
    response = requests.get(lookup_url, headers={"User-Agent": USER_AGENT}, timeout=30)
    response.raise_for_status()
    data = response.json()
    results = data.get("results") or []
    if not results:
        fail(f"Apple lookup returned no results for podcast ID {spec.apple_id}.")
    feed_url = results[0].get("feedUrl")
    if not feed_url:
        fail(f"Apple lookup did not include a feedUrl for {spec.display_name}.")
    log(f"Resolved RSS feed for {spec.display_name}: {feed_url}")
    return feed_url


def normalize_date(entry: dict) -> str | None:
    parsed = parse_entry_datetime(entry)
    if parsed is not None:
        return parsed.strftime("%Y-%m-%d %I:%M %p %Z").strip()
    raw = entry.get("published") or entry.get("updated") or entry.get("pubDate")
    return str(raw) if raw else None


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


def entry_matches_filters(entry: dict, filters: tuple[str, ...]) -> bool:
    if not filters:
        return True
    blob = " ".join(str(entry.get(key) or "") for key in ("title", "summary", "description")).lower()
    return any(token in blob for token in filters)


def clean_summary(summary: str | None) -> str | None:
    if not summary:
        return None
    cleaned = re.sub(r"<[^>]+>", "", summary)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or None


def build_episode(spec: PodcastSpec, entry: dict) -> Episode | None:
    audio_url = get_audio_url(entry)
    if not audio_url:
        log(f"Skipping episode with no audio enclosure: {entry.get('title', 'Untitled')}")
        return None
    return Episode(
        podcast_name=spec.display_name,
        title=entry.get("title") or "Untitled episode",
        audio_url=audio_url,
        page_url=entry.get("link"),
        published=normalize_date(entry),
        summary=clean_summary(entry.get("summary")),
    )


def get_recent_episodes_for_podcast(spec: PodcastSpec, target_date: object | None) -> list[Episode]:
    feed_url = resolve_rss_url(spec)
    log(f"Parsing podcast feed for {spec.display_name}.")
    parsed = feedparser.parse(feed_url)
    if parsed.bozo:
        log(f"Feed parser warning for {spec.display_name}: {parsed.bozo_exception}")
    entries = parsed.entries or []
    if not entries:
        log(f"No podcast episodes found for {spec.display_name}.")
        return []

    if target_date is not None:
        log(f"Targeting episodes published on {target_date} for {spec.display_name}.")

    selected: list[Episode] = []
    filtered_out_by_date = 0
    filtered_out_by_terms = 0

    for entry in entries:
        if not entry_matches_target_date(entry, target_date):
            filtered_out_by_date += 1
            continue
        if not entry_matches_filters(entry, spec.filters):
            filtered_out_by_terms += 1
            continue
        episode = build_episode(spec, entry)
        if not episode:
            continue
        selected.append(episode)
        if len(selected) >= MAX_EPISODES_PER_PODCAST:
            break

    # Only fall back to newest audio episode for normal scheduled runs. Date-targeted runs must be exact.
    if not selected and spec.filters and target_date is None:
        log(f"No filtered episodes found for {spec.display_name}. Falling back to newest audio episode.")
        for entry in entries:
            episode = build_episode(spec, entry)
            if episode:
                selected.append(episode)
                break

    if not selected and target_date is not None:
        log(
            f"No matching episode found for {spec.display_name} on {target_date}. "
            f"Date-filtered out {filtered_out_by_date}; term-filtered out {filtered_out_by_terms}."
        )

    log(f"Selected {len(selected)} episode(s) for {spec.display_name}.")
    for episode in selected:
        log(f"Selected episode: [{episode.podcast_name}] {episode.title} | Published: {episode.published}")
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
    audio_path = Path(tempfile.gettempdir()) / f"{safe_filename(episode.podcast_name + '_' + episode.title)}{suffix}"
    log(f"Downloading audio for [{episode.podcast_name}] {episode.title}: {episode.audio_url}")
    with requests.get(episode.audio_url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=90) as response:
        response.raise_for_status()
        with audio_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    size_mb = audio_path.stat().st_size / (1024 * 1024)
    log(f"Downloaded audio to {audio_path} ({size_mb:.1f} MB).")
    return audio_path


def load_whisper_model() -> WhisperModel:
    log(f"Loading Whisper model once: {WHISPER_MODEL_SIZE}")
    return WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")


def transcribe_audio(model: WhisperModel, audio_path: Path) -> str:
    log("Transcribing audio. This can take several minutes.")
    segments, info = model.transcribe(str(audio_path), beam_size=1, language="en", vad_filter=True)
    log(f"Detected language: {info.language} probability={info.language_probability:.2f}")

    lines: list[str] = []
    for segment in segments:
        text = re.sub(r"\s+", " ", segment.text).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()


def get_docs_service():
    info = load_service_account_info()
    credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("docs", "v1", credentials=credentials)


def extract_text_from_doc(document: dict) -> str:
    chunks: list[str] = []
    for item in document.get("body", {}).get("content", []):
        paragraph = item.get("paragraph")
        if not paragraph:
            continue
        for element in paragraph.get("elements", []):
            text_run = element.get("textRun")
            if text_run and text_run.get("content"):
                chunks.append(text_run["content"])
    return "".join(chunks)


def get_google_doc_text(service, document_id: str) -> str:
    document = service.documents().get(documentId=document_id).execute()
    return extract_text_from_doc(document)


def existing_identifiers(existing_text: str) -> set[str]:
    identifiers: set[str] = set()
    identifiers.update(re.findall(r"Episode key:\s*([^\n]+)", existing_text))
    identifiers.update(re.findall(r"Audio source:\s*([^\n]+)", existing_text))
    return {item.strip() for item in identifiers if item.strip()}


def split_existing_episode_blocks(existing_text: str) -> list[str]:
    """Keep old episode blocks from the current Doc.

    The current and prior formats both separate episodes with ---.
    We only keep chunks that look like actual episode transcript blocks.
    """
    blocks: list[str] = []
    for raw_block in re.split(r"\n---\s*\n", existing_text):
        block = raw_block.strip()
        if not block:
            continue
        if "### Transcript" not in block or "Audio source:" not in block:
            continue
        # Drop old top-level feed headers accidentally attached before the first episode.
        lines = block.splitlines()
        start_idx = 0
        for idx, line in enumerate(lines):
            if line.startswith("## "):
                start_idx = idx
                break
        cleaned = "\n".join(lines[start_idx:]).strip()
        if cleaned:
            blocks.append(cleaned + "\n\n---")
    return blocks


def render_transcript_block(item: Transcript) -> str:
    episode = item.episode
    parts = [
        f"## [{episode.podcast_name}] {episode.title}",
        "",
        f"Episode key: {episode.key}",
    ]
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
    ])
    return "\n".join(parts).strip()


def build_archive_document(new_transcripts: Iterable[Transcript], existing_text: str) -> str:
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %I:%M %p %Z")

    seen_blocks: set[str] = set()
    episode_blocks: list[str] = []

    for item in new_transcripts:
        block = render_transcript_block(item)
        if block not in seen_blocks:
            seen_blocks.add(block)
            episode_blocks.append(block)

    for block in split_existing_episode_blocks(existing_text):
        key_match = re.search(r"Episode key:\s*([^\n]+)", block)
        audio_match = re.search(r"Audio source:\s*([^\n]+)", block)
        block_key = key_match.group(1).strip() if key_match else None
        block_audio = audio_match.group(1).strip() if audio_match else None
        if block_key and any(f"Episode key: {block_key}" in existing for existing in episode_blocks):
            continue
        if block_audio and any(f"Audio source: {block_audio}" in existing for existing in episode_blocks):
            continue
        if block not in seen_blocks:
            seen_blocks.add(block)
            episode_blocks.append(block.strip())

    retained_blocks = episode_blocks[:RETAIN_EPISODES]

    parts = [
        "# Browns Audio Transcript Feed",
        "",
        f"Last updated: {now}",
        f"Retention: newest {RETAIN_EPISODES} total episodes across all configured podcasts.",
        "",
        "This document is automatically refreshed from multiple Browns-related podcast audio feeds and transcribed with Whisper so NotebookLM can use it as one synced source.",
        "",
    ]

    if not retained_blocks:
        parts.extend([
            "## No transcripts available",
            "",
            "No podcast audio could be transcribed during this run. Check the GitHub Actions logs.",
            "",
        ])
    else:
        parts.extend(retained_blocks)

    return "\n\n".join(parts).strip() + "\n"


def replace_google_doc_text(service, document_id: str, text: str) -> None:
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

    target_date = parse_target_date()
    if target_date is not None:
        log(f"Manual target date requested: {target_date}")

    service = get_docs_service()
    existing_text = get_google_doc_text(service, DOC_ID)
    known = existing_identifiers(existing_text)
    log(f"Found {len(known)} existing episode identifiers in Google Doc.")

    specs = parse_podcast_specs()
    candidate_episodes: list[Episode] = []
    for spec in specs:
        candidate_episodes.extend(get_recent_episodes_for_podcast(spec, target_date))

    new_episodes: list[Episode] = []
    for episode in candidate_episodes:
        if episode.key in known or episode.audio_url in known:
            log(f"Already archived, skipping transcription: [{episode.podcast_name}] {episode.title}")
            continue
        new_episodes.append(episode)

    transcripts: list[Transcript] = []
    model: WhisperModel | None = None

    for episode in new_episodes:
        audio_path: Path | None = None
        try:
            if model is None:
                model = load_whisper_model()
            audio_path = download_audio(episode)
            text = transcribe_audio(model, audio_path)
            transcripts.append(Transcript(episode=episode, text=text))
        except Exception as exc:  # noqa: BLE001
            log(f"Failed to process episode [{episode.podcast_name}] {episode.title!r}: {exc}")
        finally:
            if audio_path:
                try:
                    audio_path.unlink(missing_ok=True)
                except Exception:
                    pass

    if not transcripts:
        log("No new episodes needed transcription. Rebuilding archive header and preserving existing episode blocks.")

    document_text = build_archive_document(transcripts, existing_text)
    replace_google_doc_text(service, DOC_ID, document_text)


if __name__ == "__main__":
    main()
