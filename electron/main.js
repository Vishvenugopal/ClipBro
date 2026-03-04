const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, screen, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Modules
const ClipboardMonitor = require('./clipboard-monitor');
const ScreenshotCapture = require('./screenshot-capture');
const ClipDatabase = require('./database');
const ShareServer = require('./share-server');
const AIEngine = require('./ai-engine');
const FileManager = require('./file-manager');

let mainWindow = null;
let tray = null;
let screenshotWindow = null;
let clipboardMonitor = null;
let db = null;
let shareServer = null;
let aiEngine = null;
let fileManager = null;
let isQuitting = false;

const DATA_DIR = path.join(app.getPath('userData'), 'UniversalClipboard');
const CLIPS_DIR = path.join(DATA_DIR, 'clips');
const HIDDEN_DIR = path.join(DATA_DIR, '.hidden');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');

function ensureDirectories() {
  [DATA_DIR, CLIPS_DIR, HIDDEN_DIR, THUMBNAILS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width - 100),
    height: Math.min(900, height - 100),
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0f',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'bottom' });
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  if (fs.existsSync(trayIconPath)) {
    trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  } else {
    // Create a simple colored icon programmatically
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? createDefaultTrayIcon() : trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Universal Clipboard', click: () => showMainWindow() },
    { label: 'Take Screenshot', click: () => takeScreenshot() },
    { type: 'separator' },
    { label: 'Import from Clipboard', click: () => importFromClipboard() },
    { type: 'separator' },
    { label: 'Settings', click: () => showMainWindow('settings') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('Universal Clipboard');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => showMainWindow());
}

function createDefaultTrayIcon() {
  // Create a 16x16 icon with a green accent
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
      if (dist < 7) {
        canvas[i] = 76;     // R
        canvas[i + 1] = 217; // G
        canvas[i + 2] = 100; // B
        canvas[i + 3] = dist < 5 ? 255 : Math.max(0, 255 - (dist - 5) * 80); // A
      } else {
        canvas[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function showMainWindow(section) {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  if (section) {
    mainWindow.webContents.send('navigate', section);
  }
}

async function takeScreenshot() {
  const ScreenshotCapture = require('./screenshot-capture');
  const capture = new ScreenshotCapture(mainWindow, db, CLIPS_DIR);
  await capture.captureFullScreen();
}

function importFromClipboard() {
  if (clipboardMonitor) {
    clipboardMonitor.forceCheck();
  }
}

function registerShortcuts() {
  // PrintScreen - take screenshot
  globalShortcut.register('PrintScreen', async () => {
    await takeScreenshot();
  });

  // Ctrl+Shift+S - screenshot with selection
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    const capture = new ScreenshotCapture(mainWindow, db, CLIPS_DIR);
    await capture.captureWithSelection();
  });

  // Ctrl+Shift+V - show app
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    showMainWindow();
  });
}

