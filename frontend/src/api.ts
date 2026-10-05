export const API_BASE = '/api';

export interface AudioFormat {
  id: string;
  label: string;
  description: string;
}

export interface AppConfig {
  playlistsEnabled: boolean;
  defaultFormat: string;
  jobTtlMinutes: number;
  formats: AudioFormat[];
}

export interface TrackFile {
  filename: string;
}

export type JobEvent =
  | { type: 'progress'; progress: number }
  | { type: 'completed'; progress: number; filename: string; files: TrackFile[]; isPlaylist: boolean; format: string }
  | { type: 'failed'; error: string; code?: 'bot_check' };

export interface SessionInfo {
  hasCookies: boolean;
  cookieCount: number;
  cookiesUpdatedAt: number | null;
  cookiesExpireAt: number | null;
  expiresAt: number;
  idleTimeoutMinutes: number;
}

// Used when /api/config cannot be reached, so the form still works.
export const FALLBACK_CONFIG: AppConfig = {
  playlistsEnabled: false,
  defaultFormat: 'mp3',
  jobTtlMinutes: 30,
  formats: [{ id: 'mp3', label: 'MP3', description: 'Best VBR quality, plays everywhere' }],
};

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

// Starts (or resumes) the anonymous session that holds this browser's cookies on the server.
export async function fetchSession(): Promise<SessionInfo> {
  return readJson(await fetch(`${API_BASE}/session`, { cache: 'no-store' }));
}

export async function uploadCookies(cookies: string): Promise<SessionInfo> {
  const send = () => fetch(`${API_BASE}/session/cookies`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies }),
  });
  let res = await send();
  if (res.status === 401) {
    // Session expired: start a new one and retry once.
    await fetchSession();
    res = await send();
  }
  return readJson(res);
}

export async function forgetCookies(): Promise<SessionInfo> {
  return readJson(await fetch(`${API_BASE}/session/cookies`, { method: 'DELETE' }));
}

export function triggerDownload(href: string, filename: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
