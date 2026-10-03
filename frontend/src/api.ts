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
  | { type: 'failed'; error: string };

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

export function triggerDownload(href: string, filename: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
