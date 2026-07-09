import React, { useState, useEffect } from 'react';

const TOKEN_KEY = 'adminToken';

function adminHeaders() {
  return { 'Content-Type': 'application/json', 'x-admin-token': localStorage.getItem(TOKEN_KEY) ?? '' };
}

// ── Login screen ──────────────────────────────────────────────────────────────
function LoginForm({ onLogin }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) { setErr('Wrong PIN'); return; }
    const { token } = await res.json();
    localStorage.setItem(TOKEN_KEY, token);
    onLogin(token);
  }

  return (
    <div className="admin-login">
      <div className="admin-login-box">
        <h2 className="admin-login-title">⚙ Admin</h2>
        <form onSubmit={submit}>
          <input
            className="input admin-pin-input"
            type="password"
            placeholder="PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            autoFocus
          />
          {err && <p className="admin-error">{err}</p>}
          <button className="btn-primary" style={{ width: '100%', marginTop: 12 }}>Enter</button>
        </form>
      </div>
    </div>
  );
}

// ── Main admin panel ──────────────────────────────────────────────────────────
export default function AdminPanel({ onBack }) {
  const [token,    setToken]    = useState(localStorage.getItem(TOKEN_KEY));
  const [tab,      setTab]      = useState('settings'); // 'settings' | 'archive'
  const [settings, setSettings] = useState(null);
  const [archive,  setArchive]  = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState('');
  const [copyName, setCopyName] = useState({});  // showName → newName

  useEffect(() => {
    if (!token) return;
    fetch('/api/settings').then(r => r.json()).then(setSettings);
    fetch('/api/archive', { headers: adminHeaders() }).then(r => r.json()).then(setArchive).catch(() => {});
  }, [token]);

  async function saveSettings() {
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setMsg(res.ok ? '✓ Saved' : '✗ Failed');
    setTimeout(() => setMsg(''), 2500);
  }

  async function restoreShow(name) {
    const res = await fetch(`/api/archive/${encodeURIComponent(name)}/restore`, {
      method: 'POST', headers: adminHeaders(),
    });
    if (res.ok) setArchive(prev => prev.filter(s => s.name !== name));
    else { const e = await res.json(); alert(e.error); }
  }

  async function deleteShow(name) {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/archive/${encodeURIComponent(name)}`, { method: 'DELETE', headers: adminHeaders() });
    setArchive(prev => prev.filter(s => s.name !== name));
  }

  async function copyShow(name) {
    const newName = copyName[name]?.trim() || name + ' (copy)';
    const res = await fetch(`/api/archive/${encodeURIComponent(name)}/copy`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) { setMsg(`✓ Copied as "${newName}"`); setTimeout(() => setMsg(''), 2500); }
    else { const e = await res.json(); alert(e.error); }
  }

  if (!token) return <LoginForm onLogin={setToken} />;

  return (
    <div className="admin-wrap">
      <div className="admin-header">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2 className="admin-title">⚙ Admin</h2>
        <div className="admin-tabs">
          <button className={`admin-tab${tab === 'settings' ? ' admin-tab-active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
          <button className={`admin-tab${tab === 'archive'  ? ' admin-tab-active' : ''}`} onClick={() => setTab('archive')}>Archive ({archive.length})</button>
        </div>
        {msg && <span className="admin-msg">{msg}</span>}
      </div>

      {tab === 'settings' && settings && (
        <div className="admin-section">
          <h3 className="admin-section-title">Global defaults</h3>

          <label className="admin-field">
            <span className="admin-field-label">Default brightness</span>
            <span className="admin-field-hint">Applied to new steps when no vibe is set</span>
            <div className="admin-slider-row">
              <input
                type="range" min={5} max={100} value={settings.defaultBrightness}
                onChange={e => setSettings(s => ({ ...s, defaultBrightness: +e.target.value }))}
                className="preset-bright-slider"
              />
              <span className="preset-bright-val">{settings.defaultBrightness}%</span>
            </div>
          </label>

          <label className="admin-field">
            <span className="admin-field-label">Maximum brightness cap</span>
            <span className="admin-field-hint">Basic mode brightness slider won't exceed this</span>
            <div className="admin-slider-row">
              <input
                type="range" min={10} max={100} value={settings.maxBrightness}
                onChange={e => setSettings(s => ({ ...s, maxBrightness: +e.target.value }))}
                className="preset-bright-slider"
              />
              <span className="preset-bright-val">{settings.maxBrightness}%</span>
            </div>
          </label>

          <button className="btn-primary" onClick={saveSettings} disabled={saving} style={{ marginTop: 20 }}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>

          <div className="admin-pin-note">
            To change the admin PIN, set the <code>ADMIN_PIN</code> environment variable on the server and restart.
          </div>
        </div>
      )}

      {tab === 'archive' && (
        <div className="admin-section">
          <h3 className="admin-section-title">Archived shows</h3>
          {archive.length === 0 && <p className="muted">No archived shows.</p>}
          {archive.map(s => (
            <div key={s.name} className="archive-row">
              <div className="archive-info">
                <span className="archive-name">{s.name}</span>
                <span className="archive-meta">{s.sequences} sequence{s.sequences !== 1 ? 's' : ''}</span>
              </div>
              <div className="archive-copy-row">
                <input
                  className="input archive-copy-input"
                  placeholder={s.name + ' (copy)'}
                  value={copyName[s.name] ?? ''}
                  onChange={e => setCopyName(p => ({ ...p, [s.name]: e.target.value }))}
                />
                <button className="btn-secondary" onClick={() => copyShow(s.name)}>Copy to active</button>
              </div>
              <div className="archive-actions">
                <button className="btn-secondary" onClick={() => restoreShow(s.name)}>↩ Restore</button>
                <button className="btn-danger"    onClick={() => deleteShow(s.name)}>🗑 Delete forever</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
