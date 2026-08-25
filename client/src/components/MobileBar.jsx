import React from 'react';
import { COLORS, EFFECTS, FLASH_TOOL, COLOR_META, EFFECT_META } from './Palette';

// ── Mobile bottom bar + sheets ────────────────────────────────────────────────
// Phones get a fixed bottom bar instead of the desktop sidebar. Tapping Colors
// or Effects raises a sheet; picking one arms it, then you tap a block to
// apply. Everything sits in thumb reach at the bottom of the screen rather
// than in a top toolbar you have to stretch for.

export default function MobileBar({
  sheet, onSheet,            // null | 'colors' | 'effects'
  armed, onArm,
  page, onPage,
  brightness, onBrightness, maxBrightness = 100,
  custom = [], onAddColor, onRemoveColor,
  onUndo, canUndo,
  pickerValue, onPickerChange,
}) {
  const b = Math.min(brightness, maxBrightness);
  const close = () => onSheet(null);

  function arm(payload) {
    onArm(armed?.key === payload.key ? null : payload);
    onSheet(null);   // drop the sheet so the timeline is visible to tap
  }

  return (
    <>
      {/* Backdrop */}
      {sheet && <div className="sheet-backdrop" onClick={close} />}

      {/* Colors sheet */}
      {sheet === 'colors' && (
        <div className="sheet">
          <div className="sheet-head">
            <span className="sheet-title">Colors</span>
            <button className="sheet-close" onClick={close}>✕</button>
          </div>

          <div className="sheet-bright">
            <span className="sheet-bright-label">Brightness</span>
            <input
              type="range" min={5} max={maxBrightness} value={b}
              onChange={e => onBrightness(+e.target.value)}
              className="sheet-bright-slider"
            />
            <span className="sheet-bright-val">{b}%</span>
          </div>

          <div className="sheet-body">
            <div className="sheet-swatches">
              {COLORS.map(c => (
                <button
                  key={c.key}
                  className={`sheet-swatch${armed?.key === c.key ? ' sheet-swatch-armed' : ''}`}
                  style={{ background: c.hex }}
                  onClick={() => arm({ kind: 'color', key: c.key, label: c.label, hex: c.hex, color: c })}
                >
                  <span className="sheet-swatch-name">{c.label}</span>
                </button>
              ))}
            </div>

            {custom.length > 0 && (
              <>
                <div className="sheet-sub">Custom</div>
                <div className="sheet-swatches">
                  {custom.map(c => (
                    <button
                      key={c.key}
                      className={`sheet-swatch${armed?.key === c.key ? ' sheet-swatch-armed' : ''}`}
                      style={{ background: c.hex }}
                      onClick={() => arm({ kind: 'color', key: c.key, label: c.label, hex: c.hex, color: c })}
                      onContextMenu={e => { e.preventDefault(); onRemoveColor?.(c.key); }}
                    >
                      <span className="sheet-swatch-name">{c.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="sheet-sub">Mix your own</div>
            <div className="sheet-mix">
              <input
                type="color" className="sheet-picker"
                value={pickerValue}
                onChange={e => onPickerChange(e.target.value)}
              />
              <button className="btn-secondary" onClick={() => onAddColor?.(pickerValue)}>＋ Add color</button>
            </div>
          </div>
        </div>
      )}

      {/* Effects sheet */}
      {sheet === 'effects' && (
        <div className="sheet">
          <div className="sheet-head">
            <span className="sheet-title">Effects</span>
            <button className="sheet-close" onClick={close}>✕</button>
          </div>
          <div className="sheet-body">
            <div className="sheet-fx">
              <button
                className={`sheet-fx-btn${armed?.key === 'flash' ? ' sheet-fx-armed' : ''}`}
                onClick={() => arm({ kind: 'flash', key: 'flash', label: 'Flash', icon: FLASH_TOOL.icon })}
              >
                <span className="sheet-fx-icon">{FLASH_TOOL.icon}</span>
                <span className="sheet-fx-name">Flash</span>
                <span className="sheet-fx-desc">A quick one-shot hit</span>
              </button>
              {EFFECTS.map(e => (
                <button
                  key={e.key}
                  className={`sheet-fx-btn${armed?.key === e.key ? ' sheet-fx-armed' : ''}`}
                  onClick={() => arm({ kind: 'effect', key: e.key, label: e.label, icon: e.icon })}
                >
                  <span className="sheet-fx-icon">{e.icon}</span>
                  <span className="sheet-fx-name">{e.label}</span>
                  <span className="sheet-fx-desc">{e.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Armed banner sits just above the bar */}
      {armed && (
        <div className="armed-bar">
          <span className="armed-dot" style={{ background: armed.hex ?? 'var(--accent)' }} />
          <span>Tap a block to apply <strong>{armed.label}</strong></span>
          <button className="armed-cancel" onClick={() => onArm(null)}>✕</button>
        </div>
      )}

      {/* Bottom bar */}
      <nav className="mobile-bar">
        <button
          className={`mbar-btn${sheet === 'colors' ? ' mbar-active' : ''}`}
          onClick={() => onSheet(sheet === 'colors' ? null : 'colors')}
        >
          <span className="mbar-icon">🎨</span>
          <span className="mbar-label">Colors</span>
        </button>

        <button
          className={`mbar-btn${sheet === 'effects' ? ' mbar-active' : ''}`}
          onClick={() => onSheet(sheet === 'effects' ? null : 'effects')}
        >
          <span className="mbar-icon">✦</span>
          <span className="mbar-label">Effects</span>
        </button>

        <button className="mbar-btn" onClick={onUndo} disabled={!canUndo}>
          <span className="mbar-icon">↶</span>
          <span className="mbar-label">Undo</span>
        </button>

        <button
          className={`mbar-btn${page === 'preview' ? ' mbar-active' : ''}`}
          onClick={() => onPage(page === 'edit' ? 'preview' : 'edit')}
        >
          <span className="mbar-icon">{page === 'edit' ? '▶' : '✎'}</span>
          <span className="mbar-label">{page === 'edit' ? 'Preview' : 'Edit'}</span>
        </button>
      </nav>
    </>
  );
}
