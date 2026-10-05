# HTTP API

All endpoints are under `/api`. Responses are JSON unless noted. Unknown `/api/*` routes return `404 {"error":"Not found"}`.

## Sessions

Each browser gets an anonymous session, kept **in memory only**, identified by the `yt2mp3_sid` cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS). It holds the user's YouTube cookies, if they uploaded some, and owns the user's jobs. A job is only visible to the session that created it: any other caller gets `404`.

State-changing requests (`POST`, `PUT`, `DELETE`) are refused with `403 {"error":"Cross-site request refused"}` when the browser marks them `Sec-Fetch-Site: cross-site` or when `Origin` does not match the host.

### `GET /api/session`
Starts a session if there is none (sets the cookie), then returns its state. Never returns cookie names or values. `Cache-Control: no-store`.

```json
{
  "hasCookies": true,
  "cookieCount": 12,
  "cookiesUpdatedAt": 1791100000000,
  "cookiesExpireAt": 1825000000000,
  "expiresAt": 1791107200000,
  "idleTimeoutMinutes": 120
}
```

`cookiesExpireAt` is the earliest expiry among persistent cookies (ms), `expiresAt` when the session itself ends if idle.

### `PUT /api/session/cookies`
Body: `{"cookies": "<content of a Netscape cookies.txt>"}` (file up to 100 kB). Only `youtube.com` / `google.com` cookies are kept. Rate-limited like job creation.

| Status | When |
|--------|------|
| 200 | Same body as `GET /api/session` |
| 400 | Not a Netscape file, malformed line, no YouTube/Google cookie, too many cookies (max 300) |
| 401 | No valid session (reload the page) |

### `DELETE /api/session/cookies`
Forgets the cookies. `200` with the session state, `401` without a session.

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
Starts a session if needed; the job belongs to it and uses its cookies (else `YTDLP_COOKIES_FILE`, if set). Body: `{"url": "<YouTube URL>", "format": "<format id>"}` (max 10 kB). `format` is optional (default `mp3`).

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
- `{"type":"failed","error":"...","code":"bot_check"}`: `code` is present only for known causes. `bot_check` = YouTube asked to "confirm you're not a bot"; the UI then opens the cookies section.

On subscription, the current state is replayed (completed / failed / current progress). `404` if the job is unknown or belongs to another session.

## `GET /api/jobs/:id/file`
Downloads the first (or only) audio file. `404` unknown job, `400 {"error":"File not ready","status":...}` if not completed.

## `GET /api/jobs/:id/files/:index`
Downloads track `index` (0-based) of a playlist job. `404` if job or index is unknown, `400` if not completed.
