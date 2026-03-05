// ===== Ollama Manager =====
// Handles detecting, downloading, installing, and starting Ollama for AI features

const { exec, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download/OllamaSetup.exe';

class OllamaManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.ollamaProcess = null;
    this._installerPath = path.join(dataDir, 'OllamaSetup.exe');
  }

  // Check if Ollama is installed by looking for the executable
  async isInstalled() {
    return new Promise((resolve) => {
      exec('where ollama', { timeout: 5000 }, (err, stdout) => {
        if (!err && stdout.trim()) {
          resolve(true);
        } else {
          // Also check common install locations
          const paths = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Ollama', 'ollama.exe'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe')
          ];
          resolve(paths.some(p => fs.existsSync(p)));
        }
      });
    });
  }

  // Check if Ollama server is running and reachable
  async isRunning() {
    return new Promise((resolve) => {
      const req = http.get({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/',
        timeout: 3000,
        family: 4
      }, (res) => {
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // Get full status: installed, running, models available
  async getStatus() {
    const installed = await this.isInstalled();
    const running = installed ? await this.isRunning() : false;
    let models = [];
    if (running) {
      models = await this.listModels();
    }
    return { installed, running, models };
  }

  // List available models from Ollama
  async listModels() {
    return new Promise((resolve) => {
      const req = http.get({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/tags',
        timeout: 5000,
        family: 4
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve((json.models || []).map(m => m.name));
          } catch { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
    });
  }

  // Download Ollama installer with progress callback
  download(onProgress) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this._installerPath);

      const doRequest = (url) => {
        https.get(url, (res) => {
          // Follow redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            file.write(chunk);
            if (onProgress && total > 0) {
              onProgress({ downloaded, total, percent: Math.round((downloaded / total) * 100) });
            }
          });

          res.on('end', () => {
            file.end(() => resolve(this._installerPath));
          });

          res.on('error', (err) => {
            file.end();
            reject(err);
          });
        }).on('error', (err) => {
          file.end();
          reject(err);
        });
      };

      doRequest(OLLAMA_DOWNLOAD_URL);
    });
  }

  // Run the Ollama installer (silent install)
  install() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this._installerPath)) {
        reject(new Error('Installer not found. Download it first.'));
        return;
      }

      // Run installer silently
      execFile(this._installerPath, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { timeout: 120000 }, (err) => {
        // Clean up installer
        try { fs.unlinkSync(this._installerPath); } catch {}

        if (err) {
          // Installer may return non-zero even on success, check if installed
          this.isInstalled().then(installed => {
            if (installed) resolve(true);
            else reject(new Error('Installation failed: ' + err.message));
          });
        } else {
          resolve(true);
        }
      });
    });
  }

  // Start the Ollama server if not already running
  async startServer() {
    const running = await this.isRunning();
    if (running) return true;

    return new Promise((resolve) => {
      // Try to find ollama executable
      const tryPaths = [
        'ollama',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe')
      ];

      const tryStart = (idx) => {
        if (idx >= tryPaths.length) {
          resolve(false);
          return;
        }
        try {
          this.ollamaProcess = spawn(tryPaths[idx], ['serve'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });
          this.ollamaProcess.unref();

          // Wait a bit and check if it's running
          setTimeout(async () => {
            const isUp = await this.isRunning();
            if (isUp) {
              resolve(true);
            } else {
              this.ollamaProcess = null;
              tryStart(idx + 1);
            }
          }, 3000);
        } catch {
          tryStart(idx + 1);
        }
      };

      tryStart(0);
    });
  }

  // Pull a model
  async pullModel(modelName, onProgress) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ name: modelName, stream: true });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/pull',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        family: 4
      }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          // Parse NDJSON lines
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.status === 'success') {
                resolve(true);
                return;
              }
              if (onProgress) onProgress(json);
            } catch {}
          }
        });
        res.on('end', () => resolve(true));
      });
      req.on('error', (e) => reject(e));
      req.write(body);
      req.end();
    });
  }
}

module.exports = OllamaManager;
