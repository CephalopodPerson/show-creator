# Show Creator

QLC+ sequence builder — design lighting cues for live shows in your browser, then export directly into QLC+.

## Requirements

- [Node.js 18+](https://nodejs.org/) — install this first if you don't have it

## Quick Start (included build — no compile needed)

```bash
# 1. Install server dependencies (takes ~30 seconds)
npm install

# 2. Start the app
npm start

# 3. Open in your browser
http://localhost:3000
```

That's it — the React frontend is already pre-built inside this package.

## Workflow

1. **Create a show** — give it a name on the home screen
2. **Upload your `.qxw` file** — fixtures are extracted automatically (sidebar)
3. **Add sequences** — one per song/act (+ button in sidebar)
4. **For each sequence:**
   - Upload the audio file (MP3/WAV/FLAC) — waveform appears, a full-song step is created automatically
   - Hit **✂ Split at [time]** while the track plays to divide the song into sections
   - Click a step block to select it → set colours, brightness, fades in the panel below
   - Drag blocks to move them; drag the **right edge** to resize (adjacent step moves with it)
   - Toggle **Par / Spot** ON/OFF per step; disabled steps show as hollow "OFF" frames
5. **Export .qxw** — downloads your original QLC+ file with all sequences merged in, **plus a Virtual Console Show Frame** containing one Toggle button per sequence so the operator can trigger each song with a single click

## What's exported

- A **Bound Scene** (zeroed channels) for each sequence
- A **Sequence function** with per-step DMX values, fade in/out timings, and notes
- A **Virtual Console frame** named after your show, with one button per sequence linked to its sequence function — just drag it where you want it in QLC+

## Show folder structure

```
shows/
  My Show Name/
    show.json          ← auto-saved work (don't delete)
    uploads/           ← uploaded .qxw and audio files
    My_Show_Name.qxw   ← exported output
```

## Build a desktop app (Electron — no Node.js required for end users)

```bash
# 1. Install all dependencies (first time only)
npm run install:all

# 2. Build Windows installer  (.exe in dist-electron/)
npm run build:win

# 3. Build Mac disk image    (.dmg in dist-electron/)
npm run build:mac

# 4. Build Linux AppImage    (.AppImage in dist-electron/)
npm run build:linux
```

The installer bundles everything — end users just download and double-click.
Show data is saved to the OS user folder (`AppData/Roaming` on Windows, `~/Library/Application Support` on Mac) so it persists through app updates.

## Deploy to a VPS (web server)

1. Point a domain at your VPS
2. `npm run install:all && npm run build:client`
3. `NODE_ENV=production node server/index.js`
4. Add nginx reverse proxy + Let's Encrypt SSL
