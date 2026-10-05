# Architecture

A single container runs one Node.js/Express process that serves both the API (`/api/*`) and the built React SPA (static files from `public/`). Audio extraction is delegated to `yt-dlp` + `ffmpeg` child processes.

```
Browser ──HTTP──▶ Express (backend/src/app.ts)
                    ├─ helmet, JSON body (10 kB), rate limit on POST /api/jobs
                    ├─ /api/health
                    ├─ /api/jobs/*  ──▶ downloadManager ──spawn──▶ yt-dlp ──▶ ffmpeg
                    ├─ /api/*       ──▶ 404 JSON
                    └─ static SPA + fallback to index.html
```

## Backend modules

| File | Role |
|------|------|
| `backend/src/index.ts` | Entry point: `createApp()` + `listen`. |
| `backend/src/app.ts` | Express app factory (middlewares, routes, error handler). Used by tests. |
| `backend/src/config.ts` | Reads all environment variables (see [configuration.md](configuration.md)). |
| `backend/src/routes/jobs.ts` | HTTP endpoints for jobs (see [api.md](api.md)). |
| `backend/src/services/urlValidator.ts` | YouTube host allowlist (SSRF protection), video / playlist detection. |
| `backend/src/middleware/session.ts` | Session cookie handling (`yt2mp3_sid`), `requireSession`, same-origin check for state-changing requests (CSRF). |
| `backend/src/routes/convert.ts` | `/api/convert` for the browser extension (bearer token, mounted before the same-origin check). |
| `backend/src/services/convertResults.ts` | Converted files kept 10 min behind a capability URL (`delivery=link`). |
| `backend/src/services/converter.ts` | ffmpeg conversion of uploaded captures (fixed demuxer, `file` protocol only, timeout, concurrency cap). |
| `backend/src/routes/session.ts` | `/api/session` and `/api/session/cookies`. |
| `backend/src/services/sessionStore.ts` | In-memory sessions (idle / max lifetime, eviction) holding uploaded cookies. |
| `backend/src/services/cookieJar.ts` | Netscape cookies.txt parser: validation, YouTube/Google filter, rebuild. |
| `backend/src/services/userAgent.ts` | Sanitizes User-Agents and picks the one sent to yt-dlp (UA saved with the cookies, else the requester's). |
| `backend/src/services/audioFormats.ts` | Output formats offered to users (id → yt-dlp `--audio-format`, file extension). |
| `backend/src/services/downloadManager.ts` | In-memory job store, yt-dlp process management, SSE fan-out, cleanup. |

## Job lifecycle

1. `POST /api/jobs` attaches the caller's session (created if needed), validates the URL and the format, checks `MAX_JOBS_PER_SESSION` and `MAX_QUEUE_SIZE`, creates a temp dir (`$TMPDIR/yt-dlp-*`) and puts the job in the **queue** (status `queued`).
   - `pump()` starts queued jobs in FIFO order while fewer than `MAX_CONCURRENT_JOBS` run, skipping (without reordering) jobs whose session already runs `MAX_PARALLEL_PER_SESSION` downloads. It runs on every new job and whenever a job finishes, fails or is cancelled.
   - Queued jobs get their position over SSE (`queued` events). `DELETE /api/jobs/:id` cancels a queued or running job.
   - Cookies and User-Agent are resolved when the job **starts**, from the session's current state.
2. `buildYtDlpArgs` builds the command line (adds `--proxy` when `YTDLP_PROXY` is set, `--cookies <jar>` when the session has cookies, else when `YTDLP_COOKIES_FILE` is set; `--user-agent` with the UA saved at cookie upload, else the requester's browser UA). The jar is written to a fresh `0700` directory under `SECRETS_TMP_DIR` (`/dev/shm`, RAM) right before spawning yt-dlp and deleted as soon as it exits (or on error/timeout/cleanup). Cookies YouTube rotated during the run are read back into the session first. Playlist mode only when `ENABLE_PLAYLISTS=true` and the URL has `list=` (`--playlist-end MAX_PLAYLIST_ITEMS`); otherwise `--no-playlist`, so only the video in the URL is fetched.
3. `yt-dlp` stdout is parsed for `[download] NN%` lines. Values are queued and emitted every 250 ms over SSE so the progress bar moves smoothly instead of jumping 0→100.
4. On process exit, files with the format's extension in the temp dir become `job.files`. The job is `completed` (or `failed` with a short error summary).
5. The client downloads via `/api/jobs/:id/file` (single) or `/api/jobs/:id/files/:index` (playlist).
6. A sweep every 5 minutes fails jobs queued longer than `MAX_QUEUE_WAIT_MINUTES` and deletes finished jobs `JOB_TTL_MINUTES` after they finished (removes the temp dir). A running download is killed after `DOWNLOAD_TIMEOUT_MINUTES`.

State is **in memory only**: restarting the container drops all jobs. The app is designed for a single instance.

## Frontend

React 19 + Vite, styled with the Dorian UI charter (`frontend/src/styles/theme.css` tokens + embedded Inter / JetBrains Mono woff2; app styles in `src/index.css`). Dark only.

- `App.tsx`: loads `/api/config`, drives the flow (POST job → `EventSource` on `/progress` → auto-download, or `TrackList` for playlists), states idle / pending / downloading / converting / completed / failed.
- `components/DownloadForm.tsx`: URL field (+ Paste button when the Clipboard API is available), format picker (radio group), contextual hints for playlist links.
- `components/ProgressBar.tsx`: percentage while downloading, indeterminate bar while ffmpeg converts.
- `components/CookiesPanel.tsx`: "YouTube cookies" disclosure: risk disclaimer, what the server does with them, how to export them, upload (file or paste), status and *Forget*. Warns when the page is served over plain HTTP.
- `components/TrackList.tsx`: per-track and "download all" for playlist jobs (only reachable with `ENABLE_PLAYLISTS=true`).
- `api.ts`: types and fetch helpers.

The selected format is kept in the URL (`?format=flac`). Keyboard: `/` focuses the link field, `Esc` clears a finished job. Icons: `public/favicon.svg` (+ `favicon-32.png`, `apple-touch-icon.png` rendered from it).

In dev, Vite proxies `/api` to `localhost:3001`.

## Container

Multi-stage `Dockerfile`: frontend build → backend build → runtime on `node:24-alpine` with `ffmpeg`, `python3` and `yt-dlp[default]` installed from PyPI in a venv (`/opt/yt-dlp`). `/etc/yt-dlp.conf` sets `--js-runtimes node` so yt-dlp can solve YouTube JS challenges with the bundled Node. Runs as user `node`, with a `HEALTHCHECK` on `/api/health`.

## Browser extension

`extension/` (Firefox and Chromium/Brave, MV3, one codebase) captures audio in the user's browser from YouTube's own player and posts it to `/api/convert`; the server only runs ffmpeg. Independent from the yt-dlp flow above. Details: [extension.md](extension.md).
