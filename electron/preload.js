const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ucb', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Clips
  getClips: (filters) => ipcRenderer.invoke('get-clips', filters),
  getClip: (id) => ipcRenderer.invoke('get-clip', id),
  saveClip: (clipData) => ipcRenderer.invoke('save-clip', clipData),
  deleteClip: (id) => ipcRenderer.invoke('delete-clip', id),
  updateClip: (id, updates) => ipcRenderer.invoke('update-clip', id, updates),
  getClipFilePath: (id) => ipcRenderer.invoke('get-clip-file-path', id),

  // Folders
  getFolders: () => ipcRenderer.invoke('get-folders'),
  createFolder: (data) => ipcRenderer.invoke('create-folder', data),
  moveClipToFolder: (clipId, folderId) => ipcRenderer.invoke('move-clip-to-folder', clipId, folderId),
  pinFolder: (folderId, pinned) => ipcRenderer.invoke('pin-folder', folderId, pinned),
  deleteFolder: (folderId) => ipcRenderer.invoke('delete-folder', folderId),

  // Hidden folder
  verifyPasscode: (passcode) => ipcRenderer.invoke('verify-passcode', passcode),
  setPasscode: (passcode, email) => ipcRenderer.invoke('set-passcode', passcode, email),
  getHiddenClips: (passcode) => ipcRenderer.invoke('get-hidden-clips', passcode),
  moveToHidden: (clipId, passcode) => ipcRenderer.invoke('move-to-hidden', clipId, passcode),

  // Screenshot editing
  saveEditedClip: (clipId, imageDataUrl) => ipcRenderer.invoke('save-edited-clip', clipId, imageDataUrl),

  // Sharing
  generateQR: (clipId) => ipcRenderer.invoke('generate-qr', clipId),
  createShareLink: (clipId, expiryMinutes) => ipcRenderer.invoke('create-share-link', clipId, expiryMinutes),
  sendEmail: (clipId, email) => ipcRenderer.invoke('send-email', clipId, email),

  // AI
  aiAnalyzeImage: (clipId, prompt) => ipcRenderer.invoke('ai-analyze-image', clipId, prompt),
  aiSearchWeb: (clipId, useAI) => ipcRenderer.invoke('ai-search-web', clipId, useAI),
  getAISettings: () => ipcRenderer.invoke('get-ai-settings'),
  saveAISettings: (settings) => ipcRenderer.invoke('save-ai-settings', settings),

  // OCR / QR detection
  extractText: (clipId) => ipcRenderer.invoke('extract-text', clipId),
  detectQR: (clipId) => ipcRenderer.invoke('detect-qr', clipId),

  // File operations
  importFile: () => ipcRenderer.invoke('import-file'),
  exportClip: (clipId, destPath) => ipcRenderer.invoke('export-clip', clipId, destPath),
  saveClipAs: (clipId) => ipcRenderer.invoke('save-clip-as', clipId),

  // Clipboard
  copyToClipboard: (clipId) => ipcRenderer.invoke('copy-to-clipboard', clipId),
  pasteFromClipboard: () => ipcRenderer.invoke('paste-from-clipboard'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Open external
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Drag
  startDrag: (clipId) => ipcRenderer.send('drag-start', clipId),

  // Groups
  getGroups: () => ipcRenderer.invoke('get-groups'),
  autoGroupClips: () => ipcRenderer.invoke('auto-group-clips'),

  // Search
  searchClips: (query) => ipcRenderer.invoke('search-clips', query),

  // Highlight search
  highlightSearch: (text) => ipcRenderer.invoke('highlight-search', text),
  highlightSearchImage: (imageDataUrl) => ipcRenderer.invoke('highlight-search-image', imageDataUrl),

  // Events from main process
  onNewClip: (callback) => {
    ipcRenderer.on('new-clip', (_, clip) => callback(clip));
  },
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (_, section) => callback(section));
  },
  onScreenshotCaptured: (callback) => {
    ipcRenderer.on('screenshot-captured', (_, clip) => callback(clip));
  },
  onClipboardUpdate: (callback) => {
    ipcRenderer.on('clipboard-update', (_, clip) => callback(clip));
  },

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
