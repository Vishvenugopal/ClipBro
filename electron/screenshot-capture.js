const { desktopCapturer, screen, BrowserWindow, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

class ScreenshotCapture {
  constructor(mainWindow, db, clipsDir) {
    this.mainWindow = mainWindow;
    this.db = db;
    this.clipsDir = clipsDir;
  }

  async captureFullScreen() {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const scaleFactor = primaryDisplay.scaleFactor;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(width * scaleFactor),
          height: Math.floor(height * scaleFactor)
        }
      });

      if (sources.length === 0) return null;

      const source = sources[0];
      const image = source.thumbnail;

      if (image.isEmpty()) return null;

      const id = uuidv4();
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_');
      const filePath = path.join(this.clipsDir, `Screenshot_${timestamp}.png`);
      if (!fs.existsSync(this.clipsDir)) fs.mkdirSync(this.clipsDir, { recursive: true });
      const pngBuffer = image.toPNG();
      fs.writeFileSync(filePath, pngBuffer);

      const size = image.getSize();
      const clip = this.db.saveClip({
        id,
        type: 'image',
        title: `Screenshot ${new Date().toLocaleString()}`,
        filePath,
        width: size.width,
        height: size.height,
        fileSize: pngBuffer.length,
        source: 'screenshot',
        createdAt: Date.now()
      });

      // Auto-group
      this.db.autoGroupClips();

      // Also save to Windows Screenshots folder if interception is disabled
      this._maybeSaveToWindowsScreenshots(pngBuffer);

      // Notify renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('screenshot-captured', clip);
        this.mainWindow.webContents.send('new-clip', clip);
        this.mainWindow.show();
        this.mainWindow.focus();
      }

      return clip;
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      return null;
    }
  }

  _maybeSaveToWindowsScreenshots(pngBuffer) {
    try {
      const settings = this.db.getSettings();
      if (settings.interceptScreenshots === 'false') {
        const ssDir = path.join(os.homedir(), 'Pictures', 'Screenshots');
        if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ssPath = path.join(ssDir, `Screenshot ${timestamp}.png`);
        fs.writeFileSync(ssPath, pngBuffer);
      }
    } catch (e) {
      console.error('Failed to save to Windows Screenshots:', e);
    }
  }

  async captureWithSelection() {
    try {
      // First capture full screen
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const scaleFactor = primaryDisplay.scaleFactor;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(width * scaleFactor),
          height: Math.floor(height * scaleFactor)
        }
      });

      if (sources.length === 0) return null;

      const source = sources[0];
      const image = source.thumbnail;
      if (image.isEmpty()) return null;

      const imageDataUrl = image.toDataURL();

      // Create selection overlay window
      const selectionWindow = new BrowserWindow({
        fullscreen: true,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload-selection.js')
        }
      });

      const selectionHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              overflow: hidden;
              cursor: crosshair;
              user-select: none;
            }
            #backdrop {
              position: fixed;
              top: 0; left: 0;
              width: 100vw; height: 100vh;
            }
            #overlay {
              position: fixed;
              top: 0; left: 0;
              width: 100vw; height: 100vh;
              background: rgba(0,0,0,0.3);
              z-index: 1;
            }
            #selection {
              position: fixed;
              border: 2px solid #4cd964;
              background: transparent;
              z-index: 2;
              display: none;
              box-shadow: 0 0 0 9999px rgba(0,0,0,0.4);
            }
            #dimensions {
              position: fixed;
              background: rgba(0,0,0,0.7);
              color: #fff;
              padding: 4px 8px;
              border-radius: 4px;
              font-family: monospace;
              font-size: 12px;
              z-index: 3;
              display: none;
            }
            .hint {
              position: fixed;
              top: 20px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(0,0,0,0.7);
              color: white;
              padding: 8px 16px;
              border-radius: 8px;
              font-family: -apple-system, sans-serif;
              font-size: 14px;
              z-index: 10;
            }
          </style>
        </head>
        <body>
          <img id="backdrop" src="${imageDataUrl}" />
          <div id="overlay"></div>
          <div id="selection"></div>
          <div id="dimensions"></div>
          <div class="hint">Click and drag to select area. Press Escape to cancel.</div>
          <script>
            let startX, startY, isSelecting = false;
            const sel = document.getElementById('selection');
            const dims = document.getElementById('dimensions');
            const overlay = document.getElementById('overlay');

            document.addEventListener('mousedown', (e) => {
              startX = e.clientX;
              startY = e.clientY;
              isSelecting = true;
              sel.style.display = 'block';
              dims.style.display = 'block';
              overlay.style.display = 'none';
            });

            document.addEventListener('mousemove', (e) => {
              if (!isSelecting) return;
              const x = Math.min(startX, e.clientX);
              const y = Math.min(startY, e.clientY);
              const w = Math.abs(e.clientX - startX);
              const h = Math.abs(e.clientY - startY);
              sel.style.left = x + 'px';
              sel.style.top = y + 'px';
              sel.style.width = w + 'px';
              sel.style.height = h + 'px';
              dims.style.left = (x + w + 5) + 'px';
              dims.style.top = (y + h + 5) + 'px';
              dims.textContent = w + ' × ' + h;
            });

            document.addEventListener('mouseup', (e) => {
              if (!isSelecting) return;
              isSelecting = false;
              const x = Math.min(startX, e.clientX);
              const y = Math.min(startY, e.clientY);
              const w = Math.abs(e.clientX - startX);
              const h = Math.abs(e.clientY - startY);
              if (w > 5 && h > 5) {
                window.selectionAPI.sendSelection({ x, y, width: w, height: h });
              }
            });

            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                window.selectionAPI.cancel();
              }
            });
          </script>
        </body>
        </html>
      `;

      const tempHtml = path.join(this.clipsDir, '_selection_temp.html');
      fs.writeFileSync(tempHtml, selectionHTML);
      await selectionWindow.loadFile(tempHtml);

      return new Promise((resolve) => {
        const { ipcMain } = require('electron');

        const onSelection = (_, rect) => {
          selectionWindow.close();
          cleanup();

          // Crop the image
          const scaleFactor = primaryDisplay.scaleFactor;
          const cropRect = {
            x: Math.round(rect.x * scaleFactor),
            y: Math.round(rect.y * scaleFactor),
            width: Math.round(rect.width * scaleFactor),
            height: Math.round(rect.height * scaleFactor)
          };

          const cropped = image.crop(cropRect);
          const id = uuidv4();
          const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_');
          const filePath = path.join(this.clipsDir, `Screenshot_${timestamp}.png`);
          const pngBuffer = cropped.toPNG();
          if (!fs.existsSync(this.clipsDir)) fs.mkdirSync(this.clipsDir, { recursive: true });
          fs.writeFileSync(filePath, pngBuffer);

          const croppedSize = cropped.getSize();
          const clip = this.db.saveClip({
            id,
            type: 'image',
            title: `Selection ${new Date().toLocaleString()}`,
            filePath,
            width: croppedSize.width,
            height: croppedSize.height,
            fileSize: pngBuffer.length,
            source: 'screenshot-selection',
            createdAt: Date.now()
          });

          this.db.autoGroupClips();
          this._maybeSaveToWindowsScreenshots(pngBuffer);

          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('screenshot-captured', clip);
            this.mainWindow.webContents.send('new-clip', clip);
            this.mainWindow.show();
            this.mainWindow.focus();
          }

          // Clean up temp file
          try { fs.unlinkSync(tempHtml); } catch {}

          resolve(clip);
        };

        const onCancel = () => {
          selectionWindow.close();
          cleanup();
          try { fs.unlinkSync(tempHtml); } catch {}
          resolve(null);
        };

        const cleanup = () => {
          ipcMain.removeListener('selection-complete', onSelection);
          ipcMain.removeListener('selection-cancel', onCancel);
        };

        ipcMain.once('selection-complete', onSelection);
        ipcMain.once('selection-cancel', onCancel);
      });
    } catch (err) {
      console.error('Selection capture failed:', err);
      return null;
    }
  }
}

module.exports = ScreenshotCapture;
