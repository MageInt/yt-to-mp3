// Runs in the page (MAIN world) at document_start, before YouTube's player.
// Keeps a copy of every audio segment the player hands to Media Source Extensions, so the audio
// can be saved once it has been played. No extra request is made to YouTube.
(() => {
  'use strict';

  const CHANNEL_IN = 'yt2mp3:ext';
  const CHANNEL_OUT = 'yt2mp3:page';
  const MAX_BYTES = 300 * 1024 * 1024;
  const MAX_CAPTURES = 4;

  // No global marker: anything added to the page is visible to YouTube's scripts.
  if (typeof MediaSource === 'undefined') return;

  const captures = [];
  const bySourceBuffer = new WeakMap();
  let nextId = 1;

  function player() {
    return document.getElementById('movie_player');
  }

  function urlVideoId() {
    return new URLSearchParams(location.search).get('v');
  }

  function videoData() {
    try {
      return player()?.getVideoData?.() ?? {};
    } catch {
      return {};
    }
  }

  function isAdShowing() {
    return Boolean(player()?.classList?.contains('ad-showing'));
  }

  function extensionFor(type) {
    return /^audio\/mp4/i.test(type) ? 'm4a' : 'webm';
  }

  // Cheap content hash, to skip segments the player appends twice (e.g. after a seek).
  function fingerprint(bytes) {
    let h = 0x811c9dc5;
    const step = bytes.length > 65536 ? Math.floor(bytes.length / 65536) : 1;
    for (let i = 0; i < bytes.length; i += step) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return `${bytes.length}:${h >>> 0}`;
  }

  function mergeRange(ranges, start, end) {
    ranges.push([start, end]);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of ranges) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1] + 0.25) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    return merged;
  }

  function newCapture(mediaSource, type) {
    const data = videoData();
    const capture = {
      id: nextId++,
      type,
      mediaSource,
      videoId: data.video_id || urlVideoId(),
      title: data.title || document.title.replace(/ - YouTube( Music)?$/, ''),
      author: data.author || '',
      isAd: isAdShowing(),
      chunks: [],
      seen: new Set(),
      bytes: 0,
      coverage: [],
      truncated: false,
      formatChanged: false,
    };
    captures.push(capture);
    while (captures.length > MAX_CAPTURES) captures.shift();
    return capture;
  }

  function record(capture, data) {
    if (capture.truncated) return;
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else return;
    const key = fingerprint(bytes);
    if (capture.seen.has(key)) return;
    if (capture.bytes + bytes.byteLength > MAX_BYTES) {
      capture.truncated = true;
      return;
    }
    capture.seen.add(key);
    capture.chunks.push(bytes.slice());
    capture.bytes += bytes.byteLength;
    // The title is often only known once playback has started.
    if (capture.chunks.length <= 3) {
      const current = videoData();
      if (current.video_id === capture.videoId && current.title) {
        capture.title = current.title;
        capture.author = current.author || capture.author;
      }
    }
  }

  function trackCoverage(capture, sourceBuffer) {
    try {
      const ranges = sourceBuffer.buffered;
      for (let i = 0; i < ranges.length; i++) {
        capture.coverage = mergeRange(capture.coverage, ranges.start(i), ranges.end(i));
      }
    } catch {
      // The SourceBuffer may have been removed from its MediaSource.
    }
  }

  // Wrap with Proxies: the functions keep their native name/length and toString output.
  const nativeAdd = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = new Proxy(nativeAdd, {
    apply(target, mediaSource, args) {
      const sourceBuffer = Reflect.apply(target, mediaSource, args);
      const type = String(args[0] ?? '');
      if (/^audio\//i.test(type)) {
        const capture = newCapture(mediaSource, type);
        bySourceBuffer.set(sourceBuffer, capture);
        sourceBuffer.addEventListener('updateend', () => trackCoverage(capture, sourceBuffer));
      }
      return sourceBuffer;
    },
  });

  const nativeAppend = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = new Proxy(nativeAppend, {
    apply(target, sourceBuffer, args) {
      const capture = bySourceBuffer.get(sourceBuffer);
      if (capture) {
        try {
          record(capture, args[0]);
        } catch {
          // Never break playback because of the capture.
        }
      }
      return Reflect.apply(target, sourceBuffer, args);
    },
  });

  if (SourceBuffer.prototype.changeType) {
    const nativeChangeType = SourceBuffer.prototype.changeType;
    SourceBuffer.prototype.changeType = new Proxy(nativeChangeType, {
      apply(target, sourceBuffer, args) {
        const capture = bySourceBuffer.get(sourceBuffer);
        if (capture && String(args[0]) !== capture.type) capture.formatChanged = true;
        return Reflect.apply(target, sourceBuffer, args);
      },
    });
  }

  function currentCapture() {
    const id = urlVideoId() || videoData().video_id;
    const candidates = captures.filter(c => !c.isAd && c.chunks.length > 0);
    return [...candidates].reverse().find(c => c.videoId === id) ?? null;
  }

  function isProtected() {
    return Array.from(document.querySelectorAll('video')).some(v => v.mediaKeys);
  }

  function durationOf(capture) {
    const data = videoData();
    let duration = NaN;
    if (data.video_id === capture.videoId) {
      try {
        duration = player()?.getDuration?.();
      } catch {}
    }
    if (!(duration > 0)) duration = capture.mediaSource.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  function status() {
    const capture = currentCapture();
    if (!capture) return { available: false, protected: isProtected(), videoId: urlVideoId() };
    const duration = durationOf(capture);
    const covered = capture.coverage.reduce((sum, [s, e]) => sum + (e - s), 0);
    const startsAtZero = capture.coverage.length > 0 && capture.coverage[0][0] <= 1;
    return {
      available: true,
      protected: isProtected(),
      videoId: capture.videoId,
      title: capture.title,
      author: capture.author,
      mime: capture.type.split(';')[0],
      ext: extensionFor(capture.type),
      bytes: capture.bytes,
      duration,
      covered: duration ? Math.min(covered, duration) : covered,
      gaps: Math.max(0, capture.coverage.length - 1),
      complete: Boolean(duration && startsAtZero && capture.coverage.length === 1 && covered >= duration - 1.5),
      truncated: capture.truncated,
      formatChanged: capture.formatChanged,
    };
  }

  function exportCapture() {
    const capture = currentCapture();
    if (!capture) return { error: 'Nothing captured for this video yet.' };
    if (isProtected()) return { error: 'This video is DRM-protected: its audio cannot be saved.' };
    const out = new Uint8Array(capture.bytes);
    let offset = 0;
    for (const chunk of capture.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: status(), buffer: out.buffer };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL_IN) return;
    const { id, cmd } = event.data;
    if (cmd === 'status') {
      window.postMessage({ channel: CHANNEL_OUT, id, result: status() }, '*');
    } else if (cmd === 'export') {
      const result = exportCapture();
      window.postMessage({ channel: CHANNEL_OUT, id, result }, '*', result.buffer ? [result.buffer] : []);
    }
  });
})();
