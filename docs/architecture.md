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
| `backend/src/services/audioFormats.ts` | Output formats offered to users (id → yt-dlp `--audio-format`, file extension). |
| `backend/src/services/downloadManager.ts` | In-memory job store, yt-dlp process management, SSE fan-out, cleanup. |

## Job lifecycle

1. `POST /api/jobs` validates the URL and the format, checks the concurrency limit, creates a temp dir (`$TMPDIR/yt-dlp-*`) and spawns `yt-dlp`.
2. `buildYtDlpArgs` builds the command line (adds `--proxy` when `YTDLP_PROXY` is set, `--cookies <tmpDir>/cookies.txt` when `YTDLP_COOKIES_FILE` is set; the file is copied there first). Playlist mode only when `ENABLE_PLAYLISTS=true` and the URL has `list=` (`--playlist-end MAX_PLAYLIST_ITEMS`); otherwise `--no-playlist`, so only the video in the URL is fetched.
3. `yt-dlp` stdout is parsed for `[download] NN%` lines. Values are queued and emitted every 250 ms over SSE so the progress bar moves smoothly instead of jumping 0→100.
4. On process exit, files with the format's extension in the temp dir become `job.files`. The job is `completed` (or `failed` with a short error summary).
5. The client downloads via `/api/jobs/:id/file` (single) or `/api/jobs/:id/files/:index` (playlist).
6. A sweep every 5 minutes deletes jobs older than `JOB_TTL_MINUTES` (kills the process, removes the temp dir). A download is killed after `DOWNLOAD_TIMEOUT_MINUTES`.

State is **in memory only**: restarting the container drops all jobs. The app is designed for a single instance.

## Frontend

React 19 + Vite, styled with the Dorian UI charter (`frontend/src/styles/theme.css` tokens + embedded Inter / JetBrains Mono woff2; app styles in `src/index.css`). Dark only.

- `App.tsx`: loads `/api/config`, drives the flow (POST job → `EventSource` on `/progress` → auto-download, or `TrackList` for playlists), states idle / pending / downloading / converting / completed / failed.
- `components/DownloadForm.tsx`: URL field (+ Paste button when the Clipboard API is available), format picker (radio group), contextual hints for playlist links.
- `components/ProgressBar.tsx`: percentage while downloading, indeterminate bar while ffmpeg converts.
- `components/TrackList.tsx`: per-track and "download all" for playlist jobs (only reachable with `ENABLE_PLAYLISTS=true`).
- `api.ts`: types and fetch helpers.

The selected format is kept in the URL (`?format=flac`). Keyboard: `/` focuses the link field, `Esc` clears a finished job. Icons: `public/favicon.svg` (+ `favicon-32.png`, `apple-touch-icon.png` rendered from it).

In dev, Vite proxies `/api` to `localhost:3001`.

## Container

Multi-stage `Dockerfile`: frontend build → backend build → runtime on `node:24-alpine` with `ffmpeg`, `python3` and `yt-dlp[default]` installed from PyPI in a venv (`/opt/yt-dlp`). `/etc/yt-dlp.conf` sets `--js-runtimes node` so yt-dlp can solve YouTube JS challenges with the bundled Node. Runs as user `node`, with a `HEALTHCHECK` on `/api/health`.
