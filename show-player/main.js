const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');

let win;

// Opening Show Player a second time just brings the first window forward —
// two copies would fight over the bridge port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  start();
}

function start() {
  // Per-launch secret shared only with our own window. The bridge refuses any
  // request without it, so other pages on this PC can't drive it.
  const BRIDGE_TOKEN = require('crypto').randomBytes(24).toString('hex');
  process.env.BRIDGE_TOKEN = BRIDGE_TOKEN;
  const bridgeServer = require('./server');

  // Another program (usually an older Show Player) already holds the port
  bridgeServer.on('error', err => {
    dialog.showErrorBox('Show Player is already running',
      err.code === 'EADDRINUSE'
        ? 'Another copy of Show Player (possibly an older version) is already open.\n\nClose it, then open Show Player again.'
        : `The Show Player bridge could not start: ${err.message}`);
    app.quit();
  });

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
}
