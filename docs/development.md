# Development

Requirements: Node.js 24 (see `.nvmrc`), and `yt-dlp` + `ffmpeg` on the `PATH` to actually download in dev. Docker or Podman to build the image.

## Run locally (hot reload)

```bash
# Terminal 1 — backend on :3001
cd backend && npm ci && PORT=3001 npm run dev

# Terminal 2 — frontend on :5173 (proxies /api to :3001)
cd frontend && npm ci && npm run dev
```

## Backend checks

```bash
cd backend
npm run typecheck   # tsc on src + test (tsconfig.test.json)
npm test            # node:test via tsx, files in backend/test/*.test.ts
npm run build       # emits dist/
```

Tests use `createApp()` from `src/app.ts` on an ephemeral port: no yt-dlp needed.

## Frontend build

```bash
cd frontend && npm run build   # tsc + vite build → dist/
```

## Docker image

```bash
docker compose up --build        # or: podman build --format docker -t yt-to-mp3:local .
```

With Podman, use `--format docker`, otherwise the `HEALTHCHECK` is dropped.

## E2E tests (Playwright)

Start the container on `:8080`, then:

```bash
cd e2e && npm ci
npx playwright install chromium
npm test               # all tests, including a real YouTube download (@network)
npm run test:offline   # skips @network tests (what CI runs)
```

`BASE_URL` overrides the target (default `http://localhost:8080`).

Without a local Node install, run inside the official image:

```bash
docker run --rm --network host -v "$PWD/e2e":/w -w /w mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test
```

Keep the Playwright image tag in sync with `@playwright/test` in `e2e/package.json`.

## Updating dependencies

```bash
npm outdated && npm install <pkg>@latest   # in each of backend/, frontend/, e2e/
npm audit
```

yt-dlp is not pinned: every image build installs the latest release (YouTube changes often).
