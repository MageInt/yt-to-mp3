export interface AudioFormat {
  id: string;
  label: string;
  description: string;
  // Value passed to yt-dlp `--audio-format`.
  ytdlp: string;
  // Extension of the file yt-dlp produces.
  ext: string;
}

export const AUDIO_FORMATS: readonly AudioFormat[] = [
  { id: 'mp3', label: 'MP3', description: 'Best VBR quality, plays everywhere', ytdlp: 'mp3', ext: 'mp3' },
  { id: 'm4a', label: 'M4A', description: 'AAC, great for Apple devices', ytdlp: 'm4a', ext: 'm4a' },
  { id: 'opus', label: 'Opus', description: 'Smallest files at the same quality', ytdlp: 'opus', ext: 'opus' },
  { id: 'ogg', label: 'OGG', description: 'Vorbis, open format', ytdlp: 'vorbis', ext: 'ogg' },
  { id: 'flac', label: 'FLAC', description: 'Lossless container, larger files', ytdlp: 'flac', ext: 'flac' },
  { id: 'wav', label: 'WAV', description: 'Uncompressed, for editing', ytdlp: 'wav', ext: 'wav' },
];

export const DEFAULT_FORMAT = 'mp3';

export function getAudioFormatStrict(id: unknown): AudioFormat | undefined {
  return AUDIO_FORMATS.find(f => f.id === id);
}

export function getAudioFormat(id: unknown): AudioFormat | undefined {
  if (id === undefined || id === null || id === '') {
    return AUDIO_FORMATS.find(f => f.id === DEFAULT_FORMAT);
  }
  return AUDIO_FORMATS.find(f => f.id === id);
}
