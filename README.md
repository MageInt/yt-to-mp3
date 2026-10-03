# yt-to-mp3

<p align="center">
  <img src="frontend/public/yt2mp3logo.png" alt="yt-to-mp3" width="400" />
</p>

[![Build, test & release](https://github.com/MageInt/yt-to-mp3/actions/workflows/release.yml/badge.svg)](https://github.com/MageInt/yt-to-mp3/actions/workflows/release.yml)
[![Release](https://img.shields.io/github/v/release/MageInt/yt-to-mp3)](https://github.com/MageInt/yt-to-mp3/releases)

Paste a YouTube link, get an MP3. Containerized, one command to run.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Development](#development)
- [E2E Tests](#e2e-tests)
- [Documentation](#documentation)
- [License](#license)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose

## Quick Start

### Build from source

```bash
docker compose up --build
```

### Use pre-built image

```yaml
services:
  app:
    image: ghcr.io/mageint/yt-to-mp3:latest
    ports:
      - "8080:8080"
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
```

```bash
docker compose up
```

Open [http://localhost:8080](http://localhost:8080), paste a YouTube URL, click Download.

Limits (concurrent jobs, playlist size, rate limit…) are configurable through environment variables: see [docs/configuration.md](docs/configuration.md).

## Features

- One-click YouTube audio extraction
- Playlist support — download entire playlists with individual track selection
- Runs entirely in Docker — no local dependencies needed
- React frontend with loading and error states
- yt-dlp + ffmpeg under the hood for best-quality MP3s
- Real-time download progress bar
- Dark mode support
- Hardened: YouTube-only URL allowlist, rate limiting, concurrency limits, security headers, non-root container

## Architecture

```
┌──────────┐     ┌──────────────────────────────────────┐
│ Browser  │────▶│  Node + Express                       │
│ :8080    │     │  - API routes (/api/*)                │
│          │     │  - Static frontend (React SPA)        │
│          │     │  - yt-dlp + ffmpeg                    │
└──────────┘     └──────────────────────────────────────┘
```

A single container runs both the React frontend (served as static files) and the Node.js/Express backend. No Nginx or separate frontend container needed.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, TypeScript |
| Backend | Node.js 24, Express 5, TypeScript, helmet |
| Audio | yt-dlp (PyPI), ffmpeg |
| Container | Docker, Docker Compose |
| Tests | node:test (backend), Playwright (e2e) |
| CI/CD | GitHub Actions → GHCR + GitHub Releases |

## Project Structure

```
├── backend/             Express API
│   ├── src/
│   │   ├── index.ts           Server entry
│   │   ├── app.ts             Express app factory
│   │   ├── config.ts          Environment variables
│   │   ├── routes/jobs.ts     API endpoints
│   │   └── services/
│   │       ├── downloadManager.ts  yt-dlp process management
│   │       └── urlValidator.ts     YouTube URL allowlist
│   └── test/                  Unit + HTTP tests (node:test)
├── frontend/            React + Vite app
│   ├── src/
│   │   ├── App.tsx            Main component
│   │   ├── components/
│   │   │   ├── UrlInput.tsx   URL input + download button
│   │   │   ├── ProgressBar.tsx  SSE progress bar
│   │   │   └── TrackList.tsx    Multi-track playlist UI
│   │   └── main.tsx           App entry
│   └── index.css              Theme + layout styles
├── e2e/                 Playwright tests
│   └── tests/download.spec.ts
├── docs/                Project documentation
├── .github/workflows/release.yml  CI: test, build, release image
├── CLAUDE.md            Guide for AI assistants
├── docker-compose.yml
└── Dockerfile
```

## Development

Run each service locally for hot reloading:

```bash
# Terminal 1 — Backend
cd backend && npm ci && PORT=3001 npm run dev

# Terminal 2 — Frontend (proxies /api to localhost:3001)
cd frontend && npm ci && npm run dev
```

Backend tests: `cd backend && npm test`. More in [docs/development.md](docs/development.md).

## E2E Tests

```bash
# Ensure containers are running, then:
cd e2e && npm ci && npx playwright test   # or `npm run test:offline` to skip real YouTube downloads
```

## Documentation

- [Architecture](docs/architecture.md)
- [HTTP API](docs/api.md)
- [Configuration](docs/configuration.md)
- [Development](docs/development.md)
- [Security](docs/security.md)
- [CI & release](docs/ci-release.md)

## License

MIT
