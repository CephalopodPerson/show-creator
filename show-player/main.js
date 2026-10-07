const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

// Per-launch secret shared only with our own window. The bridge refuses any
// request without it, so other pages on this PC can't drive it.
const BRIDGE_TOKEN = require('crypto').randomBytes(24).toString('hex');
process.env.BRIDGE_TOKEN = BRIDGE_TOKEN;
require('./server');

let win;

app.whenReady().then(() => {
  win = new BrowserWindow({
    width:  960,
    height: 700,
    minWidth:  700,
    minHeight: 500,
    title: 'Show Player',
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  win.loadFile('app.html', { query: { t: BRIDGE_TOKEN } });
  win.setMenuBarVisibility(false);

  // F12 toggles DevTools
  globalShortcut.register('F12', () => {
    if (win) win.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});
