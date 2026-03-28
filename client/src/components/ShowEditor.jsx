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

  // Inline new-sequence form
  const [addingSeq,   setAddingSeq]   = useState(false);
  const [newSeqName,  setNewSeqName]  = useState('');
  const newSeqInputRef = useRef(null);

  // Inline delete confirmation
  const [confirmId,   setConfirmId]   = useState(null);

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

  // Auto-focus the new sequence input when it appears
  useEffect(() => {
    if (addingSeq) newSeqInputRef.current?.focus();
  }, [addingSeq]);

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

  // ── Add sequence ──────────────────────────────────────────────────────────
  function startAddSequence() {
    setNewSeqName(''); setAddingSeq(true); setConfirmId(null); setCopyingId(null);
  }

  async function commitAddSequence() {
    const name = newSeqName.trim();
    if (!name) { setAddingSeq(false); return; }
    setAddingSeq(false);
    try {
      const res = await fetch(`${API(showName)}/sequences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, steps: [] }),
      });
      const seq = await res.json();
      setSequences(prev => [...prev, seq]);
      setActive(seq.id);
    } catch {
      showToast('Failed to create sequence');
    }
  }

  function onNewSeqKey(e) {
    if (e.key === 'Enter')  commitAddSequence();
    if (e.key === 'Escape') setAddingSeq(false);
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
          <button className="btn-icon" title="Add sequence" onClick={startAddSequence}>＋</button>
        </div>

        {/* Inline new-sequence input */}
        {addingSeq && (
          <div className="seq-add-row">
            <input
              ref={newSeqInputRef}
              className="seq-add-input"
              value={newSeqName}
              onChange={e => setNewSeqName(e.target.value)}
              onKeyDown={onNewSeqKey}
              placeholder="Sequence name…"
            />
            <button className="seq-add-ok"     onClick={commitAddSequence} title="Create">✓</button>
            <button className="seq-add-cancel" onClick={() => setAddingSeq(false)} title="Cancel">✕</button>
          </div>
        )}

        {/* Sequence list */}
        {sequences.map((seq, idx) => (
          <div key={seq.id}>
            <div
              className={`seq-item ${seq.id === active ? 'active' : ''}`}
              onClick={() => { setActive(seq.id); setConfirmId(null); setCopyingId(null); }}
            >
              <span className="seq-item-name">{seq.name}</span>
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

        {sequences.length === 0 && !addingSeq && (
          <p className="muted" style={{ padding: '12px' }}>No sequences yet</p>
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
