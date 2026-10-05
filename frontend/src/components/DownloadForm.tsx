import { useEffect, useRef, useState } from 'react';
import type { AudioFormat } from '../api';

interface Props {
  formats: AudioFormat[] | null;
  format: string;
  onFormatChange: (id: string) => void;
  playlistsEnabled: boolean;
  busy: boolean;
  busyLabel?: string;
  onSubmit: (url: string) => void;
}

function DownloadForm({ formats, format, onFormatChange, playlistsEnabled, busy, busyLabel = 'Starting…', onSubmit }: Props) {
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  // "/" focuses the URL field from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() && !busy) onSubmit(url.trim());
  };

  const hasList = /[?&]list=/.test(url);
  const hasVideo = /[?&]v=[\w-]|youtu\.be\/[\w-]|\/(shorts|live|embed)\/[\w-]/.test(url);
  const selected = formats?.find(f => f.id === format);

  return (
    <form onSubmit={handleSubmit} className="stack form">
      <div className="field">
        <label htmlFor="url">YouTube link</label>
        <div className="url-row">
          <input
            id="url"
            ref={inputRef}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="input input-lg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            disabled={busy}
            autoFocus
          />
          {canPaste && (
            <button type="button" className="btn btn-ghost btn-lg" onClick={handlePaste} disabled={busy}>
              Paste
            </button>
          )}
        </div>
        {hasList && !playlistsEnabled && hasVideo && (
          <p className="hint">Playlist link detected: only this video will be downloaded.</p>
        )}
        {hasList && !playlistsEnabled && !hasVideo && (
          <p className="hint hint-warning">This is a playlist link. Open one video and paste its link instead.</p>
        )}
        {hasList && playlistsEnabled && (
          <p className="hint">Playlist link detected: every track of the list will be downloaded.</p>
        )}
      </div>

      <div className="field">
        <span className="field-label" id="format-label">Format</span>
        {formats ? (
          <div className="segmented format-picker" role="radiogroup" aria-labelledby="format-label">
            {formats.map(f => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={f.id === format}
                onClick={() => onFormatChange(f.id)}
                disabled={busy}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="skeleton format-skeleton" aria-hidden="true" />
        )}
        <p className="hint">{selected?.description ?? ' '}</p>
      </div>

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !url.trim()} aria-busy={busy}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> {busyLabel}
          </>
        ) : (
          `Download ${selected?.label ?? ''}`.trim()
        )}
      </button>
    </form>
  );
}

export default DownloadForm;
