import React, { useState, useEffect, useRef } from 'react';

// ── OSC helpers ───────────────────────────────────────────────────────────────
async function oscTrigger(qlcHost, functionId, action = 1) {
  const [host, port] = qlcHost.includes(':')
    ? [qlcHost.split(':')[0], parseInt(qlcHost.split(':')[1])]
    : [qlcHost, 7700];
  return fetch('/api/osc', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ host, port, functionId, action }),
  });
}

// ── ShowPlayer ────────────────────────────────────────────────────────────────
export default function ShowPlayer() {
  const [shows,       setShows]       = useState([]);
  const [expanded,    setExpanded]    = useState(null);   // show name
  const [showData,    setShowData]    = useState({});     // name → full show json
  const [playing,     setPlaying]     = useState(null);   // { showName, seqId }
  const [elapsed,     setElapsed]     = useState(0);
  const [qlcHost,     setQlcHost]     = useState('127.0.0.1');
  const [status,      setStatus]      = useState('');
  const audioRef = useRef(null);
  const timerRef = useRef(null);

  // Load show list
  useEffect(() => {
    fetch('/api/shows').then(r => r.json()).then(setShows).catch(() => {});
  }, []);

  // Load full show data when expanded
  async function expandShow(name) {
    if (expanded === name) { setExpanded(null); return; }
    setExpanded(name);
    if (!showData[name]) {
      const d = await fetch(`/api/shows/${encodeURIComponent(name)}`).then(r => r.json());
      setShowData(prev => ({ ...prev, [name]: d }));
    }
  }

  // Start playing a sequence
  async function playSequence(show, seq) {
    // Stop any current playback first
    stopPlayback(false);

    if (!seq.qlcFunctionId) {
      setStatus('⚠ No QLC+ function ID — export the .qxw first, then try again.');
      return;
    }
    if (!seq.audioPath) {
      setStatus('⚠ No audio file for this sequence.');
      return;
    }

    setStatus('Starting…');
    setPlaying({ showName: show.name, seqId: seq.id, seqName: seq.name });
    setElapsed(0);

    // Fire OSC to QLC+ — start the sequence
    try {
      const r = await oscTrigger(qlcHost, seq.qlcFunctionId, 1);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setStatus(`⚠ OSC error: ${err.error ?? 'unknown'}. Check QLC+ is open and OSC input is enabled on port 7700.`);
      } else {
        setStatus('▶ Playing — QLC+ sequence triggered');
      }
    } catch (e) {
      setStatus(`⚠ Could not reach server: ${e.message}`);
    }

    // Play audio
    if (audioRef.current) {
      audioRef.current.src = seq.audioPath;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => setStatus(`⚠ Audio error: ${e.message}`));
    }

    // Elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed(audioRef.current?.currentTime ?? 0);
    }, 250);
  }

  function stopPlayback(sendOsc = true) {
    clearInterval(timerRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }

    if (sendOsc && playing?.seqId) {
      const show = showData[playing.showName];
      const seq  = show?.sequences?.find(s => s.id === playing.seqId);
      if (seq?.qlcFunctionId) {
        oscTrigger(qlcHost, seq.qlcFunctionId, 0).catch(() => {});
      }
    }

    setPlaying(null);
    setElapsed(0);
    setStatus('');
  }

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  return (
    <div className="player-wrap">
      <div className="player-header">
        <h2 className="player-title">Show Player</h2>
        <p className="player-sub">
          Plays audio and triggers QLC+ sequences via OSC. Make sure QLC+ is open
          and OSC input is enabled on port 7700 (Inputs/Outputs → OSC → port 7700).
        </p>
        <div className="player-qlc-row">
          <label className="player-qlc-label">QLC+ host</label>
          <input
            className="player-qlc-input"
            value={qlcHost}
            onChange={e => setQlcHost(e.target.value)}
            placeholder="127.0.0.1 or 192.168.x.x:7700"
          />
        </div>
      </div>

      {/* Now playing bar */}
      {playing && (
        <div className="player-now-playing">
          <div className="now-playing-info">
            <span className="now-playing-dot">●</span>
            <span className="now-playing-name">{playing.seqName}</span>
            <span className="now-playing-time">{fmt(elapsed)}</span>
          </div>
          <button className="btn-stop" onClick={() => stopPlayback(true)}>■ Stop</button>
        </div>
      )}

      {status && <div className="player-status">{status}</div>}

      {/* Show list */}
      <div className="player-shows">
        {shows.length === 0 && (
          <div className="empty-state">No shows yet — create one in Show Creator first.</div>
        )}
        {shows.map(s => {
          const full = showData[s.name];
          const isOpen = expanded === s.name;
          return (
            <div key={s.name} className="player-show-card">
              <button className="player-show-header" onClick={() => expandShow(s.name)}>
                <span className="player-show-name">{s.name}</span>
                <span className="player-show-meta">{s.sequences} sequence{s.sequences !== 1 ? 's' : ''}</span>
                <span className="player-show-chevron">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="player-seq-list">
                  {!full && <div className="player-loading">Loading…</div>}
                  {full?.sequences?.map(seq => {
                    const isPlaying = playing?.seqId === seq.id;
                    const hasOsc    = !!seq.qlcFunctionId;
                    const hasAudio  = !!seq.audioPath;
                    return (
                      <div key={seq.id} className={`player-seq-row${isPlaying ? ' player-seq-playing' : ''}`}>
                        <div className="player-seq-info">
                          <span className="player-seq-name">{seq.name}</span>
                          <span className="player-seq-flags">
                            {hasOsc   ? <span className="flag flag-ok"  title="QLC+ function ID ready">QLC+</span>
                                      : <span className="flag flag-warn" title="Export .qxw to get QLC+ ID">no QLC+ ID</span>}
                            {hasAudio ? <span className="flag flag-ok"  title="Audio file available">Audio</span>
                                      : <span className="flag flag-warn" title="No audio uploaded">no audio</span>}
                          </span>
                        </div>
                        {isPlaying ? (
                          <button className="btn-seq-stop" onClick={() => stopPlayback(true)}>■ Stop</button>
                        ) : (
                          <button
                            className="btn-seq-play"
                            onClick={() => playSequence(full, seq)}
                            disabled={!hasOsc || !hasAudio}
                            title={!hasOsc ? 'Export .qxw first' : !hasAudio ? 'Upload audio first' : 'Play'}
                          >▶ Play</button>
                        )}
                      </div>
                    );
                  })}
                  {full?.sequences?.length === 0 && (
                    <div className="player-loading">No sequences in this show.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <audio ref={audioRef} onEnded={() => stopPlayback(false)} style={{ display: 'none' }} />
    </div>
  );
}
