# Browns Daily Transcript Pipeline

This pipeline automatically pulls captions from recent Cleveland Browns Daily YouTube videos and updates one Google Doc. Add that Google Doc to NotebookLM once, and NotebookLM can use the synced Google Drive source.

## What was added

- `.github/workflows/browns-daily-transcripts.yml`
- `scripts/update_browns_daily_doc.py`
- `requirements-transcripts.txt`

## How it works

```text
GitHub Actions schedule
  -> Python script scans https://www.youtube.com/@browns/videos
  -> Filters for titles containing Browns Daily / Cleveland Browns Daily
  -> Downloads English captions only with yt-dlp
  -> Cleans timestamps and duplicate caption lines
  -> Replaces the target Google Doc content
  -> NotebookLM uses the Google Doc as a synced Drive source
```

## One-time Google setup

### 1. Create the Google Doc

Create a Google Doc named something like:

```text
Browns Daily Transcript Feed
```

Copy the Google Doc ID from the URL.

Example URL:

```text
https://docs.google.com/document/d/GOOGLE_DOC_ID_IS_HERE/edit
```

### 2. Enable the Google Docs API

In Google Cloud Console:

1. Create or select a project.
2. Enable `Google Docs API`.
3. Create a service account.
4. Create a JSON key for that service account.
5. Copy the service account email address.

### 3. Share the Google Doc

Open the Google Doc and share it with the service account email address as an editor.

It will look something like:

```text
name-of-service-account@project-id.iam.gserviceaccount.com
```

## GitHub secrets

Add these repo secrets in GitHub:

Repo -> Settings -> Secrets and variables -> Actions -> New repository secret

### Secret 1

Name:

```text
GOOGLE_DOC_ID
```

Value:

```text
your Google Doc ID
```

### Secret 2

Name:

```text
GOOGLE_SERVICE_ACCOUNT_JSON
```

Value:

```text
Paste the full JSON key from the service account.
```

Raw JSON works. Base64 JSON also works.

## Running it

The workflow runs automatically every weekday at 5:30 PM Eastern during daylight saving time:

```yaml
cron: "30 21 * * 1-5"
```

GitHub Actions uses UTC, so this is 21:30 UTC. During Eastern Standard Time, change it to:

```yaml
cron: "30 22 * * 1-5"
```

You can also run it manually:

1. Open the repo on GitHub.
2. Go to Actions.
3. Select `Browns Daily Transcript Feed`.
4. Click `Run workflow`.

## NotebookLM setup

Do this once:

1. Open NotebookLM.
2. Create or open your Browns notebook.
3. Add source.
4. Pick Google Drive.
5. Select the `Browns Daily Transcript Feed` Google Doc.

After that, the pipeline updates the Google Doc and NotebookLM should use the refreshed source when Drive sync is available for the notebook/source.

## Notes

- The script uses manual captions first.
- If manual captions do not exist, it tries YouTube auto captions.
- If a video has no captions, it skips that video and keeps going.
- Each run replaces the Google Doc instead of appending forever.
- Default maximum is 5 Browns Daily videos. Change `MAX_BROWNS_DAILY_VIDEOS` in the workflow if needed.
