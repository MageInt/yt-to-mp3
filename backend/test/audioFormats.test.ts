import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAudioFormat, DEFAULT_FORMAT } from '../src/services/audioFormats.js';

test('missing format falls back to the default', () => {
  for (const input of [undefined, null, '']) {
    assert.equal(getAudioFormat(input)?.id, DEFAULT_FORMAT);
  }
});

test('known formats resolve, unknown ones do not', () => {
  assert.equal(getAudioFormat('flac')?.ext, 'flac');
  assert.equal(getAudioFormat('ogg')?.ytdlp, 'vorbis');
  for (const input of ['exe', 'MP3', 42, {}, '--exec']) {
    assert.equal(getAudioFormat(input), undefined);
  }
});
