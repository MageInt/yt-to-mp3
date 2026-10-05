# Firefox extension (prototype)

`extension/` is a Firefox extension that saves the audio of a YouTube video **from the player itself**: it keeps a copy of the audio segments YouTube's player loads, then either saves them as is or sends them to the yt-to-mp3 server for conversion. The server never contacts YouTube in this flow, so there is no VPN IP, cookie or "not a bot" issue.

Status: **prototype**. The hook was validated on real YouTube in Chromium (same MSE API, see [Testing](#testing)); the full flow has not yet been run inside Firefox.

## How it works

```
YouTube page (MAIN world)                 extension                         yt-to-mp3 server
inject.js hooks MediaSource ──postMessage──▶ content.js ──runtime msg──▶ background.js ──POST /api/convert──▶ ffmpeg
 · copies audio segments                                                     │  Bearer CONVERT_TOKEN
 · tracks buffered ranges                         popup.js (status, format)  └─ downloads the result
```

- `src/inject.js` (MAIN world, `document_start`): wraps `MediaSource.prototype.addSourceBuffer`, `SourceBuffer.prototype.appendBuffer` and `changeType` with `Proxy`s (native names/`toString` kept). For each audio SourceBuffer it stores the appended bytes (duplicates skipped by fingerprint, 300 MB cap) and merges the `buffered` ranges to know which part of the video is covered. Ads are ignored (`ad-showing` on the player). Captures are matched to the current video id; the last 4 are kept.
- `src/content.js`: bridge between the page and the extension (`window.postMessage`).
- `src/background.js`: saves the raw capture (`Original`) or posts it to `/api/convert?format=…&title=…&artist=…` and downloads the converted file. Shows a badge (`…`, `✓`, `!`).
- `src/popup/`: capture status (title, covered time, gaps, size), format picker, action.
- `src/options/`: server URL + token, tested with `GET /api/convert/ping`; asks for host access to that server only.

The raw capture is a valid WebM (Opus) or fragmented MP4 (AAC) stream: init segment + media segments in order. ffmpeg regenerates timestamps (`-fflags +genpts`); Opus → `.opus` and AAC → `.m4a` are remuxed without re-encoding.

## Server setup

Set a token of at least 24 characters on the server (the API is off otherwise), e.g. in the Portainer stack:

```yaml
environment:
  CONVERT_TOKEN: "<openssl rand -base64 32>"
```

Related settings: `MAX_UPLOAD_MB` (200), `MAX_CONCURRENT_CONVERSIONS` (2), `CONVERT_TIMEOUT_MINUTES` (5). See [configuration.md](configuration.md) and the endpoint in [api.md](api.md#post-apiconvert).

## Install

Firefox 140+ (desktop). Release builds attach an **unsigned** zip.

- **Try it**: `about:debugging` → *This Firefox* → *Load Temporary Add-on…* → pick `extension/manifest.json` (removed when Firefox restarts). Or `cd extension && npm ci && npm start` (`web-ext run`).
- **Keep it installed**: regular Firefox only installs signed extensions. Sign it for yourself without publishing it (AMO "unlisted" channel): create API keys on addons.mozilla.org, then
  ```bash
  cd extension && npx web-ext sign --channel=unlisted --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET
  ```
  and share the resulting `.xpi` with your friends. Firefox Developer Edition / Nightly can also install unsigned builds with `xpinstall.signatures.required=false`.

Then open the extension settings, enter the server URL and the token, *Test & save*. On first use, allow the extension on YouTube if Firefox asks.

## Use

1. Open a video on youtube.com or music.youtube.com and play it.
2. The popup shows how much is captured. The player loads ahead of playback (short tracks are often complete within seconds); for long videos keep playing to the end **without skipping**: skipped parts are missing (*gaps*).
3. Pick a format and *Convert* (server) or *Original* (raw file, no server).

If the extension was installed while a video was already playing, reload the tab.

## Limits and risks

- **Detection**: no extra request is made to YouTube; traffic is the normal player's. YouTube's own scripts could still notice the modified prototypes or the page messages (`yt2mp3:*` channels). Lower risk than yt-dlp, not zero, and still against YouTube's terms of service.
- **Completeness**: based on what the player buffered; seeking back over a gap fills it. Changing quality mid-way can switch the audio format: the popup then warns that the file may be unusable.
- **DRM**: protected videos (EME, e.g. rented movies) are refused; their data is encrypted anyway.
- **Memory**: captures live in the tab until it is closed or 4 newer captures replace them; 300 MB cap per capture.
- **Token**: stored in the browser profile (`storage.local`). Anyone with it can use the conversion API (not YouTube, not cookies). Rotate it by changing `CONVERT_TOKEN`.

## Testing

- `cd extension && npm run lint` (`web-ext lint`, run in CI).
- Hook on real YouTube, outside CI: `e2e/tools/extension-capture.mjs` injects `inject.js` into Chromium (same MSE API), plays a video, exports the capture to `shots/capture.webm`, which can be posted to `/api/convert`. Headless browsers only get ~60 s of stream from YouTube (no valid attestation), so use short videos (default `jNQXAC9IVRw`, 19 s).
- Server side: `backend/test/convert.test.ts` (fake ffmpeg fixture).

`npm audit` in `extension/` reports `node-forge` (via `web-ext` → `@devicefarmer/adbkit`, Android debugging) with no fixed release. It is a dev-only tool; nothing from `node_modules` is packaged in the extension.