function setupIPC() {
  // Window controls
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.hide());

  // Clips
  ipcMain.handle('get-clips', async (_, filters) => {
    return db.getClips(filters);
  });

  ipcMain.handle('get-clip', async (_, id) => {
    return db.getClip(id);
  });

  ipcMain.handle('save-clip', async (_, clipData) => {
    return db.saveClip(clipData);
  });

  ipcMain.handle('delete-clip', async (_, id) => {
    return db.deleteClip(id);
  });

  ipcMain.handle('update-clip', async (_, id, updates) => {
    return db.updateClip(id, updates);
  });

  ipcMain.handle('get-clip-file-path', async (_, id) => {
    const clip = db.getClip(id);
    if (clip && clip.filePath) return clip.filePath;
    return null;
  });

  // Folders
  ipcMain.handle('get-folders', async () => {
    return db.getFolders();
  });

  ipcMain.handle('create-folder', async (_, folderData) => {
    return db.createFolder(folderData);
  });

  ipcMain.handle('move-clip-to-folder', async (_, clipId, folderId) => {
    return db.moveClipToFolder(clipId, folderId);
  });

  ipcMain.handle('pin-folder', async (_, folderId, pinned) => {
    return db.pinFolder(folderId, pinned);
  });

  ipcMain.handle('delete-folder', async (_, folderId) => {
    return db.deleteFolder(folderId);
  });

  // Hidden folder
  ipcMain.handle('verify-passcode', async (_, passcode) => {
    return db.verifyPasscode(passcode);
  });

  ipcMain.handle('set-passcode', async (_, passcode, email) => {
    return db.setPasscode(passcode, email);
  });

  ipcMain.handle('get-hidden-clips', async (_, passcode) => {
    if (!db.verifyPasscode(passcode)) return null;
    return db.getHiddenClips();
  });

  ipcMain.handle('move-to-hidden', async (_, clipId, passcode) => {
    if (!db.verifyPasscode(passcode)) return false;
    return db.moveToHidden(clipId);
  });

  // Screenshot editing
  ipcMain.handle('save-edited-clip', async (_, clipId, imageDataUrl) => {
    const buffer = Buffer.from(imageDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const filePath = path.join(CLIPS_DIR, `${clipId}_edited.png`);
    fs.writeFileSync(filePath, buffer);
    db.updateClip(clipId, { filePath, editedAt: Date.now() });
    return filePath;
  });

  // Sharing
  ipcMain.handle('generate-qr', async (_, clipId) => {
    const url = await shareServer.createTemporaryLink(clipId);
    const QRCode = require('qrcode');
    const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#ffffff', light: '#00000000' } });
    return { url, qrDataUrl };
  });

  ipcMain.handle('create-share-link', async (_, clipId, expiryMinutes) => {
    return shareServer.createTemporaryLink(clipId, expiryMinutes);
  });

  ipcMain.handle('send-email', async (_, clipId, email) => {
    return shareServer.sendEmail(clipId, email);
  });

  // AI
  ipcMain.handle('ai-analyze-image', async (_, clipId, prompt) => {
    return aiEngine.analyzeImage(clipId, prompt);
  });

  ipcMain.handle('ai-search-web', async (_, clipId, useAI) => {
    return aiEngine.searchWeb(clipId, useAI);
  });

  ipcMain.handle('get-ai-settings', async () => {
    return aiEngine.getSettings();
  });

  ipcMain.handle('save-ai-settings', async (_, settings) => {
    return aiEngine.saveSettings(settings);
  });

  // OCR / Text extraction
  ipcMain.handle('extract-text', async (_, clipId) => {
    const clip = db.getClip(clipId);
    if (!clip || clip.type !== 'image') return null;
    const Tesseract = require('tesseract.js');
    const { data: { text } } = await Tesseract.recognize(clip.filePath, 'eng');
    db.updateClip(clipId, { extractedText: text });
    return text;
  });

  // QR code detection from image
  ipcMain.handle('detect-qr', async (_, clipId) => {
    const clip = db.getClip(clipId);
    if (!clip || clip.type !== 'image') return null;
    try {
      const Jimp = require('jimp');
      const jsQR = require('jsqr');
      const image = await Jimp.read(clip.filePath);
      const { data, width, height } = image.bitmap;
      const code = jsQR(new Uint8ClampedArray(data), width, height);
      return code ? code.data : null;
    } catch { return null; }
  });

  // File operations
  ipcMain.handle('import-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] },
        { name: 'Text', extensions: ['txt', 'md', 'json', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!result.canceled) {
      return fileManager.importFiles(result.filePaths);
    }
    return [];
  });

  ipcMain.handle('export-clip', async (_, clipId, destPath) => {
    return fileManager.exportClip(clipId, destPath);
  });

  ipcMain.handle('save-clip-as', async (_, clipId) => {
    const clip = db.getClip(clipId);
    if (!clip) return null;
    const ext = clip.type === 'image' ? 'png' : 'txt';
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `clip_${clip.id}.${ext}`,
      filters: clip.type === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg'] }]
        : [{ name: 'Text', extensions: ['txt', 'md'] }]
    });
    if (!result.canceled) {
      return fileManager.exportClip(clipId, result.filePath);
    }
    return null;
  });

  // Clipboard operations
  ipcMain.handle('copy-to-clipboard', async (_, clipId) => {
    const clip = db.getClip(clipId);
    if (!clip) return false;
    if (clip.type === 'image' && clip.filePath) {
      const img = nativeImage.createFromPath(clip.filePath);
      clipboard.writeImage(img);
    } else if (clip.content) {
      clipboard.writeText(clip.content);
    }
    return true;
  });

  ipcMain.handle('paste-from-clipboard', async () => {
    if (clipboardMonitor) clipboardMonitor.forceCheck();
    return true;
  });

  // Settings
  ipcMain.handle('get-settings', async () => {
    return db.getSettings();
  });

  ipcMain.handle('save-settings', async (_, settings) => {
    return db.saveSettings(settings);
  });

  // Open external
  ipcMain.handle('open-external', async (_, url) => {
    shell.openExternal(url);
  });

  // Drag start
  ipcMain.on('drag-start', (event, clipId) => {
    const clip = db.getClip(clipId);
    if (clip && clip.filePath && fs.existsSync(clip.filePath)) {
      event.sender.startDrag({
        file: clip.filePath,
        icon: nativeImage.createFromPath(clip.filePath).resize({ width: 64, height: 64 })
      });
    }
  });

  // Groups / Tags
  ipcMain.handle('get-groups', async () => {
    return db.getGroups();
  });

  ipcMain.handle('auto-group-clips', async () => {
    return db.autoGroupClips();
  });

  // Search
  ipcMain.handle('search-clips', async (_, query) => {
    return db.searchClips(query);
  });

  // Highlight to search
  ipcMain.handle('highlight-search', async (_, text) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle('highlight-search-image', async (_, imageDataUrl) => {
    // Save temp file and open Google Lens
    const buffer = Buffer.from(imageDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const tempPath = path.join(DATA_DIR, 'temp_search.png');
    fs.writeFileSync(tempPath, buffer);
    shell.openExternal('https://lens.google.com');
    return true;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  ensureDirectories();

  // Initialize database (sql.js is async)
  db = new ClipDatabase(DATA_DIR);
  await db.waitReady();

  // Initialize file manager
  fileManager = new FileManager(db, CLIPS_DIR);

  // Initialize share server
  shareServer = new ShareServer(db, CLIPS_DIR);
  await shareServer.start();

  // Initialize AI engine
  aiEngine = new AIEngine(db, CLIPS_DIR, DATA_DIR);

  // Create window and tray
  createMainWindow();
  createTray();
  registerShortcuts();
  setupIPC();

  // Start clipboard monitoring
  clipboardMonitor = new ClipboardMonitor(db, CLIPS_DIR, mainWindow);
  clipboardMonitor.start();

  // Single instance lock
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => showMainWindow());
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close - keep in tray
});

app.on('before-quit', () => {
  isQuitting = true;
  if (clipboardMonitor) clipboardMonitor.stop();
  if (shareServer) shareServer.stop();
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});
