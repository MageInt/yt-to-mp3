import { useCallback, useEffect, useRef, useState } from 'react';
import DownloadForm from './components/DownloadForm';
import ProgressBar from './components/ProgressBar';
import TrackList from './components/TrackList';
import CookiesPanel from './components/CookiesPanel';
import {
  API_BASE,
  FALLBACK_CONFIG,
  fetchConfig,
  fetchSession,
  cancelJob,
  triggerDownload,
  type AppConfig,
  type JobEvent,
  type SessionInfo,
  type TrackFile,
} from './api';

type Status = 'idle' | 'pending' | 'queued' | 'downloading' | 'completed' | 'failed';

function formatFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('format');
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [format, setFormat] = useState<string>(() => formatFromUrl() ?? 'mp3');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [files, setFiles] = useState<TrackFile[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const cookiesRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        setConfig(cfg);
        setFormat((current) => (cfg.formats.some(f => f.id === current) ? current : cfg.defaultFormat));
      })
      .catch(() => {
        setConfig(FALLBACK_CONFIG);
        setConfigError(true);
        setFormat(FALLBACK_CONFIG.defaultFormat);
      });
    fetchSession()
      .then(setSession)
      .catch(() => setSessionError(true));
    return () => eventSourceRef.current?.close();
  }, []);

  const showCookies = () => {
    setCookiesOpen(true);
    requestAnimationFrame(() => cookiesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  // The chosen format lives in the URL so reloads and shared links keep it.
  const changeFormat = (id: string) => {
    setFormat(id);
    const params = new URLSearchParams(window.location.search);
    params.set('format', id);
    window.history.replaceState(null, '', `?${params}`);
  };

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStatus('idle');
    setProgress(0);
    setQueuePosition(null);
    setError(null);
    setJobId(null);
    setFiles([]);
    setFilename(null);
    setErrorCode(null);
  }, []);

  // Escape clears a finished or failed job.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (status === 'completed' || status === 'failed')) reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, reset]);

  const fail = (message: string, code?: string) => {
    setStatus('failed');
    setError(message);
    setErrorCode(code ?? null);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

  const handleSubmit = async (url: string) => {
    reset();
    setStatus('pending');

    let id: string;
    let initialStatus: string;
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start the download');
      id = data.id;
      initialStatus = data.status;
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        fail('Request timed out. The server may be busy, please try again.');
      } else {
        fail(err instanceof Error ? err.message : 'Something went wrong');
      }
      return;
    }

    setJobId(id);
    setStatus(initialStatus === 'queued' ? 'queued' : 'downloading');

    const es = new EventSource(`${API_BASE}/jobs/${id}/progress`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data: JobEvent = JSON.parse(event.data);

      if (data.type === 'queued') {
        setStatus('queued');
        setQueuePosition(data.position);
      } else if (data.type === 'progress') {
        setStatus('downloading');
        setQueuePosition(null);
        setProgress(data.progress);
      } else if (data.type === 'completed') {
        es.close();
        eventSourceRef.current = null;
        setProgress(100);
        setStatus('completed');
        setFilename(data.filename);
        if (data.isPlaylist && data.files.length > 1) {
          setFiles(data.files);
        } else {
          triggerDownload(`${API_BASE}/jobs/${id}/file`, data.filename);
        }
      } else if (data.type === 'failed' && data.code === 'cancelled') {
        reset();
      } else if (data.type === 'failed') {
        fail(data.error || 'Download failed', data.code);
        if (data.code === 'bot_check') {
          // The session may have been refreshed or expired meanwhile.
          fetchSession().then(setSession).catch(() => {});
          showCookies();
        }
      }
    };

    es.onerror = () => fail('Connection lost. Please try again.');
  };

  const formats = config?.formats ?? null;
  const formatLabel = formats?.find(f => f.id === format)?.label ?? format.toUpperCase();
  const busy = status === 'pending' || status === 'queued' || status === 'downloading';

  const handleCancel = () => {
    if (jobId) cancelJob(jobId).finally(reset);
  };

  return (
    <>
      <header className="topbar">
        <a href="/" className="row brand" aria-label="yt-to-mp3 home">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <strong>yt-to-mp3</strong>
        </a>
      </header>

      <main className="page stack">
        <div className="intro">
          <h1>Download audio from YouTube</h1>
          <p className="muted">Paste a video link, pick a format, get the file.</p>
        </div>

        {configError && (
          <div className="alert alert-warning" role="status">
            <span className="icon" aria-hidden="true">!</span>
            <div>Could not load server settings. Only MP3 is available.</div>
          </div>
        )}

        <section className="card">
          <DownloadForm
            formats={formats}
            format={format}
            onFormatChange={changeFormat}
            playlistsEnabled={config?.playlistsEnabled ?? false}
            busy={busy}
            busyLabel={status === 'queued' ? 'In queue…' : status === 'downloading' ? 'Downloading…' : 'Starting…'}
            onSubmit={handleSubmit}
          />
        </section>

        {busy && (
          <ProgressBar
            progress={progress}
            status={status}
            queuePosition={queuePosition}
            formatLabel={formatLabel}
            onCancel={jobId ? handleCancel : undefined}
          />
        )}

        {status === 'completed' && files.length > 0 && jobId && (
          <TrackList files={files} jobId={jobId} onReset={reset} />
        )}

        {status === 'completed' && files.length === 0 && jobId && filename && (
          <div className="alert alert-success result" role="status">
            <span className="icon" aria-hidden="true">✓</span>
            <div className="result-body">
              <strong>Ready</strong>
              <span className="result-file" title={filename}>{filename}</span>
              <span className="muted">Your download should start automatically.</span>
            </div>
            <div className="result-actions">
              <a className="btn btn-sm" href={`${API_BASE}/jobs/${jobId}/file`} download={filename}>
                Download again
              </a>
              <button className="btn btn-ghost btn-sm" onClick={reset}>Convert another</button>
            </div>
          </div>
        )}

        {status === 'failed' && error && (
          <div className="alert alert-danger result" role="alert">
            <span className="icon" aria-hidden="true">✕</span>
            <div className="result-body">
              <strong>Download failed</strong>
              <span className="error-text">{error}</span>
            </div>
            <div className="result-actions">
              {errorCode === 'bot_check' && (
                <button className="btn btn-sm" onClick={showCookies}>Add YouTube cookies</button>
              )}
              <button className={errorCode === 'bot_check' ? 'btn btn-ghost btn-sm' : 'btn btn-sm'} onClick={reset}>
                Try again
              </button>
            </div>
          </div>
        )}

        <CookiesPanel
          ref={cookiesRef}
          session={session}
          sessionError={sessionError}
          open={cookiesOpen}
          onToggle={setCookiesOpen}
          onSessionChange={setSession}
        />
      </main>

      <footer className="footer muted">
        Powered by yt-dlp &amp; ffmpeg · files are deleted after{' '}
        <span className="mono num">{config?.jobTtlMinutes ?? 30}</span> min · <kbd>/</kbd> focuses the link field
      </footer>
    </>
  );
}

export default App;
