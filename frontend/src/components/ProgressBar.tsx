interface ProgressBarProps {
  progress: number;
  status: 'pending' | 'queued' | 'downloading';
  queuePosition: number | null;
  formatLabel: string;
  onCancel?: () => void;
}

function ProgressBar({ progress, status, queuePosition, formatLabel, onCancel }: ProgressBarProps) {
  const pct = Math.min(Math.round(progress), 100);
  // yt-dlp reports 100% once the source is downloaded; ffmpeg conversion follows.
  const converting = status === 'downloading' && pct >= 100;
  const indeterminate = status !== 'downloading' || converting;

  let label = 'Starting…';
  if (status === 'queued') label = 'Waiting in queue';
  if (status === 'downloading') label = converting ? `Converting to ${formatLabel}…` : 'Downloading…';

  return (
    <div className="card status-card" role="status" aria-live="polite">
      <div className="row status-row">
        <span className={status === 'queued' ? 'queue-dot' : 'spinner accent'} aria-hidden="true" />
        <span>{label}</span>
        {status === 'queued' && queuePosition !== null && (
          <span className="badge mono num" title="Your place in the server's download queue">
            #{queuePosition}
          </span>
        )}
        {status === 'downloading' && !converting && <span className="mono num status-pct">{pct}&nbsp;%</span>}
        {onCancel && status !== 'pending' && (
          <button type="button" className={`btn btn-ghost btn-sm${status === 'downloading' && !converting ? '' : ' push-right'}`} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {indeterminate ? (
        <div className={`progress indeterminate${status === 'queued' ? ' paused' : ''}`}><span /></div>
      ) : (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {status === 'queued' && (
        <p className="hint muted queue-hint">
          The server runs a limited number of downloads at once. Yours starts automatically, keep this page open.
        </p>
      )}
    </div>
  );
}

export default ProgressBar;
