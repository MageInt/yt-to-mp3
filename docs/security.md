# Security

## Threat model

Public-facing web app with no authentication that runs an external downloader on user input. Main risks: using the server as a proxy (SSRF), resource exhaustion (CPU, disk, processes), and injection into the `yt-dlp` command line.

## Measures in place

| Risk | Mitigation | Where |
|------|-----------|-------|
| SSRF / arbitrary downloads | Host allowlist (YouTube only), no credentials or custom ports, 2048-char max | `services/urlValidator.ts` |
| Mass downloads (channels, playlists) | URL must identify a video; playlists off by default (`ENABLE_PLAYLISTS`) | `services/urlValidator.ts` |
| Arbitrary yt-dlp options via format | `format` checked against a fixed allowlist | `services/audioFormats.ts` |
| yt-dlp option injection | `spawn` without a shell + `--` before the URL | `services/downloadManager.ts` |
| Process / CPU exhaustion | Bounded queue: `MAX_CONCURRENT_JOBS`, `MAX_PARALLEL_PER_SESSION`, `MAX_JOBS_PER_SESSION`, `MAX_QUEUE_SIZE`, `MAX_QUEUE_WAIT_MINUTES`, `DOWNLOAD_TIMEOUT_MINUTES` | `downloadManager.ts`, `config.ts` |
| One account used in parallel (flagging risk) | `MAX_PARALLEL_PER_SESSION=1`: a session's cookies are only used by one yt-dlp process at a time | `downloadManager.ts` |
| Disk exhaustion | `MAX_PLAYLIST_ITEMS`, TTL sweep every 5 min | `downloadManager.ts` |
| Request flooding | `express-rate-limit` on `POST /api/jobs`, 10 kB JSON body | `routes/jobs.ts`, `app.ts` |
| Memory growth | yt-dlp output buffer capped at 64 kB, error messages capped at 500 chars | `downloadManager.ts` |
| IP exposure to YouTube | Optional `YTDLP_PROXY` (e.g. Gluetun VPN); fails closed if the proxy is down | `config.ts`, `downloadManager.ts` |
| Leaking YouTube session cookies | See [User cookies](#user-cookies) | `sessionStore.ts`, `cookieJar.ts`, `downloadManager.ts` |
| Header injection via forwarded User-Agent | Only printable ASCII, `Mozilla/5.0 (…` prefix, ≤ 512 chars; passed as a `spawn` argument (no shell) | `services/userAgent.ts` |
| Conversion API abuse | Off unless `CONVERT_TOKEN` (≥ 24 chars) is set; bearer token compared in constant time; rate limit, `MAX_UPLOAD_MB`, `MAX_CONCURRENT_CONVERSIONS` | `routes/convert.ts` |
| Leaked download link (`delivery=link`) | 256-bit random id, 10 min lifetime, max 20 stored results, deleted on expiry | `services/convertResults.ts` |
| Malicious file sent to ffmpeg | Content type allowlist (webm/mp4), explicit demuxer, `-protocol_whitelist file`, audio stream only, metadata stripped (`-map_metadata -1`), timeout, temp dir deleted after the response | `services/converter.ts` |
| Accessing someone else's files | Jobs bound to the creating session; other callers get `404` | `routes/jobs.ts` |
| CSRF on state-changing routes | `SameSite=Strict` session cookie, JSON-only bodies, `Sec-Fetch-Site` / `Origin` check | `middleware/session.ts` |
| Cross-origin abuse | No CORS headers (same-origin only) | `app.ts` |
| XSS / clickjacking / sniffing | `helmet` (CSP `default-src 'self'`, `frame-ancestors 'self'`, `nosniff`…), `x-powered-by` off | `app.ts` |
| Path traversal on download | Files served only from the job's `files` list, by index | `routes/jobs.ts` |
| Container breakout impact | Non-root `node` user, `no-new-privileges` in compose, minimal Alpine image | `Dockerfile`, `docker-compose.yml` |
| Supply chain | `npm ci` from lockfiles, `npm audit --audit-level=high` in CI, provenance + SBOM on the image | `.github/workflows/release.yml` |

## User cookies

Users can upload a YouTube `cookies.txt` to get past the "not a bot" check. These cookies are a **full Google session** (YouTube, Gmail, Drive…), so they are handled as secrets:

- **Memory only.** Stored in the process heap, in the user's session (`sessionStore.ts`). No database, no disk, no logs. A restart wipes everything.
- **Bound to one browser.** Session id: 256-bit random, in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` over HTTPS). Never readable by page scripts, never shared between visitors.
- **Minimized.** The upload is parsed strictly (Netscape format, RFC 6265 name/value charset, 300 cookies and 100 kB max). Only `youtube.com` / `google.com` cookies are kept, and the jar is rebuilt from the parsed fields, so nothing else from the file reaches yt-dlp.
- **Never echoed.** The API only returns counts and dates, never names or values. The page clears the textarea after upload.
- **Paired User-Agent.** The uploading browser's UA (sanitized, see `userAgent.ts`) is stored with the cookies and sent with every download using them, even if the download is started from another device. It is not secret, is returned to the user, and is wiped with the cookies.
- **Reused across downloads.** The session keeps the cookies for every download until it expires; a download never consumes them.
- **RAM-only while in use.** yt-dlp needs a file: for each download, a copy of the jar is written to `SECRETS_TMP_DIR` (`/dev/shm`, tmpfs) in a `0700` directory with a `0600` file, for the duration of the process only, then deleted. If that directory is not writable, the download fails rather than falling back to disk.
- **Limited lifetime.** Wiped on *Forget*, after `SESSION_IDLE_MINUTES` of inactivity, after `SESSION_MAX_HOURS`, when evicted (`MAX_SESSIONS`), or on restart.
- **Transport.** Over plain HTTP, cookies travel in clear text: the UI warns about it outside `localhost`. Put the app behind an HTTPS reverse proxy (`TRUST_PROXY=true`) if it is reachable beyond a trusted LAN.

Residual risks, shown to users in the UI disclaimer: whoever controls the server (or its memory) can use the account; heavy automated use can get the account flagged. Recommend a secondary Google account.

## Browser extension

The extension only asks for YouTube hosts plus, at setup, the configured server's origin. The token sits in the browser profile; the API it unlocks only converts audio (no YouTube access, no cookies). The page hook runs in YouTube's page and exchanges messages over `window.postMessage`, which YouTube's scripts can observe: see [extension.md](extension.md#limits-and-risks).

HSTS and `upgrade-insecure-requests` are deliberately disabled: the app is often reached over plain HTTP on a LAN. Terminate TLS on a reverse proxy and set `TRUST_PROXY=true`.

## Known limitations

- No authentication: anyone who can reach the port can download. Put it behind a VPN or an authenticating proxy if exposed to the Internet.
- Anonymous sessions: anyone can use the app and start a session (no accounts).
- In-memory state: the concurrency limit and sessions are per process (single instance only).

## Audit — 2026-10-03

Findings in the code before this audit, all fixed:

1. **SSRF (high)**: any `http(s)` URL was passed to yt-dlp, internal network included.
2. **DoS (medium)**: unlimited jobs and playlist size, TTL checked only every 30 min, no rate limit, unbounded output buffer.
3. **Wildcard CORS (low)**: `cors()` allowed any origin.
4. **Unknown `/api/*` routes hung** (no response from the catch-all).
5. **Container ran as root**, yt-dlp from `apk` (outdated), no healthcheck, Node 20 (end of life).
6. **Timeout race**: the `close` handler could overwrite a job already marked failed after a timeout.
7. Raw yt-dlp output (paths, internals) returned to clients in error messages.

Dependencies: all upgraded to the latest major (Express 5, React 19, Vite 8, TypeScript 7, Playwright 1.63, Node 24). `npm audit` reports 0 vulnerabilities in `backend`, `frontend` and `e2e`.

Report a vulnerability: open a private security advisory on the GitHub repository.
