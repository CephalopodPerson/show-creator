import React, { useState, useEffect } from 'react';

function fmtBytes(b) {
  if (b < 1024)        return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['mp3', 'wav', 'flac', 'aiff', 'ogg'].includes(ext)) return '🎵';
  if (ext === 'qxw') return '💡';
  return '📄';
}

export default function StorageManager({ onClose }) {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [confirmDel, setConfirmDel] = useState(null); // { showName, fileName }
  const [deleting,  setDeleting]  = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await fetch('/api/storage').then(r => r.json());
      setData(d);
    } catch {
      setData(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function deleteFile(showName, fileName) {
    setDeleting(true);
    try {
      await fetch(`/api/shows/${encodeURIComponent(showName)}/uploads/${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
      });
      await load();
    } catch {
      // silently reload anyway
      await load();
    }
    setConfirmDel(null);
    setDeleting(false);
  }

  return (
    <div className="storage-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="storage-modal">
        <div className="storage-header">
          <h2 className="storage-title">Storage</h2>
          {data && <span className="storage-total">{fmtBytes(data.totalBytes)} total</span>}
          <button className="storage-close" onClick={onClose}>✕</button>
        </div>

        <div className="storage-body">
          {loading && <div className="storage-empty">Loading…</div>}

          {!loading && !data && (
            <div className="storage-empty">Could not load storage info.</div>
          )}

          {!loading && data && data.shows.length === 0 && (
            <div className="storage-empty">No files stored yet.</div>
          )}

          {!loading && data && data.shows.map(show => (
            <div key={show.name} className="storage-show">
              <div className="storage-show-header">
                <span className="storage-show-name">{show.name}</span>
                <span className="storage-show-size">{fmtBytes(show.bytes)}</span>
              </div>

              {show.files.length === 0 && (
                <div className="storage-no-files">No uploaded files</div>
              )}

              {show.files.map(file => (
                <div key={file.name} className="storage-file-row">
                  <span className="storage-file-icon">{fileIcon(file.name)}</span>
                  <span className="storage-file-name" title={file.name}>{file.name}</span>
                  <span className="storage-file-size">{fmtBytes(file.size)}</span>

                  {confirmDel?.showName === show.name && confirmDel?.fileName === file.name ? (
                    <span className="storage-confirm">
                      <button
                        className="storage-confirm-yes"
                        disabled={deleting}
                        onClick={() => deleteFile(show.name, file.name)}
                      >Delete</button>
                      <button className="storage-confirm-no" onClick={() => setConfirmDel(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      className="storage-del-btn"
                      title="Delete file"
                      onClick={() => setConfirmDel({ showName: show.name, fileName: file.name })}
                    >🗑</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
