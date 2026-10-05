# yt-to-mp3 capture (browser extension)

Prototype for Firefox and Brave / Chromium: captures a YouTube video's audio while it plays and converts it on your yt-to-mp3 server.

See [docs/extension.md](../docs/extension.md) for setup, install (Brave: *Load unpacked*; Firefox: signing), limits and testing.

```bash
npm ci
npm run build     # dist/firefox, dist/chromium
npm run package   # dist/packages/*.zip
npm run lint      # web-ext lint (Firefox build)
```
