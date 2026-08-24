import React, { useState, useEffect } from 'react';
import ShowList   from './components/ShowList';
import ShowEditor from './components/ShowEditor';
import AdminPanel from './components/AdminPanel';
import { api } from './api';
import './styles.css';

// Theme is applied to <html> so CSS variables cascade everywhere, including
// portals and fixed-position panels.
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);
  return [theme, () => setTheme(t => t === 'light' ? 'dark' : 'light')];
}

export default function App() {
  const [view, setView]         = useState('shows');   // 'shows' | 'show' | 'admin'
  const [showName, setShowName] = useState(null);
  const [channel, setChannel]   = useState(null);
  const [theme, toggleTheme]    = useTheme();

  useEffect(() => { api('/api/channel').then(r => r.json()).then(setChannel).catch(() => {}); }, []);

  const isBeta = channel?.channel === 'beta';

  return (
    <div className="app">
      {isBeta && (
        <div className="beta-bar">
          <span className="beta-tag">BETA</span>
          <span className="beta-text">
            You're on the beta channel — new features, separate show data. Nothing here affects live shows.
          </span>
          {channel?.otherUrl && <a className="beta-switch" href={channel.otherUrl}>Switch to stable →</a>}
        </div>
      )}

      <header className="app-header">
        <div className="header-left">
          <span className="logo-mark">◐</span>
          <h1 className="logo">Show Creator</h1>
          {view === 'show' && showName && (
            <>
              <span className="crumb">/</span>
              <button className="btn-ghost" onClick={() => { setShowName(null); setView('shows'); }}>
                Shows
              </button>
              <span className="crumb">/</span>
              <span className="show-name-badge">{showName}</span>
            </>
          )}
          {view === 'admin' && (
            <>
              <span className="crumb">/</span>
              <button className="btn-ghost" onClick={() => setView('shows')}>Shows</button>
            </>
          )}
        </div>

        <div className="header-right">
          {!isBeta && channel?.otherUrl && (
            <a className="try-beta" href={channel.otherUrl} title="Try the beta channel — separate data, no risk to live shows">
              Try beta →
            </a>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
      </header>

      <main className="app-body">
        {view === 'shows' && (
          <ShowList
            onOpen={name => { setShowName(name); setView('show'); }}
            onAdmin={() => setView('admin')}
          />
        )}
        {view === 'show'  && <ShowEditor showName={showName} onExit={() => { setShowName(null); setView('shows'); }} />}
        {view === 'admin' && <AdminPanel onBack={() => setView('shows')} />}
      </main>
    </div>
  );
}
