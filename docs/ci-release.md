# CI & release

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml). Triggered **only on push to `main`** (merged PRs included). Runs are serialized (`concurrency: release`).

## Jobs

1. **`test`**: on Node from `.nvmrc`:
   - backend: `npm ci`, typecheck, unit tests, build, `npm audit --audit-level=high`;
   - frontend: `npm ci`, build, audit.
   - extension: `npm ci`, `web-ext lint` (no audit gate, see [extension.md](extension.md#testing)).
2. **`release`** (after `test`):
   1. compute the next version from git tags;
   2. build the image (`load: true`), start it, wait for `/api/health`;
   3. run Playwright `npm run test:offline` (tests tagged `@network` are skipped: YouTube often blocks CI IPs);
   4. push to GHCR with provenance + SBOM;
   5. build the Firefox extension zip (unsigned) and create the git tag and the GitHub Release (auto-generated notes, `docker pull` command, extension zip attached).

If any step fails, nothing is pushed or released.

## Versioning

- No `vX.Y.Z` tag yet → `v1.0.0`.
- Otherwise the patch is bumped (`v1.0.7` → `v1.0.8`).
- `#minor` in the head commit message → `v1.1.0`; `#major` → `v2.0.0`.

## Image tags

`ghcr.io/mageint/yt-to-mp3` gets the tags `:1.0.8`, `:1.0`, `:latest` and `:sha-<short>`.

## One-time setup

- Nothing to configure: auth uses `GITHUB_TOKEN` (`packages: write`, `contents: write`).
- After the first push, the GHCR package is **private** by default. To make it public: GitHub → Packages → `yt-to-mp3` → Package settings → Change visibility.
- Settings → Actions → General → Workflow permissions must allow "Read and write" if the org or repo restricts it.

## Changing the workflow

Lint it before pushing:

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest
```
