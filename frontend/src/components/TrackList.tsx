import { useState } from 'react';
import { API_BASE, triggerDownload, type TrackFile } from '../api';

interface Props {
  files: TrackFile[];
  jobId: string;
  onReset: () => void;
}

function displayName(filename: string) {
  return filename.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+\s*-\s*/, '');
}

function TrackList({ files, jobId, onReset }: Props) {
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadedCount, setDownloadedCount] = useState(0);

  const download = (index: number) => {
    triggerDownload(`${API_BASE}/jobs/${jobId}/files/${index}`, files[index].filename);
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    setDownloadedCount(0);
    for (let i = 0; i < files.length; i++) {
      download(i);
      setDownloadedCount(i + 1);
      await new Promise(r => setTimeout(r, 800));
    }
    setDownloadingAll(false);
  };

  return (
    <section className="card stack track-list">
      <div className="row">
        <h2 className="track-list-title">
          Tracks <span className="badge mono">{files.length}</span>
        </h2>
        <button className="btn btn-primary btn-sm push-right" onClick={handleDownloadAll} disabled={downloadingAll}>
          {downloadingAll ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="mono num">{downloadedCount}/{files.length}</span>
            </>
          ) : (
            'Download all'
          )}
        </button>
      </div>
      <ul className="track-items">
        {files.map((file, index) => (
          <li key={file.filename} className="track-item">
            <span className="mono num track-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="track-name" title={file.filename}>{displayName(file.filename)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => download(index)} disabled={downloadingAll}>
              Download
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-ghost" onClick={onReset}>Convert another</button>
    </section>
  );
}

export default TrackList;
