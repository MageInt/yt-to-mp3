# Configuration

All settings are environment variables read in `backend/src/config.ts`. Invalid or non-positive values fall back to the default.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port. |
| `MAX_CONCURRENT_JOBS` | `3` | Max yt-dlp processes running at once; extra requests get `429`. |
| `MAX_PLAYLIST_ITEMS` | `50` | Max tracks downloaded from a playlist (`--playlist-end`). |
| `JOB_TTL_MINUTES` | `30` | Jobs and their files are deleted after this age (sweep every 5 min). |
| `DOWNLOAD_TIMEOUT_MINUTES` | `10` | yt-dlp is killed after this duration. |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Rate-limit window for `POST /api/jobs`. |
| `RATE_LIMIT_MAX` | `20` | Max job creations per IP per window. |
| `YTDLP_PROXY` | _(empty)_ | Proxy for all yt-dlp traffic (`--proxy`), e.g. `http://192.168.1.10:8890` or `socks5://host:1080`. Empty means a direct connection. If the proxy is unreachable, downloads fail: there is no fallback to a direct connection. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so the rate limit uses the real client IP (`X-Forwarded-For`). |

Set in the image (no need to change): `NODE_ENV=production`, `TMPDIR=/app/tmp`.

## Routing downloads through a VPN (Gluetun)

Point `YTDLP_PROXY` at the HTTP proxy of a Gluetun container (`HTTPPROXY=on`) using the **host's LAN IP** and the published port, e.g. `YTDLP_PROXY=http://192.168.1.10:8890`. Only yt-dlp traffic (YouTube API, audio streams) goes through the VPN; the web UI stays on the normal network, in its own stack. Check with `docker logs` on Gluetun or by watching a download fail when the proxy is stopped.

yt-dlp options shared by every run live in `/etc/yt-dlp.conf` inside the image (`--js-runtimes node`, `--no-cache-dir`).

Example with Docker Compose:

```yaml
services:
  app:
    image: ghcr.io/mageint/yt-to-mp3:latest
    ports:
      - "8080:8080"
    environment:
      MAX_CONCURRENT_JOBS: "2"
      TRUST_PROXY: "true"
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
```
