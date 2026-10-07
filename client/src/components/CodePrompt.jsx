import React, { useState, useEffect } from 'react';
import { onCodeRequest } from '../lib/showCodes';

export default function CodePromptHost() {
  const [req, setReq]     = useState(null);   // { show, reason, resolve }
  const [value, setValue] = useState('');

  useEffect(() => onCodeRequest(({ show, reason }) => new Promise(resolve => {
    setValue('');
    setReq({ show, reason, resolve });
  })), []);

  if (!req) return null;

  function finish(code) {
    req.resolve(code);
    setReq(null);
  }

  return (
    <div className="modal-overlay" onClick={() => finish(null)}>
      <div className="modal-box code-prompt" onClick={e => e.stopPropagation()}>
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
          <div className="code-prompt-actions">
            <button type="button" className="btn-secondary" onClick={() => finish(null)}>Cancel</button>
            <button className="btn-primary" disabled={!value.trim()}>Unlock</button>
          </div>
        </form>
      </div>
    </div>
  );
}
