import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';

// WaveformPlayer renders the waveform visual only.
// Parent (SequenceEditor) owns the scroll container, playhead, and play/pause button.
//
// Exposes via ref:
//   seek(pct)        — seek to 0-1 fraction (only when audio loaded)
//   togglePlay()     — play or pause
//   getCurrentTime() — current position in seconds

const WaveformPlayer = forwardRef(function WaveformPlayer(
  { src, width, pxPerSec, onTimeUpdate, onDuration, onPlayingChange },
  ref
) {
  const containerRef  = useRef(null);
  const waveRef       = useRef(null);    // the WaveSurfer instance
  const audioReady    = useRef(false);   // true once audio is decoded
  const pxPerSecRef   = useRef(pxPerSec); // always reflects latest pxPerSec prop

  useImperativeHandle(ref, () => ({
    seek:           pct => waveRef.current?.seekTo(Math.max(0, Math.min(1, pct))),
    togglePlay:     ()  => waveRef.current?.playPause(),
    getCurrentTime: ()  => waveRef.current?.getCurrentTime() ?? 0,
  }));

  // Create WaveSurfer once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    let ws;
    try {
      ws = WaveSurfer.create({
        container:     containerRef.current,
        waveColor:     '#4a9eff44',
        progressColor: '#4a9eff88',
        cursorWidth:   0,       // parent draws the unified playhead
        height:        80,
        normalize:     true,
        interact:      false,   // parent handles click-to-seek
        fillParent:    true,    // fill whatever width we give the container
      });
    } catch (err) {
      console.error('WaveSurfer init failed:', err);
      return;
    }

    ws.on('ready', () => {
      audioReady.current = true;
      const dur = ws.getDuration();
      onDuration?.(dur);
      // Use pxPerSecRef so we always zoom to whatever scale is current
      if (pxPerSecRef.current) {
        try { ws.zoom(pxPerSecRef.current); } catch (_) {}
      }
    });
    ws.on('timeupdate', t => onTimeUpdate?.(t));
    ws.on('play',   () => onPlayingChange?.(true));
    ws.on('pause',  () => onPlayingChange?.(false));
    ws.on('finish', () => onPlayingChange?.(false));

    waveRef.current = ws;
    return () => {
      audioReady.current = false;
      ws.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load new source when it changes
  useEffect(() => {
    if (!waveRef.current || !src) return;
    audioReady.current = false;
    waveRef.current.load(src);
  }, [src]);

  // Keep pxPerSecRef current so the ready handler always sees the latest value
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);

  // Re-zoom when pxPerSec or width changes — ONLY after audio is loaded
  useEffect(() => {
    if (!waveRef.current || !pxPerSec || !audioReady.current) return;
    try { waveRef.current.zoom(pxPerSec); } catch (_) {}
  }, [pxPerSec, width]);

  return (
    <div
      ref={containerRef}
      className="waveform-canvas"
      style={{ width: width ?? '100%', height: 80 }}
    />
  );
});

export default WaveformPlayer;
