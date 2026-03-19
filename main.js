/**
 * main.js — Electron entry point for Show Creator
 *
 * Starts the Express server in-process, then opens a BrowserWindow
 * pointing at it once it's ready. Show data is stored in the OS
 * user-data directory so it survives app updates.
 */

const { app, BrowserWindow, shell, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');

// ── Config ───────────────────────────────────────────────────────────────────
const PORT = 3847;   // unusual port to avoid clashing with other local servers

// Set env vars BEFORE requiring the server so it picks them up
process.env.PORT     = PORT;
process.env.NODE_ENV = 'production';
// Store shows in the OS user-data dir (writable, survives app updates)
process.env.SHOWS_DIR = path.join(app.getPath('userData'), 'shows');

// ── Start the Express backend ────────────────────────────────────────────────
require('./server/index.js');

// ── Poll until the server is ready ───────────────────────────────────────────
function waitForServer(cb, retries = 50) {
  http.get(`http://localhost:${PORT}/`, res => cb())
    .on('error', () => {
      if (retries > 0) setTimeout(() => waitForServer(cb, retries - 1), 200);
      else console.error('Server failed to start');
    });
}

// ── Create the main window ───────────────────────────────────────────────────
let win;

function createWindow() {
  win = new BrowserWindow({
    width:    1400,
    height:   900,
    minWidth: 960,
    minHeight: 600,
    title: 'Show Creator',
    show: false,   // don't show until content is loaded
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  // Open external links in the real browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  waitForServer(() => {
    win.loadURL(`http://localhost:${PORT}`);
    win.once('ready-to-show', () => win.show());
  });

  win.on('closed', () => { win = null; });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  // F12 opens DevTools for debugging
  globalShortcut.register('F12', () => {
    if (win) win.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => {
  // On macOS apps stay open until the user explicitly quits
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // On macOS re-create the window when the dock icon is clicked
  if (!win) createWindow();
});
