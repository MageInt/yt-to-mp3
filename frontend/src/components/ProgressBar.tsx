interface ProgressBarProps {
  progress: number;
  status: 'pending' | 'downloading';
  formatLabel: string;
}

function ProgressBar({ progress, status, formatLabel }: ProgressBarProps) {
  const pct = Math.min(Math.round(progress), 100);
  // yt-dlp reports 100% once the source is downloaded; ffmpeg conversion follows.
  const converting = status === 'downloading' && pct >= 100;

  let label = 'Starting…';
  if (status === 'downloading') label = converting ? `Converting to ${formatLabel}…` : 'Downloading…';

  return (
    <div className="card status-card" role="status" aria-live="polite">
      <div className="row status-row">
        <span className="spinner accent" aria-hidden="true" />
        <span>{label}</span>
        {status === 'downloading' && !converting && <span className="mono num status-pct">{pct}&nbsp;%</span>}
      </div>
      {status === 'pending' || converting ? (
        <div className="progress indeterminate"><span /></div>
      ) : (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default ProgressBar;
