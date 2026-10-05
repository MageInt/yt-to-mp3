# Browser extension (prototype): Firefox and Brave / Chromium

`extension/` saves the audio of a YouTube video **from the player itself**: it keeps a copy of the audio segments YouTube's player loads, sends them to the yt-to-mp3 server for conversion, and the browser downloads the result. The server never contacts YouTube in this flow, so there is no VPN IP, cookie or "not a bot" issue.

One codebase, two builds:

| Build | Browsers | Manifest |
|-------|----------|----------|
| `dist/firefox` | Firefox 140+ | `manifests/firefox.json` (event page, SVG icons) |
| `dist/chromium` | Brave, Chrome, Edge, Vivaldi… (Chromium 120+) | `manifests/chromium.json` (service worker, PNG icons) |

Status: **prototype**. Both builds were run end to end on real YouTube (capture → conversion → download, see [Testing](#testing)): Chromium via Playwright, Firefox 156 via geckodriver.

## How it works

```
YouTube page (MAIN world)              extension                                  yt-to-mp3 server
inject.js hooks MediaSource ─postMessage─▶ content.js ◀─ base64 chunks ─ background.js ─POST /api/convert?delivery=link─▶ ffmpeg
 · copies audio segments                                 (event page /          │  Bearer CONVERT_TOKEN
 · tracks buffered ranges        popup.js ── process ──▶  service worker)        └─ downloads.download(server URL, 10 min)
```

- `src/inject.js` (MAIN world, `document_start`): wraps `MediaSource.prototype.addSourceBuffer`, `SourceBuffer.prototype.appendBuffer` and `changeType` with `Proxy`s (native names/`toString` kept). For each audio SourceBuffer it stores the appended bytes (duplicates skipped by fingerprint, 300 MB cap) and merges the `buffered` ranges to know which part of the video is covered. Ads are ignored (`ad-showing` on the player). Captures are matched to the current video id; the last 4 are kept.
- `src/content.js`: bridge between the page (`window.postMessage`) and the extension. The page only ever sends **JSON strings** (the capture as base64 inside): in Firefox, page objects reach content scripts through Xray wrappers, and copying binary data out of them fails with `Permission denied to access property "constructor"`. Chromium runtime messages are JSON only too, so the base64 is handed to the background in ~2 MB chunks it pulls (`export` → `chunk`… → `release`).
- `src/background.js`: rebuilds the capture, posts it to `/api/convert?format=…&title=…&artist=…&delivery=link`, then calls `downloads.download` on the returned server URL. A Chromium service worker cannot create blob URLs, so the file is served by the server (10 min capability link). Badge: `…`, `✓`, `!`. Runs even if the popup is closed.
- `src/popup/`: capture status (title, covered time, gaps, size), format picker (6 formats + *Original*: same audio, no re-encoding), action.
- `src/options/`: server URL + token, tested with `GET /api/convert/ping`; asks for host access to that server only.
- Cross-browser rules: `const api = globalThis.browser ?? globalThis.chrome`, listeners answer with `sendResponse` + `return true`, messages are JSON, and nothing but strings crosses from the page to the content script.

The raw capture is a valid WebM (Opus) or fragmented MP4 (AAC) stream: init segment + media segments in order. ffmpeg regenerates timestamps (`-fflags +genpts`); Opus → `.opus`, AAC → `.m4a` and *Original* are remuxed without re-encoding.

## Server setup

Set a token of at least 24 characters on the server (the API is off otherwise), e.g. in the Portainer stack:

```yaml
environment:
  CONVERT_TOKEN: "<openssl rand -base64 32>"
```

Related settings: `MAX_UPLOAD_MB` (200), `MAX_CONCURRENT_CONVERSIONS` (2), `CONVERT_TIMEOUT_MINUTES` (5). See [configuration.md](configuration.md) and the endpoints in [api.md](api.md#post-apiconvert).

## Build

```bash
cd extension
npm ci
npm run build     # dist/firefox and dist/chromium (unpacked)
npm run package   # dist/packages/yt-to-mp3-capture-{firefox,chromium}-<version>.zip
npm run lint      # web-ext lint of the Firefox build
```

Each GitHub Release also attaches both zips (unsigned).

## Install in Brave (or Chrome, Edge…)

No signing needed for a personal install:

1. Unzip `yt-to-mp3-capture-chromium-<version>.zip` (or use `extension/dist/chromium`) in a folder you keep.
2. Open `brave://extensions` (`chrome://extensions`), enable **Developer mode** (top right).
3. **Load unpacked** → pick that folder.
4. Pin the extension, open its **Details → Extension options**, enter the server URL and token, *Test & save* and accept the access request for your server.

To update, replace the folder content and click the reload icon on the extension card. Brave's Shields do not interfere: the extension only reads what the player already received.

## Install in Firefox

Firefox 140+ (desktop).

- **Try it**: `about:debugging` → *This Firefox* → *Load Temporary Add-on…* → pick `extension/dist/firefox/manifest.json` (removed when Firefox restarts). Or `npm run start:firefox` (`web-ext run`).
- **Keep it installed**: regular Firefox only installs signed extensions. Sign it for yourself without publishing it (AMO "unlisted" channel): create API keys on addons.mozilla.org, then
  ```bash
  cd extension && npm run build && npx web-ext sign --source-dir dist/firefox --channel=unlisted --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET
  ```
  and share the resulting `.xpi` with your friends. Firefox Developer Edition / Nightly can also install unsigned builds with `xpinstall.signatures.required=false`.

Then open the extension settings, enter the server URL and token, *Test & save*. If Firefox asks, allow the extension on YouTube (the popup offers a button).

## Use

1. Open a video on youtube.com or music.youtube.com and play it.
2. The popup shows how much is captured. The player loads ahead of playback (short tracks are often complete within seconds); for long videos keep playing to the end **without skipping**: skipped parts are missing (*gaps*).
3. Pick a format and convert. The file appears in the browser's downloads.

If the extension was installed while a video was already playing, reload the tab.

## Limits and risks

- **Detection**: no extra request is made to YouTube; traffic is the normal player's. YouTube's own scripts could still notice the modified prototypes or the page messages (`yt2mp3:*` channels). Lower risk than yt-dlp, not zero, and still against YouTube's terms of service.
- **Completeness**: based on what the player buffered; seeking back over a gap fills it. Changing quality mid-way can switch the audio format: the popup then warns that the file may be unusable.
- **DRM**: protected videos (EME, e.g. rented movies) are refused; their data is encrypted anyway.
- **Memory**: captures live in the tab until it is closed or 4 newer captures replace them; 300 MB cap per capture.
- **Server needed**: every format, *Original* included, goes through the server (Chromium cannot save a local blob from a service worker; the same path is used in Firefox for simplicity).
- **Token**: stored in the browser profile (`storage.local`). Anyone with it can use the conversion API (not YouTube, not cookies). Rotate it by changing `CONVERT_TOKEN`. Download links (`/api/convert/files/<id>`) work without the token for 10 minutes.

## Testing

- `cd extension && npm run lint` (`web-ext lint`, run in CI).
- Outside CI (YouTube serves only ~60 s to headless browsers and may block CI IPs; use short videos, default `jNQXAC9IVRw`, 19 s):
  - `e2e/tools/extension-capture.mjs`: injects `inject.js` into Chromium, plays a video, exports the capture to `shots/capture.webm`.
  - `e2e/tools/extension-chromium.mjs`: loads the **real Chromium build** (persistent context), configures it, captures on YouTube, converts through a running server (`mp3` and `original` by default) and checks the downloads. Build it first with `EXTRA_HOST_PERMISSIONS=http://localhost/* node scripts/build.mjs chromium` (test-only pre-grant: automated browsers cannot click the permission prompt).
  - `e2e/tools/extension-firefox.py`: same check in a **real Firefox** through geckodriver (raw WebDriver, no dependency). Run geckodriver with `--allow-system-access` (e.g. from `selenium/standalone-firefox`, `--entrypoint` geckodriver): WebDriver cannot navigate to `moz-extension://`, so the test opens the options page from the browser chrome and drives the extension from there. Zip `dist/firefox` (built with `EXTRA_HOST_PERMISSIONS`) and pass it as `ADDON_ZIP`.
- Server side: `backend/test/convert.test.ts` (fake ffmpeg fixture).

`npm audit` in `extension/` reports `node-forge` (via `web-ext` → `@devicefarmer/adbkit`, Android debugging) with no fixed release. It is a dev-only tool; nothing from `node_modules` is packaged in the extension.
