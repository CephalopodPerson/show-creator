import React, { useState, useEffect } from 'react';
import { onCodeRequest } from '../lib/showCodes';

let nextId = 0;

// Requests for different shows can arrive together (e.g. a copy into another
// locked show while an edit is pending) — queue them and ask one at a time.
export default function CodePromptHost() {
  const [queue, setQueue] = useState([]);   // [{ id, show, reason, retryAfter, resolve }]
  const [value, setValue] = useState('');

  useEffect(() => onCodeRequest(({ show, reason, retryAfter }) => new Promise(resolve => {
    setQueue(q => [...q, { id: ++nextId, show, reason, retryAfter, resolve }]);
  })), []);

  const req = queue[0];
  if (!req) return null;

  function finish(code) {
    req.resolve(code);
    setValue('');
    setQueue(q => q.slice(1));
  }

  return (
    <div className="modal-overlay" onClick={() => finish(null)}>
      <div key={req.id} className="modal-box code-prompt" onClick={e => e.stopPropagation()}>
        <h3 className="code-prompt-title">🔒 “{req.show}” is locked</h3>
        <p className="code-prompt-text">Enter its code to make changes.</p>
        <form onSubmit={e => { e.preventDefault(); if (value.trim()) finish(value.trim()); }}>
          <input
            className="input"
            autoFocus
            autoComplete="off"
            placeholder="e.g. K7M-4QX"
            value={value}
            onChange={e => setValue(e.target.value)}
          />
          {req.reason === 'code_wrong' && <p className="admin-error">That code didn't match.</p>}
          {req.reason === 'locked' && (
            <p className="admin-error">Too many wrong codes — wait {req.retryAfter} seconds, then try again.</p>
          )}
          <div className="code-prompt-actions">
            <button type="button" className="btn-secondary" onClick={() => finish(null)}>Cancel</button>
            <button className="btn-primary" disabled={!value.trim()}>Unlock</button>
          </div>
        </form>
      </div>
    </div>
  );
}
