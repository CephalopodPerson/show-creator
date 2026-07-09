import React, { useState, useEffect } from 'react';
import StorageManager from './StorageManager';

export default function ShowList({ onOpen, onAdmin }) {
  const [shows,       setShows]       = useState([]);
  const [newName,     setNewName]     = useState('');
  const [confirmArch, setConfirmArch] = useState(null);
  const [showStorage, setShowStorage] = useState(false);

  useEffect(() => {
    fetch('/api/shows').then(r => r.json()).then(setShows);
  }, []);

  async function createShow() {
    const name = newName.trim();
    if (!name) return;
    await fetch(`/api/shows/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setNewName('');
    onOpen(name);
  }

  async function archiveShow(name) {
    setConfirmArch(null);
    await fetch(`/api/shows/${encodeURIComponent(name)}/archive`, { method: 'POST' });
    setShows(prev => prev.filter(s => s.name !== name));
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
        <button className="btn-primary" onClick={createShow}>Create</button>
      </div>

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
