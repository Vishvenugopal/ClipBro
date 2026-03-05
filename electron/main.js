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
const OllamaManager = require('./ollama-manager');

let mainWindow = null;
let tray = null;
let screenshotWindow = null;
let clipboardMonitor = null;
let db = null;
let shareServer = null;
let aiEngine = null;
let fileManager = null;
let ollamaManager = null;
let isQuitting = false;

// Set app identity for Windows notifications
app.setAppUserModelId('com.clipbro.app');

// Filesystem watcher for live explorer updates
const activeWatchers = new Map(); // dirPath -> fs.FSWatcher
let watchDebounceTimers = new Map();

function watchDirectory(dirPath) {
  if (!dirPath || activeWatchers.has(dirPath)) return;
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
    const watcher = fs.watch(dirPath, { persistent: false }, (eventType, filename) => {
      // Debounce rapid changes (e.g. temp files, multiple rename events)
      const key = dirPath;
      if (watchDebounceTimers.has(key)) clearTimeout(watchDebounceTimers.get(key));
      watchDebounceTimers.set(key, setTimeout(() => {
        watchDebounceTimers.delete(key);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fs-change', dirPath);
        }
      }, 300));
    });
    watcher.on('error', () => { unwatchDirectory(dirPath); });
    activeWatchers.set(dirPath, watcher);
  } catch (e) {
    console.warn('Failed to watch directory:', dirPath, e.message);
  }
}

function unwatchDirectory(dirPath) {
  const watcher = activeWatchers.get(dirPath);
  if (watcher) {
    watcher.close();
    activeWatchers.delete(dirPath);
  }
}

function unwatchAllDirectories() {
  for (const [dirPath, watcher] of activeWatchers) {
    watcher.close();
  }
  activeWatchers.clear();
  for (const timer of watchDebounceTimers.values()) clearTimeout(timer);
  watchDebounceTimers.clear();
}

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
    icon: path.join(__dirname, '..', 'assets', 'clipbro-icons', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: true,
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'bottom' });
    }
  });

  // Log any renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Reduce memory when hidden
  mainWindow.on('hide', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('window-visibility', false);
    }
  });
  mainWindow.on('show', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('window-visibility', true);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, '..', 'assets', 'clipbro-icons', 'icon.png');
  let trayIcon;
  if (fs.existsSync(trayIconPath)) {
    trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  } else {
    // Fallback to old path
    const oldPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
    if (fs.existsSync(oldPath)) {
      trayIcon = nativeImage.createFromPath(oldPath).resize({ width: 16, height: 16 });
    } else {
      trayIcon = nativeImage.createEmpty();
    }
  }

  tray = new Tray(trayIcon.isEmpty() ? createDefaultTrayIcon() : trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open ClipBro', click: () => showMainWindow() },
    { label: 'Take Screenshot', click: () => takeScreenshot() },
    { type: 'separator' },
    { label: 'Import from Clipboard', click: () => importFromClipboard() },
    { type: 'separator' },
    { label: 'Settings', click: () => showMainWindow('settings') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('ClipBro');
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
  const capture = new ScreenshotCapture(mainWindow, db, CLIPS_DIR);
  await capture.captureFullScreen();
}

function importFromClipboard() {
  if (clipboardMonitor) {
    clipboardMonitor.forceCheck();
  }
}

const DEFAULT_HOTKEYS = {
  toggleApp: 'CommandOrControl+Shift+V',
  screenshot: 'PrintScreen',
  screenshotSelection: 'CommandOrControl+Shift+S'
};

function getHotkeys() {
  try {
    const settings = db.getSettings();
    return {
      toggleApp: settings.hotkeyToggleApp || DEFAULT_HOTKEYS.toggleApp,
      screenshot: settings.hotkeyScreenshot || DEFAULT_HOTKEYS.screenshot,
      screenshotSelection: settings.hotkeyScreenshotSelection || DEFAULT_HOTKEYS.screenshotSelection
    };
  } catch { return { ...DEFAULT_HOTKEYS }; }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const hotkeys = getHotkeys();

  try {
    if (hotkeys.screenshot) {
      globalShortcut.register(hotkeys.screenshot, async () => {
        await takeScreenshot();
      });
    }
  } catch (e) { console.error('Failed to register screenshot hotkey:', e.message); }

  try {
    if (hotkeys.screenshotSelection) {
      globalShortcut.register(hotkeys.screenshotSelection, async () => {
        const capture = new ScreenshotCapture(mainWindow, db, CLIPS_DIR);
        await capture.captureWithSelection();
      });
    }
  } catch (e) { console.error('Failed to register screenshot selection hotkey:', e.message); }

  try {
    if (hotkeys.toggleApp) {
      globalShortcut.register(hotkeys.toggleApp, () => {
        if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          showMainWindow();
        }
      });
    }
  } catch (e) { console.error('Failed to register toggle app hotkey:', e.message); }
}

