import React, { useState, useEffect, useCallback, useRef } from 'react';
import SequenceEditor from './SequenceEditor';

const API = name => `/api/shows/${encodeURIComponent(name)}`;

export default function ShowEditor({ showName, mode = 'advanced' }) {
  const [show,        setShow]        = useState(null);
  const [sequences,   setSequences]   = useState([]);
  const [active,      setActive]      = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [qxwFile,     setQxwFile]     = useState(null);

  // Inline delete confirmation
  const [confirmId,   setConfirmId]   = useState(null);

  // Inline rename
  const [renamingId,  setRenamingId]  = useState(null);
  const [renameVal,   setRenameVal]   = useState('');
  const renameRef = useRef(null);

  // Upload progress
  const [uploading,   setUploading]   = useState(false);
  const audioPickerRef = useRef(null);

  // Copy-to picker: id of sequence being copied, list of target shows
  const [copyingId,   setCopyingId]   = useState(null);
  const [allShows,    setAllShows]    = useState([]);

  // Toast message
  const [toast,       setToast]       = useState(null);
  const toastTimer = useRef(null);

  function showToast(msg, type = 'error') {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // Load show on mount
  useEffect(() => {
    fetch(API(showName))
      .then(r => r.json())
      .then(data => {
        setShow(data);
        setSequences(data.sequences ?? []);
        if ((data.sequences ?? []).length > 0) setActive(data.sequences[0].id);
      })
      .catch(() => showToast('Failed to load show data'));
  }, [showName]);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  // Auto-save a single sequence
  const saveSequence = useCallback(async (seq) => {
    setSaving(true);
    try {
      await fetch(`${API(showName)}/sequences/${seq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seq),
      });
      setSequences(prev => prev.map(s => s.id === seq.id ? seq : s));
    } catch {
      showToast('Auto-save failed');
    }
    setSaving(false);
  }, [showName]);

  // ── Add sequences from audio files ───────────────────────────────────────
  function cleanFileName(filename) {
    // Remove extension, strip leading track numbers like "01. " or "01 - "
    return filename
      .replace(/\.[^/.]+$/, '')
      .replace(/^\d+[\s._-]+/, '')
      .trim();
  }

  async function handleAudioFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    setConfirmId(null); setCopyingId(null);
    let firstNewId = null;

    for (const file of Array.from(files)) {
      try {
        // 1. Create the sequence with the cleaned filename
        const name = cleanFileName(file.name);
        const seqRes = await fetch(`${API(showName)}/sequences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, steps: [] }),
        });
        const seq = await seqRes.json();
        if (!firstNewId) firstNewId = seq.id;

        // 2. Upload the audio file
        const fd = new FormData();
        fd.append('audio', file);
        const audioRes  = await fetch(`${API(showName)}/audio`, { method: 'POST', body: fd });
        const audioData = await audioRes.json();

        // 3. Attach the audio path to the sequence
        const updated = await fetch(`${API(showName)}/sequences/${seq.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...seq, audioPath: audioData.path }),
        }).then(r => r.json());

        setSequences(prev => [...prev, updated]);
        if (audioData.warnings?.length) showToast(audioData.warnings[0], 'warn');
      } catch {
        showToast(`Failed to add ${file.name}`);
      }
    }

    if (firstNewId) setActive(firstNewId);
    setUploading(false);
    // Reset the file input so the same files can be re-selected if needed
    if (audioPickerRef.current) audioPickerRef.current.value = '';
  }

  // ── Inline rename ─────────────────────────────────────────────────────────
  function startRename(seq, e) {
    e.stopPropagation();
    setRenamingId(seq.id);
    setRenameVal(seq.name);
  }

  async function commitRename(seq) {
    const name = renameVal.trim();
    setRenamingId(null);
    if (!name || name === seq.name) return;
    try {
      const updated = await fetch(`${API(showName)}/sequences/${seq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...seq, name }),
      }).then(r => r.json());
      setSequences(prev => prev.map(s => s.id === seq.id ? updated : s));
    } catch {
      showToast('Rename failed');
    }
  }

  // ── Delete sequence ───────────────────────────────────────────────────────
  function requestDelete(id) { setConfirmId(id); setAddingSeq(false); setCopyingId(null); }

  async function confirmDelete() {
    const id = confirmId;
    setConfirmId(null);
    try {
      await fetch(`${API(showName)}/sequences/${id}`, { method: 'DELETE' });
      setSequences(prev => prev.filter(s => s.id !== id));
      if (active === id) setActive(sequences.find(s => s.id !== id)?.id ?? null);
    } catch {
      showToast('Failed to delete sequence');
    }
  }

  // ── Reorder sequences ─────────────────────────────────────────────────────
  async function moveSequence(id, dir) {
    const idx     = sequences.findIndex(s => s.id === id);
    const newIdx  = idx + dir;
    if (newIdx < 0 || newIdx >= sequences.length) return;
    const reordered = [...sequences];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setSequences(reordered);
    try {
      await fetch(`${API(showName)}/sequences/order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: reordered.map(s => s.id) }),
      });
    } catch {
      showToast('Failed to save order');
    }
  }

  // ── Copy sequence to another show ─────────────────────────────────────────
  async function startCopy(id) {
    setCopyingId(id); setConfirmId(null); setAddingSeq(false);
    try {
      const data = await fetch('/api/shows').then(r => r.json());
      setAllShows(data.map(s => s.name).filter(n => n !== showName));
    } catch {
      showToast('Could not load shows list');
      setCopyingId(null);
    }
  }

  async function doCopy(targetShow) {
    const id = copyingId;
    setCopyingId(null);
    try {
      await fetch(`${API(showName)}/sequences/${id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetShow }),
      });
      const seq = sequences.find(s => s.id === id);
      showToast(`"${seq?.name}" copied to ${targetShow}`, 'ok');
    } catch {
      showToast('Copy failed');
    }
  }

  // ── QLC+ file upload ──────────────────────────────────────────────────────
  async function uploadQxw(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('qxw', file);
    try {
      const res  = await fetch(`${API(showName)}/qxw`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.fixtures) {
        setShow(prev => ({ ...prev, fixtures: data.fixtures }));
        setQxwFile(file.name);
      }
    } catch {
      showToast('Failed to upload .qxw file');
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function exportQxw() {
    if (!show?.qxwPath) { showToast('Upload a .qxw file first', 'warn'); return; }
    setExporting(true);
    try {
      const res = await fetch(`${API(showName)}/export`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('Export failed: ' + (err.error ?? 'unknown error'));
        setExporting(false); return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${showName}.qxw`; a.click();
      URL.revokeObjectURL(url);
      showToast('Exported!', 'ok');
    } catch (e) {
      showToast('Export failed: ' + e.message);
    }
    setExporting(false);
  }

  const activeSeq = sequences.find(s => s.id === active);

  return (
    <div className="show-editor">

      {/* ── Left panel: sequence list ──────────────────────────────────────── */}
      <aside className="seq-list">
        <div className="seq-list-header">
          <span className="panel-title">Sequences</span>
          <label className="btn-icon" title="Add sequences from audio files">
            {uploading ? '…' : '＋'}
            <input
              ref={audioPickerRef}
              type="file"
              accept="audio/*"
              multiple
              hidden
              onChange={e => handleAudioFiles(e.target.files)}
            />
          </label>
        </div>

        {/* Sequence list */}
        {sequences.map((seq, idx) => (
          <div key={seq.id}>
            <div
              className={`seq-item ${seq.id === active ? 'active' : ''}`}
              onClick={() => { setActive(seq.id); setConfirmId(null); setCopyingId(null); }}
            >
              {renamingId === seq.id ? (
                <input
                  ref={renameRef}
                  className="seq-rename-input"
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(seq); if (e.key === 'Escape') setRenamingId(null); }}
                  onBlur={() => commitRename(seq)}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="seq-item-name" onDoubleClick={e => startRename(seq, e)} title="Double-click to rename">{seq.name}</span>
              )}
              <span className="seq-item-steps">{seq.steps?.length ?? 0}</span>

              {/* Reorder */}
              <button className="seq-action-btn" title="Move up"
                disabled={idx === 0}
                onClick={e => { e.stopPropagation(); moveSequence(seq.id, -1); }}>▲</button>
              <button className="seq-action-btn" title="Move down"
                disabled={idx === sequences.length - 1}
                onClick={e => { e.stopPropagation(); moveSequence(seq.id, 1); }}>▼</button>

              {/* Copy */}
              <button className="seq-action-btn" title="Copy to show…"
                onClick={e => { e.stopPropagation(); startCopy(seq.id); }}>⎘</button>

              {/* Delete */}
              <button className="btn-delete" title="Delete"
                onClick={e => { e.stopPropagation(); requestDelete(seq.id); }}>✕</button>
            </div>

            {/* Inline delete confirmation */}
            {confirmId === seq.id && (
              <div className="seq-confirm-row">
                <span className="seq-confirm-msg">Delete "{seq.name}"?</span>
                <button className="seq-confirm-yes" onClick={confirmDelete}>Delete</button>
                <button className="seq-confirm-no"  onClick={() => setConfirmId(null)}>Cancel</button>
              </div>
            )}

            {/* Inline copy-to picker */}
            {copyingId === seq.id && (
              <div className="seq-copy-row">
                <span className="seq-copy-label">Copy to:</span>
                {allShows.length === 0
                  ? <span className="seq-copy-empty">No other shows</span>
                  : allShows.map(name => (
                      <button key={name} className="seq-copy-target" onClick={() => doCopy(name)}>
                        {name}
                      </button>
                    ))
                }
                <button className="seq-add-cancel" onClick={() => setCopyingId(null)}>✕</button>
              </div>
            )}
          </div>
        ))}

        {sequences.length === 0 && !uploading && (
          <label className="seq-upload-prompt">
            <span>＋ Add audio files</span>
            <span className="seq-upload-sub">Click to upload MP3 / WAV<br/>Multiple files create multiple sequences</span>
            <input type="file" accept="audio/*" multiple hidden onChange={e => handleAudioFiles(e.target.files)} />
          </label>
        )}
        {uploading && (
          <p className="muted" style={{ padding: '12px' }}>Uploading…</p>
        )}

        {/* QLC+ panel */}
        <div className="qxw-panel">
          <label className="btn-secondary file-btn">
            {qxwFile ?? (show?.qxwPath ? '✓ .qxw loaded' : 'Load .qxw')}
            <input type="file" accept=".qxw" hidden onChange={uploadQxw} />
          </label>

          {show?.fixtures && (
            <div className="fixture-badges">
              {show.fixtures.map(f => (
                <span key={f.id} className="fixture-badge"
                  title={`ID:${f.id}  DMX:${f.address + 1}  ${f.channels}ch`}>
                  {f.name}
                </span>
              ))}
            </div>
          )}

          <button
            className="btn-export"
            onClick={exportQxw}
            disabled={exporting || !show?.qxwPath}
          >
            {exporting ? 'Exporting…' : 'Export .qxw'}
          </button>
        </div>

        {saving && <div className="save-indicator">Saving…</div>}

        {toast && (
          <div className={`seq-toast seq-toast-${toast.type}`} onClick={() => setToast(null)}>
            {toast.msg}
          </div>
        )}
      </aside>

      {/* ── Right panel: active sequence editor ───────────────────────────── */}
      <div className="seq-editor-area">
        {activeSeq
          ? <SequenceEditor
              key={activeSeq.id}
              sequence={activeSeq}
              showName={showName}
              fixtures={show?.fixtures ?? []}
              onSave={saveSequence}
              mode={mode}
            />
          : <div className="empty-state">
              {sequences.length === 0
                ? 'Click ＋ to add your first sequence'
                : 'Select a sequence from the left'}
            </div>
        }
      </div>
    </div>
  );
}
