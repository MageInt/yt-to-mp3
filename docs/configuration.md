# Configuration

All settings are environment variables read in `backend/src/config.ts`. Invalid or non-positive values fall back to the default. Booleans accept `true`/`false`/`1`/`0`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port. |
| `MAX_CONCURRENT_JOBS` | `3` | Max yt-dlp processes running at once; extra requests get `429`. |
| `ENABLE_PLAYLISTS` | `false` | `true` downloads the whole playlist when a URL has `list=`. `false`: only the video in the URL is downloaded, playlist-only URLs are refused. |
| `MAX_PLAYLIST_ITEMS` | `50` | Max tracks downloaded from a playlist (`--playlist-end`). Only used when `ENABLE_PLAYLISTS=true`. |
| `JOB_TTL_MINUTES` | `30` | Jobs and their files are deleted after this age (sweep every 5 min). |
| `DOWNLOAD_TIMEOUT_MINUTES` | `10` | yt-dlp is killed after this duration. |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Rate-limit window for `POST /api/jobs`. |
| `RATE_LIMIT_MAX` | `20` | Max job creations per IP per window. |
| `YTDLP_PROXY` | _(empty)_ | Proxy for all yt-dlp traffic (`--proxy`), e.g. `http://192.168.1.10:8890` or `socks5://host:1080`. Empty means a direct connection. If the proxy is unreachable, downloads fail: there is no fallback to a direct connection. |
| `YTDLP_COOKIES_FILE` | _(empty)_ | Path (inside the container) to a Netscape `cookies.txt` exported from YouTube. Needed when YouTube answers "Sign in to confirm you're not a bot". Can be mounted read-only: each job works on its own copy. See below. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so the rate limit uses the real client IP (`X-Forwarded-For`). |

Set in the image (no need to change): `NODE_ENV=production`, `TMPDIR=/app/tmp`.

## Routing downloads through a VPN (Gluetun)

Point `YTDLP_PROXY` at the HTTP proxy of a Gluetun container (`HTTPPROXY=on`) using the **host's LAN IP** and the published port, e.g. `YTDLP_PROXY=http://192.168.1.10:8890`. Only yt-dlp traffic (YouTube API, audio streams) goes through the VPN; the web UI stays on the normal network, in its own stack. Check with `docker logs` on Gluetun or by watching a download fail when the proxy is stopped.

## "Sign in to confirm you're not a bot"

YouTube shows this check to IPs it distrusts: VPN exits (Gluetun/NordVPN…), datacenters, servers that download a lot. The UI then reports *YouTube is asking to confirm this is not a bot*. Options, from simplest:

1. **Change the exit IP**: try another VPN country/server (or no proxy) to confirm the IP is the cause.
2. **Give yt-dlp YouTube cookies** (the fix recommended by yt-dlp):
   1. Use a **secondary Google account**: automated use can get an account flagged.
   2. In a **private browsing window**, log in to YouTube, then open `https://www.youtube.com/robots.txt` in the same tab.
   3. Export the cookies of `youtube.com` in Netscape format with an extension such as *Get cookies.txt LOCALLY*, then **close the private window** without logging out. YouTube rotates cookies of open sessions, which would invalidate the export.
   4. Copy the file to the server, readable by uid `1000` (the container user): `chmod 644 cookies.txt`, or `chown 1000 cookies.txt` with `chmod 600`.
   5. Mount it and point the variable to it:

      ```yaml
      environment:
        YTDLP_COOKIES_FILE: /config/cookies.txt
      volumes:
        - /path/on/host/cookies.txt:/config/cookies.txt:ro
      ```

   On start, the logs show `Using cookies file /config/cookies.txt`, or an error if the file cannot be read. Cookies expire after a while: if the error comes back with *They may have expired*, export them again.

Cookies and a proxy can be combined. Keeping the same exit country as the account's usual one helps.

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
