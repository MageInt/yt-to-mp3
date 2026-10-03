# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:24-alpine

LABEL org.opencontainers.image.title="yt-to-mp3" \
      org.opencontainers.image.description="Paste a YouTube link, get an MP3." \
      org.opencontainers.image.source="https://github.com/MageInt/yt-to-mp3" \
      org.opencontainers.image.licenses="MIT"

# yt-dlp from PyPI (the apk package lags behind YouTube changes). The [default] extra
# ships yt-dlp-ejs, and Node (already in the image) is used as the JS challenge runtime.
RUN apk add --no-cache ffmpeg python3 \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade "yt-dlp[default]" \
 && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
 && printf -- '--js-runtimes node\n--no-cache-dir\n' > /etc/yt-dlp.conf \
 && mkdir -p /app/tmp && chown node:node /app/tmp

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    TMPDIR=/app/tmp

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/index.js"]
