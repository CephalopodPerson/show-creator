import React, { useState } from 'react';
import ShowList   from './components/ShowList';
import ShowEditor from './components/ShowEditor';
import './styles.css';

export default function App() {
  const [view, setView]         = useState('list');     // 'list' | 'editor'
  const [showName, setShowName] = useState(null);
  const [mode, setMode]         = useState('advanced'); // 'basic' | 'advanced'

  function openShow(name) { setShowName(name); setView('editor'); }
  function backToList()   { setShowName(null); setView('list'); }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          {view === 'editor' && (
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
        </div>
      </header>

      <main className="app-body">
        {view === 'list'   && <ShowList   onOpen={openShow} />}
        {view === 'editor' && <ShowEditor showName={showName} mode={mode} />}
      </main>
    </div>
  );
}
