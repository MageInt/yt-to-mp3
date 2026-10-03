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
| `backend/src/services/urlValidator.ts` | YouTube host allowlist (SSRF protection). |
| `backend/src/services/downloadManager.ts` | In-memory job store, yt-dlp process management, SSE fan-out, cleanup. |

## Job lifecycle

1. `POST /api/jobs` validates the URL, checks the concurrency limit, creates a temp dir (`$TMPDIR/yt-dlp-*`) and spawns `yt-dlp`.
2. A URL containing `list=` is treated as a playlist (`--playlist-end MAX_PLAYLIST_ITEMS`), otherwise `--no-playlist`.
3. `yt-dlp` stdout is parsed for `[download] NN%` lines. Values are queued and emitted every 250 ms over SSE so the progress bar moves smoothly instead of jumping 0→100.
4. On process exit, `.mp3` files in the temp dir become `job.files`. The job is `completed` (or `failed` with a short error summary).
5. The client downloads via `/api/jobs/:id/file` (single) or `/api/jobs/:id/files/:index` (playlist).
6. A sweep every 5 minutes deletes jobs older than `JOB_TTL_MINUTES` (kills the process, removes the temp dir). A download is killed after `DOWNLOAD_TIMEOUT_MINUTES`.

State is **in memory only**: restarting the container drops all jobs. The app is designed for a single instance.

## Frontend

React 19 + Vite. `App.tsx` drives the flow (POST job → `EventSource` on `/progress` → auto-download or `TrackList` for playlists). In dev, Vite proxies `/api` to `localhost:3001`.

## Container

Multi-stage `Dockerfile`: frontend build → backend build → runtime on `node:24-alpine` with `ffmpeg`, `python3` and `yt-dlp[default]` installed from PyPI in a venv (`/opt/yt-dlp`). `/etc/yt-dlp.conf` sets `--js-runtimes node` so yt-dlp can solve YouTube JS challenges with the bundled Node. Runs as user `node`, with a `HEALTHCHECK` on `/api/health`.
