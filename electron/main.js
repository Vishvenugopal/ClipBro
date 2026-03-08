const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, screen, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Enable GC access for memory management when minimized to tray
app.commandLine.appendSwitch('js-flags', '--expose-gc');
// Reduce GPU memory usage
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('gpu-rasterization-msaa-sample-count', '0');

// Modules
const ClipboardMonitor = require('./clipboard-monitor');
const ScreenshotCapture = require('./screenshot-capture');
const ClipDatabase = require('./database');
const FileManager = require('./file-manager');
// Lazy-loaded modules (heavy dependencies like express)
let ShareServer = null;
let AIEngine = null;
let OllamaManager = null;

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

// Set app identity for Windows taskbar / notifications
app.setAppUserModelId('com.clipbro.app');
app.setName('ClipBro');

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
const CLIPS_DIR = path.join(DATA_DIR, 'All Clips');
const OLD_CLIPS_DIR = path.join(DATA_DIR, 'clips');
const OLD_UF_DIR = path.join(DATA_DIR, 'UserFolders');
const OLD_UF_CLIPS_DIR = path.join(OLD_UF_DIR, 'All Clips');
const HIDDEN_DIR = path.join(DATA_DIR, '.hidden');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');

function ensureDirectories() {
  [DATA_DIR, CLIPS_DIR, HIDDEN_DIR, THUMBNAILS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

/** Migrate clips from legacy directories to All Clips/ */
function migrateClipsDirectory(database) {
  // Migration 1: old DATA_DIR/clips/ → All Clips/
  if (fs.existsSync(OLD_CLIPS_DIR)) {
    const files = fs.readdirSync(OLD_CLIPS_DIR);
    if (files.length > 0) {
      console.log(`[Migration] Moving ${files.length} clip(s) from clips/ to All Clips/...`);
      for (const f of files) {
        const src = path.join(OLD_CLIPS_DIR, f);
        const dest = path.join(CLIPS_DIR, f);
        if (!fs.existsSync(dest)) {
          try { fs.copyFileSync(src, dest); } catch (e) { console.warn('[Migration] Failed to copy:', f, e.message); }
        }
      }
      try {
        for (const f of files) { const s = path.join(OLD_CLIPS_DIR, f); if (fs.existsSync(s)) fs.unlinkSync(s); }
        fs.rmdirSync(OLD_CLIPS_DIR);
        console.log('[Migration] Old clips/ directory removed.');
      } catch (e) { console.warn('[Migration] Could not remove old clips dir:', e.message); }
    }
  }
  // Migration 2: UserFolders/All Clips/ → All Clips/  (and subfolders)
  if (fs.existsSync(OLD_UF_DIR)) {
    // Move files from UserFolders/All Clips/ into new CLIPS_DIR
    if (fs.existsSync(OLD_UF_CLIPS_DIR)) {
      const entries = fs.readdirSync(OLD_UF_CLIPS_DIR);
      console.log(`[Migration] Moving ${entries.length} item(s) from UserFolders/All Clips/ to All Clips/...`);
      for (const e of entries) {
        const src = path.join(OLD_UF_CLIPS_DIR, e);
        const dest = path.join(CLIPS_DIR, e);
        if (!fs.existsSync(dest)) {
          try { fs.renameSync(src, dest); } catch (err) {
            try { fs.copyFileSync(src, dest); fs.unlinkSync(src); } catch (e2) { console.warn('[Migration] Failed:', e, e2.message); }
          }
        }
      }
    }
    // Move any other subfolders from UserFolders/ into All Clips/
    try {
      const ufEntries = fs.readdirSync(OLD_UF_DIR);
      for (const e of ufEntries) {
        if (e === 'All Clips') continue;
        const src = path.join(OLD_UF_DIR, e);
        const dest = path.join(CLIPS_DIR, e);
        if (fs.statSync(src).isDirectory() && !fs.existsSync(dest)) {
          try { fs.renameSync(src, dest); } catch (err) { console.warn('[Migration] Could not move subfolder:', e, err.message); }
        }
      }
    } catch (e) { console.warn('[Migration] UserFolders scan error:', e.message); }
    // Remove old UserFolders/
    try {
      fs.rmSync(OLD_UF_DIR, { recursive: true, force: true });
      console.log('[Migration] Old UserFolders/ directory removed.');
    } catch (e) { console.warn('[Migration] Could not remove UserFolders:', e.message); }
  }
  // Update DB paths
  if (database) {
    try {
      const clips = database.getClips();
      for (const clip of clips) {
        if (clip.filePath) {
          let newPath = clip.filePath;
          if (newPath.includes(path.join('UserFolders', 'All Clips'))) {
            newPath = newPath.replace(path.join(DATA_DIR, 'UserFolders', 'All Clips'), CLIPS_DIR);
          } else if (newPath.startsWith(OLD_CLIPS_DIR)) {
            newPath = newPath.replace(OLD_CLIPS_DIR, CLIPS_DIR);
          }
          if (newPath !== clip.filePath) database.updateClip(clip.id, { filePath: newPath });
        }
      }
      // Update folder paths
      const folders = database.getFolders();
      for (const f of folders) {
        if (f.path && f.path.includes('UserFolders')) {
          const newPath = f.path.replace(path.join(DATA_DIR, 'UserFolders', 'All Clips'), CLIPS_DIR)
                                 .replace(path.join(DATA_DIR, 'UserFolders'), CLIPS_DIR);
          if (newPath !== f.path) database.updateFolder(f.id, { path: newPath });
        }
      }
    } catch (e) { console.warn('[Migration] DB path update error:', e.message); }
  }
}

/** Scan All Clips directory and register any files that aren't tracked in the DB */
function syncFilesystemToDB(database, clipsDir) {
  try {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico'];
    const textExts = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.py'];

    // Build a set of all filePaths already known to the DB
    const existingClips = database.getClips();
    const knownPaths = new Set(existingClips.map(c => c.filePath).filter(Boolean));

    // Scan the clips directory (non-recursive — only top-level files)
    if (!fs.existsSync(clipsDir)) return;
    const entries = fs.readdirSync(clipsDir, { withFileTypes: true });
    let synced = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) continue; // skip subdirectories
      const fullPath = path.join(clipsDir, entry.name);
      if (knownPaths.has(fullPath)) continue; // already tracked

      const ext = path.extname(entry.name).toLowerCase();
      let type = 'file';
      if (imageExts.includes(ext)) type = 'image';
      else if (textExts.includes(ext)) type = 'text';

      try {
        const stat = fs.statSync(fullPath);
        const clipData = {
          type,
          title: entry.name,
          filePath: fullPath,
          fileSize: stat.size,
          source: 'filesystem',
          createdAt: stat.mtimeMs || Date.now()
        };
        if (type === 'text') {
          try { clipData.content = fs.readFileSync(fullPath, 'utf-8'); } catch {}
        }
        database.saveClip(clipData);
        synced++;
      } catch (e) { /* skip inaccessible files */ }
    }

    if (synced > 0) console.log(`[Sync] Registered ${synced} untracked file(s) from All Clips`);
  } catch (e) {
    console.warn('[Sync] Filesystem scan error:', e.message);
  }
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

  // Aggressively reduce memory when hidden (minimized to tray)
  mainWindow.on('hide', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('window-visibility', false);
      // Keep clipboard monitoring active so desktop notifications still fire when in tray
      // Close all filesystem watchers to release handles & callbacks
      unwatchAllDirectories();
      // Clear HTTP/code caches to free memory
      mainWindow.webContents.session.clearCache().catch(() => {});
      mainWindow.webContents.session.clearCodeCaches({}).catch(() => {});
      // Background throttling ensures Chromium deprioritises the hidden renderer
      mainWindow.webContents.setBackgroundThrottling(true);
      // Trigger renderer-side garbage collection (gc is exposed via --js-flags)
      mainWindow.webContents.executeJavaScript(`
        if (typeof gc === 'function') gc();
      `).catch(() => {});
      // Main process GC
      if (typeof global.gc === 'function') global.gc();
      // Delayed second GC pass to catch deferred garbage
      setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.webContents.executeJavaScript('if(typeof gc==="function")gc();').catch(() => {});
          if (typeof global.gc === 'function') global.gc();
        }
      }, 8000);
      // Third GC pass — catches late-released renderer objects after DOM tear-down
      setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.webContents.executeJavaScript('if(typeof gc==="function")gc();').catch(() => {});
          if (typeof global.gc === 'function') global.gc();
        }
      }, 20000);
    }
  });
  mainWindow.on('show', () => {
    if (mainWindow && mainWindow.webContents) {
      // Clipboard monitoring stays active for tray notifications — no resume needed
      mainWindow.webContents.send('window-visibility', true);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Prefer .ico for tray/taskbar (multi-resolution, better rendering on Windows)
  const icoPath = path.join(__dirname, '..', 'assets', 'clipbro-icons', 'icon.ico');
  const pngPath = path.join(__dirname, '..', 'assets', 'clipbro-icons', 'icon.png');
  let trayIcon;
  if (fs.existsSync(icoPath)) {
    trayIcon = nativeImage.createFromPath(icoPath).resize({ width: 16, height: 16 });
  } else if (fs.existsSync(pngPath)) {
    trayIcon = nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
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
  toggleApp: 'CommandOrControl+Alt+V',
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
    // Create the filesystem directory if a path is specified
    if (folderData.path && !fs.existsSync(folderData.path)) {
      fs.mkdirSync(folderData.path, { recursive: true });
    }
    return db.createFolder(folderData);
  });

  ipcMain.handle('move-clip-to-folder', async (_, clipId, folderId) => {
    const result = db.moveClipToFolder(clipId, folderId);
    // If the target folder has a filesystem path, also copy the clip file there
    // so it appears in the file explorer / Windows Explorer
    try {
      const folder = db.getFolder ? db.getFolder(folderId) : null;
      const clip = db.getClip(clipId);
      if (folder && folder.path && clip && clip.filePath && fs.existsSync(clip.filePath)) {
        if (!fs.existsSync(folder.path)) fs.mkdirSync(folder.path, { recursive: true });
        const ext = path.extname(clip.filePath);
        const safeName = (clip.title || clip.id).replace(/[<>:"/\\|?*]/g, '_');
        const destFile = path.join(folder.path, `${safeName}${ext}`);
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(clip.filePath, destFile);
        }
      }
    } catch (e) { console.warn('Could not copy clip to folder path:', e.message); }
    return result;
  });

  ipcMain.handle('pin-folder', async (_, folderId, pinned) => {
    return db.pinFolder(folderId, pinned);
  });

  // Sync all clips in a folder to its filesystem path (so they show in file explorer)
  ipcMain.handle('sync-folder-files', async (_, folderId) => {
    try {
      const folder = db.getFolder(folderId);
      if (!folder || !folder.path) return { synced: 0 };
      if (!fs.existsSync(folder.path)) fs.mkdirSync(folder.path, { recursive: true });
      const clips = db.getClips().filter(c => c.folderId === folderId && c.filePath && fs.existsSync(c.filePath));
      let synced = 0;
      for (const clip of clips) {
        const ext = path.extname(clip.filePath);
        const safeName = (clip.title || clip.id).replace(/[<>:"/\\|?*]/g, '_');
        const destFile = path.join(folder.path, `${safeName}${ext}`);
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(clip.filePath, destFile);
          synced++;
        }
      }
      return { synced };
    } catch (e) { console.warn('sync-folder-files error:', e.message); return { synced: 0 }; }
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
    ensureDirectories();
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

  // Import files from paths (for external drag-and-drop)
  ipcMain.handle('import-files-from-paths', async (_, filePaths) => {
    if (!filePaths || filePaths.length === 0) return [];
    const imported = fileManager.importFiles(filePaths);
    // Notify renderer about new clips
    if (imported && imported.length > 0) {
      for (const clip of imported) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('new-clip', clip);
        }
      }
    }
    return imported;
  });

  ipcMain.handle('export-clip', async (_, clipId, destPath) => {
    return fileManager.exportClip(clipId, destPath);
  });

  ipcMain.handle('save-clip-as', async (_, clipId) => {
    const clip = db.getClip(clipId);
    if (!clip) return null;
    const ext = clip.type === 'image' ? 'png' : 'txt';
    // Build a descriptive default filename from clip type + timestamp
    const d = new Date(clip.createdAt || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const prefix = clip.type === 'image' ? 'Screenshot' : 'Text';
    const defaultName = `${prefix}_${stamp}.${ext}`;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
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

  // Suspend/resume global shortcuts while capturing keybinds in settings
  ipcMain.handle('suspend-shortcuts', async () => {
    globalShortcut.unregisterAll();
    return true;
  });
  ipcMain.handle('resume-shortcuts', async () => {
    registerShortcuts();
    return true;
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

  // Native file drag from explorer panel
  ipcMain.on('explorer-drag-start', (event, filePaths) => {
    const validPaths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(p => fs.existsSync(p));
    if (validPaths.length === 0) return;
    // Use first file for icon
    const first = validPaths[0];
    const ext = path.extname(first).toLowerCase();
    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
    let icon;
    if (imgExts.includes(ext)) {
      try { icon = nativeImage.createFromPath(first).resize({ width: 64, height: 64 }); } catch { icon = nativeImage.createEmpty(); }
    } else {
      icon = nativeImage.createEmpty();
    }
    if (icon.isEmpty()) {
      // Create a small placeholder icon
      icon = nativeImage.createFromBuffer(Buffer.alloc(64 * 64 * 4, 128), { width: 64, height: 64 });
    }
    event.sender.startDrag({
      files: validPaths,
      icon
    });
  });

  // Copy external files into a directory (for file manager drop)
  ipcMain.handle('copy-files-to-dir', async (_, srcPaths, destDir) => {
    const results = [];
    for (const src of srcPaths) {
      try {
        const basename = path.basename(src);
        let dest = path.join(destDir, basename);
        // Avoid overwriting: append number if exists
        if (fs.existsSync(dest)) {
          const ext = path.extname(basename);
          const name = path.basename(basename, ext);
          let i = 1;
          while (fs.existsSync(dest)) {
            dest = path.join(destDir, `${name} (${i})${ext}`);
            i++;
          }
        }
        fs.copyFileSync(src, dest);
        results.push({ src, dest, success: true });
      } catch (e) {
        results.push({ src, dest: null, success: false, error: e.message });
      }
    }
    return results;
  });

  // Move files to a directory (for file manager internal drag)
  ipcMain.handle('move-files-to-dir', async (_, srcPaths, destDir) => {
    const results = [];
    for (const src of srcPaths) {
      try {
        const basename = path.basename(src);
        let dest = path.join(destDir, basename);
        // Avoid overwriting
        if (fs.existsSync(dest) && dest !== src) {
          const ext = path.extname(basename);
          const name = path.basename(basename, ext);
          let i = 1;
          while (fs.existsSync(dest)) {
            dest = path.join(destDir, `${name} (${i})${ext}`);
            i++;
          }
        }
        if (src !== dest) {
          fs.renameSync(src, dest);
        }
        results.push({ src, dest, success: true });
      } catch (e) {
        // If rename fails (cross-device), fallback to copy + recycle bin
        try {
          const basename = path.basename(src);
          let dest = path.join(destDir, basename);
          fs.copyFileSync(src, dest);
          await shell.trashItem(src);
          results.push({ src, dest, success: true });
        } catch (e2) {
          results.push({ src, dest: null, success: false, error: e2.message });
        }
      }
    }
    return results;
  });

  // Delete files (move to Recycle Bin)
  ipcMain.handle('delete-files', async (_, filePaths) => {
    const results = [];
    for (const fp of filePaths) {
      try {
        if (fs.existsSync(fp)) {
          await shell.trashItem(fp);
          results.push({ path: fp, success: true });
        } else {
          results.push({ path: fp, success: false, error: 'File not found' });
        }
      } catch (e) {
        results.push({ path: fp, success: false, error: e.message });
      }
    }
    return results;
  });

  // Rename a file or directory
  ipcMain.handle('rename-file', async (_, oldPath, newName) => {
    try {
      const dir = path.dirname(oldPath);
      const newPath = path.join(dir, newName);
      if (fs.existsSync(newPath)) return { success: false, error: 'A file with that name already exists' };
      fs.renameSync(oldPath, newPath);
      return { success: true, oldPath, newPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Create a new directory in the filesystem
  ipcMain.handle('create-fs-directory', async (_, parentDir, folderName) => {
    try {
      const newPath = path.join(parentDir, folderName);
      if (fs.existsSync(newPath)) return { success: false, error: 'A folder with that name already exists' };
      fs.mkdirSync(newPath, { recursive: true });
      return { success: true, path: newPath };
    } catch (e) {
      return { success: false, error: e.message };
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
    ensureDirectories();
    return CLIPS_DIR;
  });

  // Get quick-access paths (like Windows explorer sidebar)
  ipcMain.handle('get-quick-access-paths', async () => {
    return {
      home: app.getPath('home'),
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      pictures: app.getPath('pictures'),
      appFolder: CLIPS_DIR,
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
    try {
      const clip = db.getClip(clipId);
      if (!clip || !clip.filePath || !fs.existsSync(clip.filePath)) return false;
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const ext = path.extname(clip.filePath);
      const safeName = (clip.title || clip.id).replace(/[<>:"/\\|?*]/g, '_');
      let destFile = path.join(destDir, `${safeName}${ext}`);
      // Avoid overwriting — append (1), (2), etc.
      let i = 1;
      while (fs.existsSync(destFile)) {
        destFile = path.join(destDir, `${safeName} (${i++})${ext}`);
      }
      fs.copyFileSync(clip.filePath, destFile);
      return true;
    } catch (e) {
      console.error('copy-clip-to-path failed:', e.message);
      return false;
    }
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

  // Migrate clips from old location if needed
  migrateClipsDirectory(db);

  // Create default "My Folder" if no folders exist yet (first run)
  const existingFolders = db.getFolders();
  if (existingFolders.length === 0) {
    const myFolderPath = path.join(CLIPS_DIR, 'My Folder');
    if (!fs.existsSync(myFolderPath)) fs.mkdirSync(myFolderPath, { recursive: true });
    db.createFolder({ name: 'My Folder', color: '#2d8a4e', pinned: true, path: myFolderPath });
    console.log('[Init] Created default "My Folder"');
  } else {
    // Ensure filesystem directories exist for pinned folders with paths
    // (Don't recreate directories for unpinned folders — they may have been intentionally deleted)
    for (const f of existingFolders) {
      if (f.pinned && f.path && !fs.existsSync(f.path)) {
        try {
          fs.mkdirSync(f.path, { recursive: true });
        } catch (e) { /* skip if cannot create */ }
      }
    }
  }

  // Initialize file manager
  fileManager = new FileManager(db, CLIPS_DIR);

  // Sync filesystem: register any untracked files in All Clips as DB clips
  syncFilesystemToDB(db, CLIPS_DIR);

  // Initialize share server (lazy-loaded)
  ShareServer = require('./share-server');
  shareServer = new ShareServer(db, CLIPS_DIR);
  await shareServer.start();

  // Initialize AI engine (lazy-loaded)
  AIEngine = require('./ai-engine');
  aiEngine = new AIEngine(db, CLIPS_DIR, DATA_DIR);

  // Initialize Ollama manager (lazy-loaded)
  OllamaManager = require('./ollama-manager');
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