function setupIPC() {
  // Window controls
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-show', () => { mainWindow?.show(); mainWindow?.focus(); });
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
    const { shell } = require('electron');
    const clip = db.getClip(id);
    if (clip && clip.filePath && fs.existsSync(clip.filePath)) {
      try { await shell.trashItem(clip.filePath); } catch (e) { console.warn('Could not trash clip file:', e.message); }
    }
    return db.deleteClip(id);
  });

  // Soft-delete: remove from DB but keep file (returns full clip data for undo)
  ipcMain.handle('soft-delete-clip', async (_, id) => {
    const clip = db.getClip(id);
    if (!clip) return null;
    db.deleteClip(id);
    return clip; // caller keeps this for potential restore
  });

  // Restore a previously soft-deleted clip (re-insert into DB)
  ipcMain.handle('restore-clip', async (_, clipData) => {
    return db.saveClip(clipData);
  });

  // Hard-delete: trash the file only (DB already cleared by soft-delete)
  ipcMain.handle('trash-clip-file', async (_, filePath) => {
    const { shell } = require('electron');
    if (filePath && fs.existsSync(filePath)) {
      try { await shell.trashItem(filePath); } catch (e) { console.warn('Could not trash clip file:', e.message); }
    }
    return true;
  });

  ipcMain.handle('update-clip', async (_, id, updates) => {
    return db.updateClip(id, updates);
  });

  ipcMain.handle('get-clip-file-path', async (_, id) => {
    const clip = db.getClip(id);
    if (clip && clip.filePath) return clip.filePath;
    return null;
  });

  // Clip History (Edit Versioning)
  ipcMain.handle('save-clip-version', async (_, clipId, content, filePath) => {
    return db.saveClipVersion(clipId, content, filePath);
  });

  ipcMain.handle('get-clip-history', async (_, clipId) => {
    return db.getClipHistory(clipId);
  });

  ipcMain.handle('cleanup-old-history', async (_, days) => {
    return db.cleanupOldHistory(days);
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

  ipcMain.handle('update-folder', async (_, folderId, updates) => {
    return db.updateFolder(folderId, updates);
  });

  ipcMain.handle('delete-folder', async (_, folderId) => {
    return db.deleteFolder(folderId);
  });

  // Hidden folder
  ipcMain.handle('has-passcode', async () => {
    return db.hasPasscode();
  });

  ipcMain.handle('verify-passcode', async (_, passcode) => {
    return db.verifyPasscode(passcode);
  });

  ipcMain.handle('set-passcode', async (_, passcode, email) => {
    return db.setPasscode(passcode, email);
  });

  ipcMain.handle('get-hidden-clips', async (_, passcode) => {
    // Allow bypass when authenticated via Windows Hello / device auth
    if (passcode !== '__device_auth__' && !db.verifyPasscode(passcode)) return null;
    return db.getHiddenClips();
  });

  ipcMain.handle('move-to-hidden', async (_, clipId, passcode) => {
    if (!db.verifyPasscode(passcode)) return false;
    return db.moveToHidden(clipId);
  });

  // Take screenshot from renderer
  ipcMain.handle('take-screenshot', async () => {
    await takeScreenshot();
    return true;
  });

  ipcMain.handle('take-screenshot-selection', async () => {
    const capture = new ScreenshotCapture(mainWindow, db, CLIPS_DIR);
    await capture.captureWithSelection();
    return true;
  });

  // Screenshot editing
  ipcMain.handle('save-edited-clip', async (_, clipId, imageDataUrl) => {
    const clip = db.getClip(clipId);
    // Preserve the previous version's file by copying it to a versioned backup
    if (clip && clip.filePath && fs.existsSync(clip.filePath)) {
      const ext = path.extname(clip.filePath) || '.png';
      const versionPath = path.join(CLIPS_DIR, `${clipId}_v${Date.now()}${ext}`);
      try { fs.copyFileSync(clip.filePath, versionPath); } catch {}
    }
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
    const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
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

  ipcMain.handle('ai-analyze-text', async (_, clipId, prompt) => {
    return aiEngine.analyzeText(clipId, prompt);
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

  // Ollama management
  ipcMain.handle('ollama-status', async () => {
    return ollamaManager.getStatus();
  });

  ipcMain.handle('ollama-download', async () => {
    return ollamaManager.download((progress) => {
      if (mainWindow) mainWindow.webContents.send('ollama-download-progress', progress);
    });
  });

  ipcMain.handle('ollama-install', async () => {
    return ollamaManager.install();
  });

  ipcMain.handle('ollama-start', async () => {
    return ollamaManager.startServer();
  });

  ipcMain.handle('ollama-pull-model', async (_, modelName) => {
    return ollamaManager.pullModel(modelName, (progress) => {
      if (mainWindow) mainWindow.webContents.send('ollama-pull-progress', progress);
    });
  });

  // OCR / Text extraction
  ipcMain.handle('extract-text', async (_, clipId) => {
    const clip = db.getClip(clipId);
    if (!clip || clip.type !== 'image') return null;
    const Tesseract = require('tesseract.js');
    try {
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        preserve_interword_spaces: '1',
      });
      const { data: { text } } = await worker.recognize(clip.filePath);
      await worker.terminate();
      const cleaned = text.trim();
      if (cleaned) db.updateClip(clipId, { extractedText: cleaned });
      return cleaned || null;
    } catch (e) {
      console.error('OCR error:', e);
      return null;
    }
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
    db.saveSettings(settings);

    // Apply startup setting
    if (settings.openOnStartup !== undefined) {
      app.setLoginItemSettings({ openAtLogin: settings.openOnStartup === 'true' });
    }

    // Apply per-type save/notify settings to clipboard monitor
    if (clipboardMonitor) {
      clipboardMonitor.saveTextClips = settings.saveTextClips !== 'false';
      clipboardMonitor.notifyTextClips = settings.notifyTextClips !== 'false';
      clipboardMonitor.saveImageClips = settings.saveImageClips !== 'false';
      clipboardMonitor.notifyImageClips = settings.notifyImageClips !== 'false';
    }

    // Re-register shortcuts if hotkeys changed
    if (settings.hotkeyToggleApp !== undefined || settings.hotkeyScreenshot !== undefined || settings.hotkeyScreenshotSelection !== undefined) {
      registerShortcuts();
    }

    return true;
  });

  ipcMain.handle('get-hotkeys', async () => {
    return getHotkeys();
  });

  ipcMain.handle('get-default-hotkeys', async () => {
    return { ...DEFAULT_HOTKEYS };
  });

  // Choose directory
  ipcMain.handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Clear all clips (move to recycle bin)
  ipcMain.handle('clear-all-clips', async () => {
    try {
      const { shell } = require('electron');
      const clips = db.getClips();
      for (const clip of clips) {
        if (clip.filePath && fs.existsSync(clip.filePath)) {
          await shell.trashItem(clip.filePath);
        }
        db.deleteClip(clip.id);
      }
      return true;
    } catch (e) {
      console.error('Clear all clips error:', e);
      return false;
    }
  });

  // Move data directory (copy everything to new location)
  ipcMain.handle('move-data-directory', async (_, newDir) => {
    try {
      const newClipsDir = path.join(newDir, 'clips');
      const newHiddenDir = path.join(newDir, '.hidden');
      const newThumbDir = path.join(newDir, 'thumbnails');
      [newDir, newClipsDir, newHiddenDir, newThumbDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      });
      // Copy clips
      if (fs.existsSync(CLIPS_DIR)) {
        for (const f of fs.readdirSync(CLIPS_DIR)) {
          fs.copyFileSync(path.join(CLIPS_DIR, f), path.join(newClipsDir, f));
        }
      }
      // Copy hidden
      if (fs.existsSync(HIDDEN_DIR)) {
        for (const f of fs.readdirSync(HIDDEN_DIR)) {
          fs.copyFileSync(path.join(HIDDEN_DIR, f), path.join(newHiddenDir, f));
        }
      }
      // Copy thumbnails
      if (fs.existsSync(THUMBNAILS_DIR)) {
        for (const f of fs.readdirSync(THUMBNAILS_DIR)) {
          fs.copyFileSync(path.join(THUMBNAILS_DIR, f), path.join(newThumbDir, f));
        }
      }
      // Copy database
      const dbPath = path.join(DATA_DIR, 'clipboard.db');
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, path.join(newDir, 'clipboard.db'));
      }
      // Update clip file paths in new DB to point to new location
      const clips = db.getClips();
      for (const clip of clips) {
        if (clip.filePath && clip.filePath.startsWith(CLIPS_DIR)) {
          const newPath = clip.filePath.replace(CLIPS_DIR, newClipsDir);
          db.updateClip(clip.id, { filePath: newPath });
        }
      }
      return { success: true };
    } catch (e) {
      console.error('move-data-directory error:', e);
      return { success: false, error: e.message };
    }
  });

  // Windows Hello / device credential authentication
  ipcMain.handle('authenticate-device', async () => {
    try {
      // Hide the window so the Windows credential popup appears on top
      if (mainWindow) {
        mainWindow.hide();
      }
      // Use Electron's built-in systemPreferences for Windows Hello
      const { systemPreferences } = require('electron');
      if (systemPreferences.canPromptTouchID && systemPreferences.canPromptTouchID()) {
        await systemPreferences.promptTouchID('Access hidden folder');
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        return { success: true };
      }
      // Fallback: use Windows credential prompt via PowerShell
      const { exec } = require('child_process');
      const psScript = `Add-Type -AssemblyName System.Runtime.WindowsRuntime; [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]::RequestVerificationAsync('ClipBro').AsTask().GetAwaiter().GetResult()`;
      const result = await new Promise((resolve, reject) => {
        exec(
          `powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`,
          { encoding: 'utf-8', timeout: 120000 },
          (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout.trim());
          }
        );
      });
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      return { success: result === 'Verified' };
    } catch (e) {
      console.error('Device auth error:', e);
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      return { success: false, error: e.message };
    }
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

  // File explorer - list directory contents
  ipcMain.handle('list-directory', async (_, dirPath) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const results = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase()
          });
        } catch { /* skip inaccessible */ }
      }
      return results.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (e) {
      console.error('list-directory error:', e.message);
      return [];
    }
  });

  // Read text file contents
  ipcMain.handle('read-text-file', async (_, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error('read-text-file error:', e.message);
      return '';
    }
  });

  // Filesystem watching for live explorer updates
  ipcMain.handle('watch-directory', async (_, dirPath) => {
    watchDirectory(dirPath);
    return true;
  });

  ipcMain.handle('unwatch-directory', async (_, dirPath) => {
    unwatchDirectory(dirPath);
    return true;
  });

  // Get app's default folder path
  ipcMain.handle('get-app-folder', async () => {
    const appFolder = path.join(DATA_DIR, 'UserFolders');
    const defaultFolder = path.join(appFolder, 'My Folder');
    if (!fs.existsSync(appFolder)) fs.mkdirSync(appFolder, { recursive: true });
    if (!fs.existsSync(defaultFolder)) fs.mkdirSync(defaultFolder, { recursive: true });
    return appFolder;
  });

  // Get quick-access paths (like Windows explorer sidebar)
  ipcMain.handle('get-quick-access-paths', async () => {
    return {
      home: app.getPath('home'),
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      pictures: app.getPath('pictures'),
      appFolder: path.join(DATA_DIR, 'UserFolders'),
      clipsFolder: CLIPS_DIR
    };
  });

  // Open path in real Windows explorer
  ipcMain.handle('open-in-explorer', async (_, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  // Copy clip file into a filesystem folder
  ipcMain.handle('copy-clip-to-path', async (_, clipId, destDir) => {
    const clip = db.getClip(clipId);
    if (!clip || !clip.filePath || !fs.existsSync(clip.filePath)) return false;
    const ext = path.extname(clip.filePath);
    const destFile = path.join(destDir, `${clip.title || clip.id}${ext}`);
    fs.copyFileSync(clip.filePath, destFile);
    return true;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  ensureDirectories();

  // Initialize database (sql.js is async)
  db = new ClipDatabase(DATA_DIR);
  await db.waitReady();

  // Apply launch-on-startup setting (default: on)
  const openOnStartup = db.getSetting('openOnStartup');
  app.setLoginItemSettings({ openAtLogin: openOnStartup !== 'false' });

  // Initialize file manager
  fileManager = new FileManager(db, CLIPS_DIR);

  // Initialize share server
  shareServer = new ShareServer(db, CLIPS_DIR);
  await shareServer.start();

  // Initialize AI engine
  aiEngine = new AIEngine(db, CLIPS_DIR, DATA_DIR);

  // Initialize Ollama manager
  ollamaManager = new OllamaManager(DATA_DIR);

  // Setup IPC BEFORE creating window so handlers are ready when renderer loads
  setupIPC();

  // Create window and tray
  createMainWindow();
  createTray();
  registerShortcuts();

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
  unwatchAllDirectories();
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});
