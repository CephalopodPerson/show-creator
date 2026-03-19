import React, { useState, useEffect } from 'react';
import ShowList from './components/ShowList';
import ShowEditor from './components/ShowEditor';
import './styles.css';

export default function App() {
  const [view, setView]       = useState('list');   // 'list' | 'editor'
  const [showName, setShowName] = useState(null);

  function openShow(name) { setShowName(name); setView('editor'); }
  function backToList()    { setShowName(null); setView('list'); }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          {view === 'editor' && (
            <button className="btn-ghost" onClick={backToList}>← Shows</button>
          )}
          <h1 className="logo">Show Creator</h1>
          {showName && <span className="show-name-badge">{showName}</span>}
        </div>
      </header>

      <main className="app-body">
        {view === 'list'   && <ShowList   onOpen={openShow} />}
        {view === 'editor' && <ShowEditor showName={showName} />}
      </main>
    </div>
  );
}
