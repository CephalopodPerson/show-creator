import React, { useState } from 'react';
import ShowList   from './components/ShowList';
import ShowEditor from './components/ShowEditor';
import AdminPanel from './components/AdminPanel';
import './styles.css';

export default function App() {
  const [view, setView]         = useState('list');     // 'list' | 'editor' | 'admin'
  const [showName, setShowName] = useState(null);
  const [editView, setEditView] = useState('grid');     // 'grid' | 'timeline'

  function openShow(name) { setShowName(name); setView('editor'); }
  function backToList()   { setShowName(null); setView('list'); }

  return (
    <div className="app">
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
