import React, { useState, useEffect } from 'react';

export default function ShowList({ onOpen }) {
  const [shows,      setShows]      = useState([]);
  const [newName,    setNewName]    = useState('');
  const [confirmDel, setConfirmDel] = useState(null); // show name awaiting confirm

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

  async function deleteShow(name) {
    setConfirmDel(null);
    await fetch(`/api/shows/${encodeURIComponent(name)}`, { method: 'DELETE' });
    setShows(prev => prev.filter(s => s.name !== name));
  }

  return (
    <div className="show-list">
      <h2>Shows</h2>

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
            <button className="show-card" onClick={() => { setConfirmDel(null); onOpen(s.name); }}>
              <span className="show-card-name">{s.name}</span>
              <span className="show-card-meta">{s.sequences} sequence{s.sequences !== 1 ? 's' : ''}</span>
            </button>
            <button
              className="show-card-delete"
              title="Delete show"
              onClick={e => { e.stopPropagation(); setConfirmDel(s.name); }}
            >✕</button>

            {confirmDel === s.name && (
              <div className="show-card-confirm">
                <span>Delete "{s.name}"?</span>
                <button className="seq-confirm-yes" onClick={() => deleteShow(s.name)}>Delete</button>
                <button className="seq-confirm-no"  onClick={() => setConfirmDel(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
        {shows.length === 0 && (
          <p className="muted">No shows yet — create one above.</p>
        )}
      </div>
    </div>
  );
}
