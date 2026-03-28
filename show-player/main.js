const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

// Start the local OSC bridge server before opening the window
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

  win.loadFile('app.html');
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
