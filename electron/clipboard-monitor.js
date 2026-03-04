const { clipboard, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class ClipboardMonitor {
  constructor(db, clipsDir, mainWindow) {
    this.db = db;
    this.clipsDir = clipsDir;
    this.mainWindow = mainWindow;
    this.interval = null;
    this.lastText = '';
    this.lastImageHash = '';
    this.monitoring = true;
    this.showNotification = true; // default on, controlled by settings
  }

  start() {
    // Initialize with current clipboard contents
    this.lastText = clipboard.readText() || '';
    const img = clipboard.readImage();
    if (!img.isEmpty()) {
      this.lastImageHash = this.hashBuffer(img.toPNG());
    }

    this.interval = setInterval(() => {
      if (!this.monitoring) return;
      this.check();
    }, 500);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  forceCheck() {
    this.lastText = '';
    this.lastImageHash = '';
    this.check();
  }

  check() {
    try {
      // Check for image first
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        const pngBuffer = img.toPNG();
        const hash = this.hashBuffer(pngBuffer);
        if (hash !== this.lastImageHash) {
          this.lastImageHash = hash;
          this.handleImageClip(pngBuffer, img.getSize());
          return;
        }
      }

      // Check for text
      const text = clipboard.readText();
      if (text && text !== this.lastText && text.trim().length > 0) {
        this.lastText = text;
        this.handleTextClip(text);
      }
    } catch (err) {
      // Clipboard access can fail temporarily
    }
  }

  hashBuffer(buffer) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  handleImageClip(pngBuffer, size) {
    const id = uuidv4();
    const filePath = path.join(this.clipsDir, `${id}.png`);
    fs.writeFileSync(filePath, pngBuffer);

    const clip = this.db.saveClip({
      id,
      type: 'image',
      title: `Screenshot ${new Date().toLocaleString()}`,
      filePath,
      width: size.width,
      height: size.height,
      fileSize: pngBuffer.length,
      source: 'clipboard',
      createdAt: Date.now()
    });

    this.notifyNewClip(clip);
  }

  handleTextClip(text) {
    const id = uuidv4();
    let type = 'text';
    let title = text.substring(0, 100);

    // Detect URLs
    const urlPattern = /^https?:\/\/[^\s]+$/i;
    if (urlPattern.test(text.trim())) {
      type = 'link';
      title = text.trim();
    }

    // Detect if it looks like code
    const codePatterns = [/function\s/, /const\s/, /let\s/, /var\s/, /import\s/, /class\s/, /def\s/, /public\s/, /<\/?[a-z][\s\S]*>/i];
    if (codePatterns.some(p => p.test(text))) {
      type = 'code';
    }

    // Save text content to file as well
    const filePath = path.join(this.clipsDir, `${id}.txt`);
    fs.writeFileSync(filePath, text, 'utf-8');

    const clip = this.db.saveClip({
      id,
      type,
      title,
      content: text,
      filePath,
      fileSize: Buffer.byteLength(text, 'utf-8'),
      source: 'clipboard',
      createdAt: Date.now()
    });

    this.notifyNewClip(clip);
  }

  notifyNewClip(clip) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('new-clip', clip);
      this.mainWindow.webContents.send('clipboard-update', clip);
    }

    // Windows desktop notification
    if (this.showNotification && Notification.isSupported()) {
      const notif = new Notification({
        title: 'Universal Clipboard',
        body: clip.type === 'image' ? `Image captured (${clip.title})` : `Clip captured: ${(clip.title || '').substring(0, 60)}`,
        silent: true
      });
      notif.show();
    }

    // Auto-group
    try {
      this.db.autoGroupClips();
    } catch (e) {
      // Non-critical
    }
  }
}

module.exports = ClipboardMonitor;
