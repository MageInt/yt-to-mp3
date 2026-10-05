# CLAUDE.md

yt-to-mp3: paste a YouTube link, get an MP3. One container: Express 5 backend (API + static SPA) and React 19/Vite 8 frontend, with `yt-dlp` + `ffmpeg` doing the extraction. Fork of `oconnorj1/yt-to-mp3`, published to `ghcr.io/mageint/yt-to-mp3`.

## Documentation

- [docs/architecture.md](docs/architecture.md): components, job lifecycle, container layout
- [docs/api.md](docs/api.md): HTTP endpoints, SSE events, error codes
- [docs/configuration.md](docs/configuration.md): environment variables
- [docs/development.md](docs/development.md): local dev, tests, e2e, dependency updates
- [docs/security.md](docs/security.md): threat model, mitigations, audit log
- [docs/ci-release.md](docs/ci-release.md): GitHub Actions workflow, versioning, GHCR tags

## Layout

```
backend/src/{index,app,config}.ts   entry, Express app factory, env config
backend/src/routes/                 jobs.ts (/api/jobs, /api/config), session.ts (/api/session, cookies upload)
backend/src/middleware/session.ts   session cookie, requireSession, same-origin (CSRF) check
backend/src/services/               downloadManager (queue, yt-dlp, SSE, cleanup), urlValidator (YouTube allowlist,
                                    video/playlist detection), audioFormats (output formats),
                                    sessionStore (in-memory sessions), cookieJar (cookies.txt parser),
                                    userAgent (UA paired with cookies at upload, forwarded to yt-dlp)
backend/test/                       node:test unit + HTTP tests + yt-dlp args + queue (fixtures/fake-yt-dlp.mjs)
frontend/src/                       App.tsx + components (DownloadForm, ProgressBar, TrackList, CookiesPanel), api.ts
frontend/src/styles/theme.css       Dorian UI tokens (dark only) + fonts/; app styles in src/index.css
e2e/tests/                          Playwright (tag @network = real YouTube download)
Dockerfile, docker-compose.yml      Node 24 alpine, non-root, healthcheck
.github/workflows/release.yml       test → image → e2e → push GHCR → GitHub release (push on main only)
```

## Commands

```bash
cd backend && npm ci && npm run typecheck && npm test && npm run build
cd frontend && npm ci && npm run build
docker compose up --build                     # app on :8080
cd e2e && npm ci && npm run test:offline      # container must be running; `npm test` includes @network
```

On this machine VS Code runs as a Flatpak without node or docker: prefix with `flatpak-spawn --host` and use Podman containers, e.g.
`flatpak-spawn --host podman run --rm -v "$PWD/backend":/w:Z -w /w node:24-alpine sh -c "npm ci && npm test"`
and `podman build --format docker` (otherwise the HEALTHCHECK is dropped).

## Conventions

- UI follows the Dorian UI charter (load the `dorian-ui` skill before UI work): tokens only, no hardcoded colors.
- Playlists are disabled by default (`ENABLE_PLAYLISTS`); keep the playlist code paths working.
- Downloads go through the queue in `downloadManager.ts` (`pump()`); never spawn yt-dlp outside it. Keep `MAX_PARALLEL_PER_SESSION` semantics: one account's cookies are not used in parallel.
- User cookies are secrets: memory only, never logged, never returned by the API, written only to `SECRETS_TMP_DIR` while yt-dlp runs. Jobs must stay bound to their session. Read `docs/security.md#user-cookies` before touching sessions or cookies.
- TypeScript strict, ESM (`.js` suffix in backend relative imports), 2-space indent, single quotes.
- Every new env variable goes through `backend/src/config.ts`.
- Every user-supplied URL goes through `validateYoutubeUrl`. Never pass user input to yt-dlp before `--`.
- New backend behavior gets a test in `backend/test/`; anything visible in the UI gets a Playwright test (tag `@network` if it hits YouTube).
- Commit messages: add `#minor` / `#major` to bump the release version (patch by default).

## Keep this file and docs/ up to date

**Whenever a change affects something described here or in `docs/`, update the relevant file in the same change.** In particular:

- API route, payload, status code or SSE event → `docs/api.md`
- Env variable or default → `docs/configuration.md` (and `config.ts`)
- Module added, moved or responsibility changed → `docs/architecture.md` and the Layout section above
- Dependency major version, Node version, Dockerfile or test tooling → `docs/development.md`, this file
- Security-relevant change (validation, limits, headers, container) → `docs/security.md`
- Workflow, versioning or registry → `docs/ci-release.md`
- User-facing feature → `README.md`

If a doc no longer matches the code, fix the doc instead of leaving it stale.
