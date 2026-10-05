import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config.js';
import type { AudioFormat } from './audioFormats.js';

// Converts audio captured by the browser extension. The input is untrusted: ffmpeg only gets a
// local file, an explicit demuxer and the `file` protocol, and runs with a timeout.

export type InputKind = 'webm' | 'mp4';

export const INPUT_TYPES: Record<string, InputKind> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
};

const DEMUXERS: Record<InputKind, string> = { webm: 'matroska', mp4: 'mov' };

export class ConverterBusyError extends Error {}
export class ConversionError extends Error {}

let running = 0;

export interface Metadata {
  title?: string;
  artist?: string;
}

export function cleanMetadata(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned || undefined;
}

export function safeFilename(title: string | undefined, ext: string): string {
  const base = (title ?? 'audio').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return `${base || 'audio'}.${ext}`;
}

// Pseudo-format for the extension's "Original": same codec and container family, just remuxed
// (clean timestamps, proper headers), no re-encoding.
export function originalFormat(input: InputKind): AudioFormat {
  return { id: 'original', label: 'Original', description: 'Remuxed capture', ytdlp: '', ext: input === 'mp4' ? 'm4a' : 'webm' };
}

function codecArgs(format: AudioFormat, input: InputKind): string[] {
  switch (format.id) {
    case 'original':
      return input === 'mp4' ? ['-c:a', 'copy', '-movflags', '+faststart'] : ['-c:a', 'copy'];
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-q:a', '0'];
    case 'm4a':
      // YouTube's mp4 audio is already AAC: remux without re-encoding.
      return input === 'mp4' ? ['-c:a', 'copy', '-movflags', '+faststart'] : ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'];
    case 'opus':
      // YouTube's webm audio is already Opus: remux into Ogg without re-encoding.
      return input === 'webm' ? ['-c:a', 'copy'] : ['-c:a', 'libopus', '-b:a', '160k'];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-q:a', '6'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    default:
      throw new ConversionError(`Unsupported format ${format.id}`);
  }
}

export function buildFfmpegArgs(inputPath: string, input: InputKind, format: AudioFormat, outputPath: string, metadata: Metadata): string[] {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-protocol_whitelist', 'file',
    // Captured streams can restart timestamps after a seek: regenerate them.
    '-fflags', '+genpts',
    '-f', DEMUXERS[input],
    '-i', inputPath,
    '-vn', '-map', '0:a:0', '-map_metadata', '-1',
    ...codecArgs(format, input),
  ];
  if (metadata.title) args.push('-metadata', `title=${metadata.title}`);
  if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`);
  args.push('-y', outputPath);
  return args;
}

export interface ConversionResult {
  outputPath: string;
  cleanup: () => void;
}

export async function convertAudio(data: Buffer, input: InputKind, format: AudioFormat, metadata: Metadata): Promise<ConversionResult> {
  if (running >= config.maxConcurrentConversions) throw new ConverterBusyError();
  running++;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt2mp3-convert-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const inputPath = path.join(dir, `input.${input}`);
  const outputPath = path.join(dir, `output.${format.ext}`);

  try {
    fs.writeFileSync(inputPath, data);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(config.ffmpegPath, buildFfmpegArgs(inputPath, input, format, outputPath, metadata));
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      const timer = setTimeout(() => proc.kill('SIGKILL'), config.convertTimeoutMs);
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new ConversionError(`Could not start ffmpeg: ${err.message}`));
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(outputPath)) resolve();
        else {
          console.error(`[converter] ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
          reject(new ConversionError('Could not convert this audio. The capture may be incomplete or corrupted.'));
        }
      });
    });
    return { outputPath, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    running--;
  }
}
