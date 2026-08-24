import React, { useState, useEffect, useCallback, useRef } from 'react';
import SequenceEditor from './SequenceEditor';
import { api } from '../api';

const API = name => `/api/shows/${encodeURIComponent(name)}`;

// Strip extension and leading track numbers: "03 - Song.mp3" → "Song"
function cleanFileName(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/^\d+[\s._-]+/, '').trim();
}

function fmtDur(s) {
  if (!s) return null;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function ShowEditor({ showName, onExit }) {
  const [show,      setShow]      = useState(null);
  const [songs,     setSongs]     = useState([]);
  const [openId,    setOpenId]    = useState(null);   // null = picker, else editing
  const [saving,    setSaving]    = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [settings,  setSettings]  = useState({});
  const [confirmId, setConfirmId] = useState(null);
  const [renameId,  setRenameId]  = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [toast,     setToast]     = useState(null);
  const [copyFor,   setCopyFor]   = useState(null);
  const [allShows,  setAllShows]  = useState([]);

  const toastTimer = useRef(null);
  const pickerRef  = useRef(null);
  const renameRef  = useRef(null);

  function showToast(msg, type = 'error') {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => { api('/api/settings').then(r => r.json()).then(setSettings).catch(() => {}); }, []);

  useEffect(() => {
    api(API(showName)).then(r => r.json())
      .then(d => { setShow(d); setSongs(d.sequences ?? []); })
      .catch(() => showToast('Could not load this show'));
  }, [showName]);

  useEffect(() => { if (renameId) renameRef.current?.focus(); }, [renameId]);

  const saveSong = useCallback(async (seq) => {
    setSaving(true);
    try {
      await api(`${API(showName)}/sequences/${seq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seq),
      });
      setSongs(prev => prev.map(s => s.id === seq.id ? seq : s));
    } catch { showToast('Auto-save failed'); }
    setSaving(false);
  }, [showName]);

  // ── Add songs from audio files ──
  async function handleAudioFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    let firstId = null;

    for (const file of Array.from(files)) {
      try {
        const seq = await api(`${API(showName)}/sequences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cleanFileName(file.name), steps: [] }),
        }).then(r => r.json());
        if (!firstId) firstId = seq.id;

        const fd = new FormData();
        fd.append('audio', file);
        const audio = await api(`${API(showName)}/audio`, { method: 'POST', body: fd }).then(r => r.json());

        const updated = await api(`${API(showName)}/sequences/${seq.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...seq, audioPath: audio.path }),
        }).then(r => r.json());

        setSongs(prev => [...prev, updated]);
        if (audio.warnings?.length) showToast(audio.warnings[0], 'warn');
      } catch {
        showToast(`Could not add ${file.name}`);
      }
    }
    setUploading(false);
    if (pickerRef.current) pickerRef.current.value = '';
  }

  async function commitRename(song) {
    const name = renameVal.trim();
    setRenameId(null);
    if (!name || name === song.name) return;
    try {
      const updated = await api(`${API(showName)}/sequences/${song.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...song, name }),
      }).then(r => r.json());
      setSongs(prev => prev.map(s => s.id === song.id ? updated : s));
    } catch { showToast('Rename failed'); }
  }

  async function deleteSong(id) {
    setConfirmId(null);
    try {
      await api(`${API(showName)}/sequences/${id}`, { method: 'DELETE' });
      setSongs(prev => prev.filter(s => s.id !== id));
    } catch { showToast('Could not delete'); }
  }

  async function startCopy(id) {
    setCopyFor(id);
    try {
      const data = await api('/api/shows').then(r => r.json());
      setAllShows(data.map(s => s.name).filter(n => n !== showName));
    } catch { showToast('Could not load shows'); setCopyFor(null); }
  }

  async function doCopy(target) {
    const id = copyFor;
    setCopyFor(null);
    try {
      await api(`${API(showName)}/sequences/${id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetShow: target }),
      });
      showToast(`Copied to ${target}`, 'ok');
    } catch { showToast('Copy failed'); }
  }

  async function uploadQxw(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('qxw', file);
    try {
      const data = await api(`${API(showName)}/qxw`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.fixtures) { setShow(p => ({ ...p, fixtures: data.fixtures, qxwPath: 'set' })); showToast('Fixture file loaded', 'ok'); }
      else showToast(data.error ?? 'Could not read .qxw');
    } catch { showToast('Upload failed'); }
  }

  async function exportQxw() {
    if (!show?.qxwPath) { showToast('This show has no QLC+ file yet', 'warn'); return; }
    setExporting(true);
    try {
      const res = await api(`${API(showName)}/export`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('Export failed: ' + (err.error ?? 'unknown'));
      } else {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${showName}.qxw`; a.click();
        URL.revokeObjectURL(url);
        showToast('Exported', 'ok');
      }
    } catch (e) { showToast('Export failed: ' + e.message); }
    setExporting(false);
  }

  const openSong = songs.find(s => s.id === openId);

  // ── Editing one song: full screen ──
  if (openSong) {
    return (
      <>
        <SequenceEditor
          key={openSong.id}
          sequence={openSong}
          showName={showName}
          fixtures={show?.fixtures ?? []}
          onSave={saveSong}
          settings={settings}
          onBack={() => setOpenId(null)}
        />
        {saving && <div className="save-indicator">Saving…</div>}
        {toast && <div className={`seq-toast seq-toast-${toast.type}`} onClick={() => setToast(null)}>{toast.msg}</div>}
      </>
    );
  }

  // ── Song picker ──
  return (
    <div className="song-picker">
      <div className="song-picker-head">
        <div>
          <h2>Songs</h2>
          <p className="song-picker-sub">
            {songs.length === 0 ? 'Add audio files to get started' :
             `${songs.length} song${songs.length !== 1 ? 's' : ''} in ${showName}`}
          </p>
        </div>
        <div className="song-picker-actions">
          <label className="btn-secondary file-btn">
            {show?.qxwPath ? '✓ QLC+ file' : 'Load .qxw'}
            <input type="file" accept=".qxw" hidden onChange={uploadQxw} />
          </label>
          <label className="btn-secondary file-btn">
            {uploading ? 'Uploading…' : '＋ Add songs'}
            <input ref={pickerRef} type="file" accept="audio/*" multiple hidden onChange={e => handleAudioFiles(e.target.files)} />
          </label>
          <button className="btn-primary" onClick={exportQxw} disabled={exporting || !show?.qxwPath}>
            {exporting ? 'Exporting…' : '↓ Export .qxw'}
          </button>
        </div>
      </div>

      {show?.fixtures?.length > 0 && (
        <div className="fixture-badges" style={{ marginBottom: 18 }}>
          {show.fixtures.map(f => (
            <span key={f.id} className="fixture-badge" title={`ID:${f.id}  DMX:${f.address + 1}  ${f.channels}ch`}>{f.name}</span>
          ))}
        </div>
      )}

      <div className="song-grid">
        {songs.map(song => (
          <div key={song.id} className="song-card" onClick={() => renameId !== song.id && setOpenId(song.id)}>
            <div className="song-thumb">♫</div>

            <div className="song-info">
              {renameId === song.id ? (
                <input
                  ref={renameRef}
                  className="song-rename-input"
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onBlur={() => commitRename(song)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  commitRename(song);
                    if (e.key === 'Escape') setRenameId(null);
                  }}
                />
              ) : (
                <div className="song-name" title={song.name}>{song.name}</div>
              )}
              <div className="song-meta">
                <span>{song.steps?.length ?? 0} block{(song.steps?.length ?? 0) !== 1 ? 's' : ''}</span>
                {song.audioDuration ? <span>· {fmtDur(song.audioDuration)}</span> : null}
                {song.audioPath
                  ? <span className="song-badge song-badge-ok">audio</span>
                  : <span className="song-badge song-badge-warn">no audio</span>}
              </div>
            </div>

            <div className="song-actions" onClick={e => e.stopPropagation()}>
              <button className="song-act" title="Rename" onClick={() => { setRenameId(song.id); setRenameVal(song.name); }}>✎</button>
              <button className="song-act" title="Copy to another show" onClick={() => startCopy(song.id)}>⧉</button>
              <button className="song-act" title="Delete" onClick={() => setConfirmId(song.id)}>✕</button>
            </div>

            {confirmId === song.id && (
              <div className="show-card-confirm" onClick={e => e.stopPropagation()}>
                <span>Delete “{song.name}”?</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="seq-confirm-yes" onClick={() => deleteSong(song.id)}>Delete</button>
                  <button className="seq-confirm-no"  onClick={() => setConfirmId(null)}>Cancel</button>
                </div>
              </div>
            )}

            {copyFor === song.id && (
              <div className="show-card-confirm" onClick={e => e.stopPropagation()}>
                <span>Copy to which show?</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {allShows.length === 0
                    ? <span className="muted">No other shows</span>
                    : allShows.map(n => (
                        <button key={n} className="seq-confirm-no" onClick={() => doCopy(n)}>{n}</button>
                      ))}
                </div>
                <button className="seq-confirm-no" onClick={() => setCopyFor(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}

        <label className="song-dropzone">
          <span style={{ fontSize: 26 }}>♫</span>
          <span className="song-dropzone-title">Add songs</span>
          <span className="song-dropzone-sub">Drop in MP3 or WAV files — each one becomes a song</span>
          <input type="file" accept="audio/*" multiple hidden onChange={e => handleAudioFiles(e.target.files)} />
        </label>
      </div>

      {toast && <div className={`seq-toast seq-toast-${toast.type}`} onClick={() => setToast(null)}>{toast.msg}</div>}
    </div>
  );
}
