import React, { useState, useEffect } from 'react';
import StorageManager from './StorageManager';
import { api } from '../api';
import { writeShow, setCode, CodeCancelled } from '../lib/showCodes';

export default function ShowList({ onOpen, onAdmin }) {
  const [shows,       setShows]       = useState([]);
  const [newName,     setNewName]     = useState('');
  const [confirmArch, setConfirmArch] = useState(null);
  const [showStorage, setShowStorage] = useState(false);
  const [newCode,     setNewCode]     = useState('');
  const [formErr,     setFormErr]     = useState('');
  const [listErr,     setListErr]     = useState('');

  useEffect(() => {
    api('/api/shows').then(r => r.json()).then(setShows);
  }, []);

  function suggest() {
    api('/api/codes/suggest').then(r => r.json()).then(d => setNewCode(d.code)).catch(() => {});
  }
  useEffect(suggest, []);

  async function createShow() {
    const name = newName.trim();
    if (!name) return;
    setFormErr('');
    const res = await api('/api/shows', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, editCode: newCode.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setFormErr(data.message ?? 'Could not create the show.'); return; }
    setCode(data.name, data.editCode);
    setNewName('');
    suggest();
    onOpen(data.name, data.editCode);
  }

  async function archiveShow(name) {
    setConfirmArch(null);
    setListErr('');
    try {
      const res = await writeShow(name, `/api/shows/${encodeURIComponent(name)}/archive`, { method: 'POST' });
      if (!res.ok) { setListErr(`Could not archive "${name}".`); return; }
      setShows(prev => prev.filter(s => s.name !== name));
    } catch (e) {
      setListErr(e instanceof CodeCancelled ? 'Not changed — that show is locked.' : `Could not archive "${name}".`);
    }
  }

  return (
    <div className="show-list">
      <div className="show-list-title-row">
        <h2>Shows</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary storage-btn" onClick={() => setShowStorage(true)}>💾 Storage</button>
          <button className="btn-secondary storage-btn" onClick={onAdmin}>⚙ Admin</button>
        </div>
      </div>

      <div className="new-show-row">
        <input
          className="input"
          placeholder="New show name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createShow()}
        />
        <input
          className="input new-show-code"
          placeholder="Edit code"
          title="Anyone with this code can edit or archive the show"
          value={newCode}
          onChange={e => setNewCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createShow()}
        />
        <button className="btn-ghost" type="button" onClick={suggest} title="Suggest another code">↻</button>
        <button className="btn-primary" onClick={createShow}>Create</button>
      </div>
      {formErr && <p className="form-error">{formErr}</p>}

      {listErr && <p className="form-error">{listErr}</p>}
      <div className="card-grid">
        {shows.map(s => (
          <div key={s.name} className="show-card-wrap">
            <button className="show-card" onClick={() => { setConfirmArch(null); onOpen(s.name); }}>
              <span className="show-card-name">{s.name}</span>
              <span className="show-card-meta">{s.sequences} sequence{s.sequences !== 1 ? 's' : ''}</span>
            </button>
            <button
              className="show-card-delete"
              title="Archive show"
              onClick={e => { e.stopPropagation(); setConfirmArch(s.name); }}
            >▾</button>

            {confirmArch === s.name && (
              <div className="show-card-confirm">
                <span>Archive "{s.name}"?</span>
                <button className="seq-confirm-yes" onClick={() => archiveShow(s.name)}>Archive</button>
                <button className="seq-confirm-no"  onClick={() => setConfirmArch(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
        {shows.length === 0 && (
          <p className="muted">No shows yet — create one above.</p>
        )}
      </div>

      {showStorage && <StorageManager onClose={() => setShowStorage(false)} />}
    </div>
  );
}
