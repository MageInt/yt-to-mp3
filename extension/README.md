# yt-to-mp3 capture (Firefox extension)

Prototype: captures a YouTube video's audio while it plays and converts it on your yt-to-mp3 server.

See [docs/extension.md](../docs/extension.md) for setup, install, signing, limits and testing.

```bash
npm ci
npm run lint    # web-ext lint
npm start       # web-ext run (temporary install in a fresh Firefox profile)
npm run build   # dist/*.zip (unsigned)
```
