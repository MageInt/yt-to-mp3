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
  "cookiesUserAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  "expiresAt": 1791107200000,
  "idleTimeoutMinutes": 120
}
```

`cookiesExpireAt` is the earliest expiry among the Google sign-in cookies (`*SID`, `LOGIN_INFO`; ms, `null` if none), `cookiesUserAgent` the browser UA paired with the cookies at upload (`null` if it could not be used), `expiresAt` when the session itself ends if idle.

### `PUT /api/session/cookies`
Body: `{"cookies": "<content of a Netscape cookies.txt>"}` (file up to 100 kB). Only `youtube.com` / `google.com` cookies are kept. The request's `User-Agent` (if it is a real browser UA) is saved with them and used for every download that uses these cookies. Rate-limited like job creation.

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
Starts a session if needed; the job belongs to it and uses its cookies (else `YTDLP_COOKIES_FILE`, if set). User-Agent sent to yt-dlp (`FORWARD_USER_AGENT`): the one saved with the session's cookies; without cookies, the request's own UA if it is a real browser UA. Body: `{"url": "<YouTube URL>", "format": "<format id>"}` (max 10 kB). `format` is optional (default `mp3`).

| Status | Body | When |
|--------|------|------|
| 201 | `{"id": "<uuid>", "status": "downloading"}` | Job started right away |
| 201 | `{"id": "<uuid>", "status": "queued"}` | Job waiting in the download queue (see below) |
| 400 | `{"error": "URL is required"}` | Missing / non-string `url` |
| 400 | `{"error": "Invalid URL"}` | Not parseable, not http(s), credentials or custom port |
| 400 | `{"error": "Only YouTube URLs are supported"}` | Host not in allowlist |
| 400 | `{"error": "Playlist downloads are disabled. ..."}` | Playlist-only URL while `ENABLE_PLAYLISTS=false` |
| 400 | `{"error": "No video found in this URL"}` | Channel / home page / empty `v=` |
| 400 | `{"error": "Unsupported audio format"}` | Unknown `format` |
| 400 | `{"error": "Bad request"}` | Malformed JSON |
| 413 | `{"error": "Bad request"}` | Body too large |
| 429 | `{"error": "Too many requests. ..."}` | Rate limit (`RATE_LIMIT_*`) |
| 429 | `{"error": "You already have N downloads waiting or in progress. ..."}` | `MAX_JOBS_PER_SESSION` reached |
| 429 | `{"error": "The download queue is full. ..."}` | `MAX_QUEUE_SIZE` reached |

**Queue.** At most `MAX_CONCURRENT_JOBS` downloads run at once, and at most `MAX_PARALLEL_PER_SESSION` per session (so one user's cookies are never used in parallel). Other jobs wait in a FIFO queue; a job whose session is already at its limit is skipped without losing its place. A job queued longer than `MAX_QUEUE_WAIT_MINUTES` fails with code `queue_timeout`.

Allowed hosts: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `www.youtu.be`.

URL must identify a video (`?v=`, `youtu.be/<id>`, `/shorts/`, `/live/`, `/embed/`). A `list=` parameter next to a video is ignored unless playlists are enabled, in which case the whole list is downloaded.

## `GET /api/jobs/:id/progress`
Server-Sent Events stream (`text/event-stream`). Each event is `data: <json>`:

- `{"type":"queued","position":2}`: sent on subscription and whenever the position changes
- `{"type":"progress","progress":42.1}`
- `{"type":"completed","progress":100,"filename":"x.mp3","files":[{"filename":"x.mp3"}],"isPlaylist":false,"format":"mp3"}`
- `{"type":"failed","error":"...","code":"bot_check"}`: `code` is present only for known causes: `bot_check` (YouTube asked to "confirm you're not a bot"; the UI then opens the cookies section), `cancelled`, `queue_timeout`.

On subscription, the current state is replayed (completed / failed / current progress). `404` if the job is unknown or belongs to another session.

## `GET /api/jobs/:id/file`
Downloads the first (or only) audio file. `404` unknown job, `400 {"error":"File not ready","status":...}` if not completed.

## `GET /api/jobs/:id/files/:index`
Downloads track `index` (0-based) of a playlist job. `404` if job or index is unknown, `400` if not completed.

## `DELETE /api/jobs/:id`
Cancels a queued or running job (kills yt-dlp, frees its slot). Subscribers receive `{"type":"failed","code":"cancelled"}`.

| Status | When |
|--------|------|
| 200 | `{"id": "...", "status": "failed"}` |
| 404 | Unknown job or another session's job |
| 409 | Job already completed or failed |

## `POST /api/convert`
Used by the [Firefox extension](extension.md): converts audio captured in the browser. **Disabled (404) unless `CONVERT_TOKEN` is set.** Authenticated with `Authorization: Bearer <CONVERT_TOKEN>`, not with the session cookie, so it accepts cross-origin calls (no CSRF exposure: the token is not sent automatically by browsers). Rate-limited like job creation.

- Body: the raw capture, `Content-Type: audio/webm` (Opus) or `audio/mp4` (AAC), up to `MAX_UPLOAD_MB`.
- Query: `format` (same ids as `/api/config`, default `mp3`), optional `title` and `artist` (written as tags and used for the filename, control characters removed, 200 chars max).
- Response: the converted file (`Content-Disposition: attachment`).

| Status | When |
|--------|------|
| 200 | Converted file |
| 400 | Unknown `format`, empty body |
| 401 | Missing or wrong token |
| 404 | `CONVERT_TOKEN` not set |
| 413 | Body above `MAX_UPLOAD_MB` |
| 415 | Other content type |
| 422 | ffmpeg could not read the capture |
| 429 | Rate limit, or `MAX_CONCURRENT_CONVERSIONS` busy |

## `GET /api/convert/ping`
Same token. `200 {"ok":true,"formats":[{"id":"mp3","label":"MP3"},…],"maxUploadMb":200}`; used by the extension settings page to test the connection.
