import React, { useState, useEffect } from 'react';
import ShowList   from './components/ShowList';
import ShowEditor from './components/ShowEditor';
import AdminPanel from './components/AdminPanel';
import './styles.css';
import { api } from './api';

export default function App() {
  const [view, setView]         = useState('list');     // 'list' | 'editor' | 'admin'
  const [showName, setShowName] = useState(null);
  const [editView, setEditView] = useState('grid');     // 'grid' | 'timeline'
  const [channel, setChannel]   = useState(null);       // { channel, otherUrl }

  useEffect(() => {
    api('/api/channel').then(r => r.json()).then(setChannel).catch(() => {});
  }, []);

  function openShow(name) { setShowName(name); setView('editor'); }
  function backToList()   { setShowName(null); setView('list'); }

  const isBeta = channel?.channel === 'beta';

  return (
    <div className={`app${isBeta ? ' app-beta' : ''}`}>
      {isBeta && (
        <div className="beta-bar">
          <span className="beta-tag">BETA</span>
          <span className="beta-text">
            You're on the beta channel — new features, separate show data. Changes here don't affect live shows.
          </span>
          {channel?.otherUrl && (
            <a className="beta-switch" href={channel.otherUrl}>Switch to stable →</a>
          )}
        </div>
      )}

      <header className="app-header">
        <div className="header-left">
          {(view === 'editor' || view === 'admin') && (
            <button className="btn-ghost" onClick={backToList}>← Shows</button>
          )}
          <h1 className="logo">Show Creator</h1>
          {showName && view === 'editor' && (
            <span className="show-name-badge">{showName}</span>
          )}
        </div>

        <div className="header-right">
          {view === 'editor' && (
            <div className="view-toggle">
              <button
                className={`view-btn${editView === 'grid' ? ' view-btn-active' : ''}`}
                onClick={() => setEditView('grid')}
                title="Grid — colour and effect blocks per section"
              >▦ Grid</button>
              <button
                className={`view-btn${editView === 'timeline' ? ' view-btn-active' : ''}`}
                onClick={() => setEditView('timeline')}
                title="Timeline — waveform and fine control"
              >⎯ Timeline</button>
            </div>
          )}
          {channel && !isBeta && channel.otherUrl && (
            <a className="try-beta" href={channel.otherUrl} title="Try the beta channel — separate data, no risk to live shows">
              Try beta →
            </a>
          )}
        </div>
      </header>

      <main className="app-body">
        {view === 'list'   && <ShowList   onOpen={openShow} onAdmin={() => setView('admin')} />}
        {view === 'editor' && <ShowEditor showName={showName} view={editView} />}
        {view === 'admin'  && <AdminPanel onBack={backToList} />}
      </main>
    </div>
  );
}
