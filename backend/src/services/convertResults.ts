import crypto from 'crypto';

// Converted files kept briefly so a browser's download manager can fetch them by URL: Chromium
// extensions (service worker) cannot hand a local blob to chrome.downloads. The id is a 256-bit
// capability; the URL works for RESULT_TTL_MS, then the file is deleted.

export const RESULT_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 20;

interface StoredResult {
  path: string;
  filename: string;
  expiresAt: number;
  cleanup: () => void;
}

const results = new Map<string, StoredResult>();

function drop(id: string) {
  const result = results.get(id);
  if (!result) return;
  results.delete(id);
  result.cleanup();
}

export function sweepResults(now = Date.now()) {
  for (const [id, result] of results) {
    if (result.expiresAt <= now) drop(id);
  }
}

setInterval(() => sweepResults(), 60 * 1000).unref();

export function storeResult(path: string, filename: string, cleanup: () => void) {
  while (results.size >= MAX_RESULTS) {
    const oldest = results.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest);
  }
  const id = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + RESULT_TTL_MS;
  results.set(id, { path, filename, expiresAt, cleanup });
  return { id, expiresAt };
}

export function getResult(id: string): StoredResult | undefined {
  const result = results.get(id);
  if (!result) return undefined;
  if (result.expiresAt <= Date.now()) {
    drop(id);
    return undefined;
  }
  return result;
}
