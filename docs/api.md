# HTTP API

All endpoints are under `/api`. Responses are JSON unless noted. Unknown `/api/*` routes return `404 {"error":"Not found"}`.

## `GET /api/health`
`200 {"status":"ok"}`. Used by the Docker `HEALTHCHECK` and CI.

## `GET /api/config`
Settings the UI needs:

```json
{
  "playlistsEnabled": false,
  "defaultFormat": "mp3",
  "jobTtlMinutes": 30,
  "formats": [{ "id": "mp3", "label": "MP3", "description": "Best VBR quality, plays everywhere" }, …]
}
```

Formats (ids): `mp3`, `m4a` (AAC), `opus`, `ogg` (Vorbis), `flac`, `wav`. Source of truth: `backend/src/services/audioFormats.ts`.

## `POST /api/jobs`
Body: `{"url": "<YouTube URL>", "format": "<format id>"}` (max 10 kB). `format` is optional (default `mp3`).

| Status | Body | When |
|--------|------|------|
| 201 | `{"id": "<uuid>", "status": "downloading"}` | Job started |
| 400 | `{"error": "URL is required"}` | Missing / non-string `url` |
| 400 | `{"error": "Invalid URL"}` | Not parseable, not http(s), credentials or custom port |
| 400 | `{"error": "Only YouTube URLs are supported"}` | Host not in allowlist |
| 400 | `{"error": "Playlist downloads are disabled. ..."}` | Playlist-only URL while `ENABLE_PLAYLISTS=false` |
| 400 | `{"error": "No video found in this URL"}` | Channel / home page / empty `v=` |
| 400 | `{"error": "Unsupported audio format"}` | Unknown `format` |
| 400 | `{"error": "Bad request"}` | Malformed JSON |
| 413 | `{"error": "Bad request"}` | Body too large |
| 429 | `{"error": "Too many requests. ..."}` | Rate limit (`RATE_LIMIT_*`) |
| 429 | `{"error": "Server is busy. ..."}` | `MAX_CONCURRENT_JOBS` reached |

Allowed hosts: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `www.youtu.be`.

URL must identify a video (`?v=`, `youtu.be/<id>`, `/shorts/`, `/live/`, `/embed/`). A `list=` parameter next to a video is ignored unless playlists are enabled, in which case the whole list is downloaded.

## `GET /api/jobs/:id/progress`
Server-Sent Events stream (`text/event-stream`). Each event is `data: <json>`:

- `{"type":"progress","progress":42.1}`
- `{"type":"completed","progress":100,"filename":"x.mp3","files":[{"filename":"x.mp3"}],"isPlaylist":false,"format":"mp3"}`
- `{"type":"failed","error":"..."}`

On subscription, the current state is replayed (completed / failed / current progress). `404` if the job is unknown.

## `GET /api/jobs/:id/file`
Downloads the first (or only) audio file. `404` unknown job, `400 {"error":"File not ready","status":...}` if not completed.

## `GET /api/jobs/:id/files/:index`
Downloads track `index` (0-based) of a playlist job. `404` if job or index is unknown, `400` if not completed.
