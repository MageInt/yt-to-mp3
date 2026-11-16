# CI & release

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml). Triggered on every pull request to `main`, on push to `main` (merged PRs included), every Sunday at 04:17 UTC (catch-up for merges made by a bot, which do not trigger push workflows; if HEAD is already tagged, the run stops at `version` and `test`/`scan` are skipped) and manually (`workflow_dispatch`). Actions are pinned to a commit SHA and kept up to date by Dependabot.

## Jobs

1. **`test`**: on Node from `.nvmrc`:
   - backend: `npm ci`, typecheck, unit tests, build, `npm audit --audit-level=high`;
   - frontend: `npm ci`, build, audit;
   - extension: `npm ci`, `web-ext lint` of the Firefox build (no audit gate, see [extension.md](extension.md#testing)).
2. **`scan`**: Trivy on the repository (vulnerable dependencies, secrets, misconfigurations; CRITICAL/HIGH with a fix available fail the run).
3. **`version`** (not on PRs): computes the next version from git tags and commit messages, see below.
4. **`image`** (after `test` and `scan`):
   1. build the amd64 image (`load: true`), start it, wait for `/api/health`;
   2. run Playwright `npm run test:offline` (tests tagged `@network` are skipped: YouTube often blocks CI IPs);
   3. Trivy scan of the image (CRITICAL/HIGH with a fix available block the release);
   4. on `main` only: build `linux/amd64` + `linux/arm64` and push to GHCR with provenance + SBOM. On PRs only the amd64 image is built (QEMU and the multi-arch step are skipped) and nothing is pushed.
5. **`release`**: package the extensions (`yt-to-mp3-capture-firefox-*.zip`, `yt-to-mp3-capture-chromium-*.zip`, unsigned) and create the git tag and the GitHub Release (auto-generated notes, `docker pull` command, both zips attached).
6. **`dependabot-merge`** (PRs opened by Dependabot whose branch contains `-mineures`): once all the above pass, squash-merges the PR and dispatches the workflow on `main`, which releases a patch version.
7. **`cleanup`** (after a publication and every Sunday, never on PRs): prunes GHCR with `dataaxiom/ghcr-cleanup-action`, keeping the last 10 tagged images and `latest`, deleting untagged versions, orphaned attestations and incomplete multi-arch images.

If any step fails, nothing is pushed or released.

## Versioning

Computed from the commits since the last `vX.Y.Z` tag (Conventional Commits):

- No `vX.Y.Z` tag yet → `v1.0.0`.
- `type!:` or `BREAKING CHANGE`, or `#major` in a message → major (`v1.0.7` → `v2.0.0`).
- Otherwise `feat:`, or `#minor` in a message → minor (`v1.1.0`).
- Otherwise → patch (`v1.0.8`).
- `[skip release]` in the head commit message → nothing is published. Nothing is published either if `HEAD` is already tagged.

## Image tags

`ghcr.io/mageint/yt-to-mp3` (multi-arch amd64 + arm64) gets the tags `:1.0.8`, `:1.0`, `:latest` and `:sha-<short>`.

## Dependencies

[`.github/dependabot.yml`](../.github/dependabot.yml) checks every Monday at 03:00 (Europe/Paris), with a 3-day cooldown on new releases: npm (`backend`, `frontend`, `e2e`, `extension`), the Docker base image and GitHub Actions. Minor and patch updates are grouped per ecosystem (`npm-mineures`, `docker-mineures`, `github-actions-mineures`) and merged automatically when CI passes; major updates get their own PR and are reviewed by hand. `yt-dlp` has no manifest: the Dockerfile installs the latest release at each image build.

## One-time setup

- Auth uses `GITHUB_TOKEN`, no secret to add.
- Settings → Actions → General → Workflow permissions: "Read and write permissions" and "Allow GitHub Actions to create and approve pull requests" (needed by `dependabot-merge` to merge and dispatch the release).
- After the first push, the GHCR package is **private** by default. To make it public: GitHub → Packages → `yt-to-mp3` → Package settings → Change visibility.

## Changing the workflow

Lint it before pushing:

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest
```
