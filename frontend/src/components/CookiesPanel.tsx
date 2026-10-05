import { forwardRef, useState } from 'react';
import { forgetCookies, uploadCookies, type SessionInfo } from '../api';

interface Props {
  session: SessionInfo | null;
  sessionError: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  onSessionChange: (session: SessionInfo) => void;
}

const MAX_FILE_SIZE = 100_000;

// Uploading over plain HTTP exposes the cookies to anyone on the network path.
const insecureTransport =
  typeof window !== 'undefined'
  && window.location.protocol === 'http:'
  && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

// Short, human label for a User-Agent ("Firefox on Linux"); the full string goes in a tooltip.
function describeUserAgent(ua: string) {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Version\/.*Safari\//.test(ua) ? 'Safari'
    : 'browser';
  const os =
    /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux|X11/.test(ua) ? 'Linux'
    : null;
  return os ? `${browser} on ${os}` : browser;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const CookiesPanel = forwardRef<HTMLDetailsElement, Props>(function CookiesPanel(
  { session, sessionError, open, onToggle, onSessionChange },
  ref,
) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const active = session?.hasCookies ?? false;

  const handleFile = (file: File | undefined) => {
    setError(null);
    setSaved(false);
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError('This file is too large to be a YouTube cookies.txt export.');
      return;
    }
    file.text().then((content) => {
      setText(content);
      setFileName(file.name);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const info = await uploadCookies(text);
      onSessionChange(info);
      // The secret no longer needs to live in the page.
      setText('');
      setFileName(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const handleForget = async () => {
    setError(null);
    setSaved(false);
    try {
      onSessionChange(await forgetCookies());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not forget cookies');
    }
  };

  return (
    <details
      ref={ref}
      className="disclosure cookies-panel"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        YouTube cookies
        {active ? (
          <span className="badge badge-success">✓ Active</span>
        ) : (
          <span className="badge">Optional</span>
        )}
      </summary>

      <div className="body stack">
        <p className="cookies-lead">
          Only needed when downloads fail with <em>“Sign in to confirm you’re not a bot”</em>: YouTube then wants a
          signed-in session. Your cookies stay attached to <strong>this browser only</strong>.
        </p>

        <div className="alert alert-warning" role="note">
          <span className="icon" aria-hidden="true">!</span>
          <div className="stack-sm">
            <strong>Your cookies are your signed-in Google account</strong>
            <span>
              Whoever holds them can act as you on YouTube and other Google services (Gmail, Drive…) until they
              expire or you sign out.
            </span>
            <ul className="tight-list">
              <li>Use a <strong>secondary Google account</strong>, never your main one.</li>
              <li>Only upload them to a server you run yourself or fully trust.</li>
              <li>Heavy automated use can get the account flagged by YouTube.</li>
            </ul>
          </div>
        </div>

        <details className="disclosure nested">
          <summary>What this server does with them</summary>
          <ul className="body tight-list">
            <li>Kept in memory only, linked to this browser through a private session cookie. Nothing is stored on disk or in a database.</li>
            <li>Only <span className="mono">youtube.com</span> and <span className="mono">google.com</span> cookies are kept, the rest of the file is dropped.</li>
            <li>
              Reused for all your downloads while the session lasts. During each download, yt-dlp reads a temporary
              copy kept in RAM only; that copy is deleted when the download ends, your saved cookies stay.
            </li>
            <li>Never sent back to the browser, never shared with other visitors.</li>
            <li>
              The <strong>User-Agent of the browser you upload from</strong> is saved with them and sent with every
              download that uses them, so YouTube sees the same browser the cookies come from. It is forgotten with the
              cookies.
            </li>
            <li>
              Wiped when you click <em>Forget</em>, after{' '}
              <span className="mono num">{session?.idleTimeoutMinutes ?? 120}</span> min without activity, or when the
              server restarts.
            </li>
          </ul>
        </details>

        <details className="disclosure nested">
          <summary>How to get your cookies.txt</summary>
          <ol className="body tight-list">
            <li>Open a <strong>private / incognito window</strong> and sign in to YouTube with your secondary account.</li>
            <li>In the same tab, open <span className="mono">youtube.com/robots.txt</span>.</li>
            <li>
              Export the cookies of <span className="mono">youtube.com</span> in <strong>Netscape format</strong> with an
              extension such as <em>Get cookies.txt LOCALLY</em> (allow it in private windows).
            </li>
            <li>
              <strong>Close the private window</strong> without signing out: otherwise YouTube rotates the session and the
              export stops working.
            </li>
            <li>
              Back in a <strong>normal window of the same browser</strong>, open this page and upload the file below.
              Its User-Agent is paired with the cookies, and private mode does not change it.
            </li>
          </ol>
          <p className="body hint-warning">
            Do not upload from the private window: closing it also ends your session here, and the cookies would no
            longer be usable.
          </p>
          <p className="body muted">
            Details:{' '}
            <a href="https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies" target="_blank" rel="noreferrer noopener">
              yt-dlp guide
            </a>
            .
          </p>
        </details>

        {insecureTransport && (
          <div className="alert alert-danger" role="note">
            <span className="icon" aria-hidden="true">!</span>
            <div className="stack-sm">
              <strong>This page is not served over HTTPS</strong>
              <span>
                Your cookies would travel unencrypted on the network. Only upload them on a network you trust, or put
                the app behind an HTTPS reverse proxy.
              </span>
            </div>
          </div>
        )}

        {sessionError && (
          <div className="alert alert-danger" role="alert">
            <span className="icon" aria-hidden="true">✕</span>
            <div>Could not start a session with the server. Reload the page.</div>
          </div>
        )}

        {active && session && (
          <div className="cookies-status row">
            <span className="badge badge-success">✓ Active</span>
            <span className="muted">
              <span className="mono num">{session.cookieCount}</span> cookies
              {session.cookiesExpireAt && <> · expire {formatDate(session.cookiesExpireAt)}</>}
              {' · '}
              {session.cookiesUserAgent ? (
                <span title={session.cookiesUserAgent}>paired with {describeUserAgent(session.cookiesUserAgent)}</span>
              ) : (
                <span title="This browser's User-Agent could not be used; yt-dlp's default is sent instead.">default User-Agent</span>
              )}
            </span>
            <button type="button" className="btn btn-ghost btn-sm danger-text push-right" onClick={handleForget}>
              Forget cookies
            </button>
          </div>
        )}

        <div className="field">
          <label htmlFor="cookies-file">{active ? 'Replace with a new cookies.txt' : 'cookies.txt file'}</label>
          <input
            id="cookies-file"
            type="file"
            accept=".txt,text/plain"
            className="file-input"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {fileName && <span className="hint mono">{fileName} loaded</span>}
        </div>

        <div className="field">
          <label htmlFor="cookies-text">…or paste its content</label>
          <textarea
            id="cookies-text"
            className="textarea mono cookies-textarea"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
              setSaved(false);
            }}
            placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t…'}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? 'true' : undefined}
          />
          {error && <span className="error" role="alert">{error}</span>}
          {saved && <span className="hint success-text" role="status">✓ Cookies saved for this session.</span>}
        </div>

        <div className="row">
          <button type="button" className="btn push-right" onClick={handleSave} disabled={!text.trim() || saving} aria-busy={saving}>
            {saving ? (
              <>
                <span className="spinner" aria-hidden="true" /> Saving…
              </>
            ) : (
              'Save cookies'
            )}
          </button>
        </div>
      </div>
    </details>
  );
});

export default CookiesPanel;
