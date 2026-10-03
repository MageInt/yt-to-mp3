# Security

## Threat model

Public-facing web app with no authentication that runs an external downloader on user input. Main risks: using the server as a proxy (SSRF), resource exhaustion (CPU, disk, processes), and injection into the `yt-dlp` command line.

## Measures in place

| Risk | Mitigation | Where |
|------|-----------|-------|
| SSRF / arbitrary downloads | Host allowlist (YouTube only), no credentials or custom ports, 2048-char max | `services/urlValidator.ts` |
| yt-dlp option injection | `spawn` without a shell + `--` before the URL | `services/downloadManager.ts` |
| Process / CPU exhaustion | `MAX_CONCURRENT_JOBS`, `DOWNLOAD_TIMEOUT_MINUTES` | `downloadManager.ts`, `config.ts` |
| Disk exhaustion | `MAX_PLAYLIST_ITEMS`, TTL sweep every 5 min | `downloadManager.ts` |
| Request flooding | `express-rate-limit` on `POST /api/jobs`, 10 kB JSON body | `routes/jobs.ts`, `app.ts` |
| Memory growth | yt-dlp output buffer capped at 64 kB, error messages capped at 500 chars | `downloadManager.ts` |
| Cross-origin abuse | No CORS headers (same-origin only) | `app.ts` |
| XSS / clickjacking / sniffing | `helmet` (CSP `default-src 'self'`, `frame-ancestors 'self'`, `nosniff`…), `x-powered-by` off | `app.ts` |
| Path traversal on download | Files served only from the job's `files` list, by index | `routes/jobs.ts` |
| Container breakout impact | Non-root `node` user, `no-new-privileges` in compose, minimal Alpine image | `Dockerfile`, `docker-compose.yml` |
| Supply chain | `npm ci` from lockfiles, `npm audit --audit-level=high` in CI, provenance + SBOM on the image | `.github/workflows/release.yml` |

HSTS and `upgrade-insecure-requests` are deliberately disabled: the app is often reached over plain HTTP on a LAN. Terminate TLS on a reverse proxy and set `TRUST_PROXY=true`.

## Known limitations

- No authentication: anyone who can reach the port can download. Put it behind a VPN or an authenticating proxy if exposed to the Internet.
- Job IDs (random UUIDv4) act as bearer tokens for the files.
- In-memory state: the concurrency limit is per process.

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
