// Kora for Windows and Mac. It is the Kora web app in its own window: same sign-in, same data, updates arrive with the site.
// Nothing from the web page can reach the computer: no Node in the page, a sandbox, and no permission prompts are granted.
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const START = process.env.KORA_URL || require('./app-config.json').url;
const ORIGIN = new URL(START).origin;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}
function saveState(win) {
  try { if (!win.isMinimized() && !win.isMaximized()) fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch { /* not important */ }
}

function createWindow() {
  const b = loadState();
  const win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 820, x: b.x, y: b.y, minWidth: 900, minHeight: 600,
    title: 'Kora', backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.on('close', () => saveState(win));

  const wc = win.webContents;
  // Only Kora's own address opens in this window. Anything else (a payment page, a link in an invoice) opens in the browser.
  const isOurs = (u) => { try { return new URL(u).origin === ORIGIN; } catch { return false; } };
  const external = (u) => { if (/^https?:\/\//i.test(u)) void shell.openExternal(u); };
  wc.setWindowOpenHandler(({ url }) => { if (isOurs(url)) return { action: 'allow' }; external(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!isOurs(url) && !url.startsWith('file:')) { e.preventDefault(); external(url); } });
  wc.on('did-fail-load', (_e, code, _desc, _url, isMain) => {
    if (isMain && code !== -3) void win.loadFile(path.join(__dirname, 'offline.html'));
  });
  void win.loadURL(START);
  return win;
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Kora', submenu: [{ label: 'Open Kora in my browser', click: () => external(START) }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
      { label: 'Help', submenu: [{ label: 'Help centre', click: () => external(`${ORIGIN}/help`) }] },
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
