import React, { useState } from 'react';
import ShowList   from './components/ShowList';
import ShowEditor from './components/ShowEditor';
import ShowPlayer from './components/ShowPlayer';
import './styles.css';

export default function App() {
  const [view, setView]         = useState('list');     // 'list' | 'editor' | 'player'
  const [showName, setShowName] = useState(null);
  const [mode, setMode]         = useState('advanced'); // 'basic' | 'advanced'

  function openShow(name) { setShowName(name); setView('editor'); }
  function backToList()   { setShowName(null); setView('list'); }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          {(view === 'editor' || view === 'player') && (
            <button className="btn-ghost" onClick={backToList}>← Shows</button>
          )}
          <h1 className="logo">Show Creator</h1>
          {showName && view === 'editor' && (
            <span className="show-name-badge">{showName}</span>
          )}
        </div>

        <div className="header-right">
          {view === 'editor' && (
            <div className="mode-toggle">
              <button
                className={`mode-btn${mode === 'basic' ? ' mode-btn-active' : ''}`}
                onClick={() => setMode('basic')}
              >Basic</button>
              <button
                className={`mode-btn${mode === 'advanced' ? ' mode-btn-active' : ''}`}
                onClick={() => setMode('advanced')}
              >Advanced</button>
            </div>
          )}
          <button
            className={`btn-ghost header-player-btn${view === 'player' ? ' active' : ''}`}
            onClick={() => { setShowName(null); setView('player'); }}
            title="Show Player — trigger sequences and sync audio with QLC+"
          >▶ Player</button>
        </div>
      </header>

      <main className="app-body">
        {view === 'list'   && <ShowList   onOpen={openShow} />}
        {view === 'editor' && <ShowEditor showName={showName} mode={mode} />}
        {view === 'player' && <ShowPlayer />}
      </main>
    </div>
  );
}
