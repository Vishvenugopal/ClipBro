const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

class ShareServer {
  constructor(db, clipsDir) {
    this.db = db;
    this.clipsDir = clipsDir;
    this.app = express();
    this.server = null;
    this.port = 19847;
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get('/share/:token', (req, res) => {
      const link = this.db.getShareLink(req.params.token);
      if (!link) return res.status(404).send('Link expired');
      const clip = this.db.getClip(link.clipId);
      if (!clip) return res.status(404).send('Not found');
      if (clip.type === 'image' && clip.filePath && fs.existsSync(clip.filePath)) {
        res.sendFile(clip.filePath);
      } else if (clip.content) {
        res.type('text/plain').send(clip.content);
      } else {
        res.status(404).send('Not found');
      }
    });

    this.app.get('/download/:token', (req, res) => {
      const link = this.db.getShareLink(req.params.token);
      if (!link) return res.status(404).send('Expired');
      const clip = this.db.getClip(link.clipId);
      if (!clip || !clip.filePath) return res.status(404).send('Not found');
      res.download(clip.filePath, `clip_${clip.id}${path.extname(clip.filePath)}`);
    });

    this.app.get('/view/:token', (req, res) => {
      const link = this.db.getShareLink(req.params.token);
      if (!link) return res.status(404).send('Expired');
      const clip = this.db.getClip(link.clipId);
      if (!clip) return res.status(404).send('Not found');
      const isImg = clip.type === 'image';
      const mins = Math.max(0, Math.round((link.expiresAt - Date.now()) / 60000));
      const content = isImg
        ? `<img src="/share/${req.params.token}" style="width:100%;border-radius:12px" />`
        : `<pre style="padding:20px;white-space:pre-wrap">${(clip.content||'').replace(/</g,'&lt;')}</pre>`;
      const copyScript = isImg
        ? `async function copyClip(){try{if(navigator.clipboard&&navigator.clipboard.write){const r=await fetch('/share/${req.params.token}');const b=await r.blob();await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);ok()}else{fallbackImg()}}catch(e){fallbackImg()}}function fallbackImg(){var a=document.createElement('a');a.href='/download/${req.params.token}';a.download='clip.png';document.body.appendChild(a);a.click();a.remove();document.getElementById('copyBtn').textContent='Downloaded!';setTimeout(()=>document.getElementById('copyBtn').textContent='Copy to Clipboard',2000)}function ok(){document.getElementById('copyBtn').textContent='Copied!';setTimeout(()=>document.getElementById('copyBtn').textContent='Copy to Clipboard',2000)}`
        : `async function copyClip(){try{if(navigator.clipboard&&navigator.clipboard.writeText){const r=await fetch('/share/${req.params.token}');const t=await r.text();await navigator.clipboard.writeText(t);ok()}else{fallbackText()}}catch(e){fallbackText()}}function fallbackText(){fetch('/share/${req.params.token}').then(r=>r.text()).then(t=>{var ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;left:-9999px';document.body.appendChild(ta);ta.focus();ta.select();try{document.execCommand('copy');ok()}catch(e){alert('Please long-press the text above to copy manually')}ta.remove()}).catch(()=>alert('Copy failed'))}function ok(){document.getElementById('copyBtn').textContent='Copied!';setTimeout(()=>document.getElementById('copyBtn').textContent='Copy to Clipboard',2000)}`;
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shared Clip</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
        .c{max-width:800px;width:100%;background:#1a1a2e;border-radius:16px;padding:32px}.btn{padding:10px 24px;border:none;border-radius:8px;color:#fff;cursor:pointer;text-decoration:none;font-weight:600;display:inline-block}
        .g{background:linear-gradient(135deg,#4cd964,#34c759)}.s{background:#2a2a3e}.b{background:#0a84ff}</style>
        <script>${copyScript}</script></head>
        <body><div class="c"><h2 style="margin-bottom:16px">ClipBro</h2>
        <div style="background:#0d0d1a;border-radius:12px;overflow:hidden;margin-bottom:16px">${content}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;color:#888;font-size:13px;margin-bottom:16px"><span>${clip.title||'Clip'}</span><span>Expires in ${mins}m</span></div>
        <div style="display:flex;gap:12px"><a href="/download/${req.params.token}" class="btn g">Download</a><button id="copyBtn" class="btn b" onclick="copyClip()">Copy to Clipboard</button><a href="/share/${req.params.token}" target="_blank" class="btn s">Open Raw</a></div>
        </div></body></html>`);
    });
  }

  async start() {
    return new Promise((resolve) => {
      try {
        const p = this.db.getSetting('shareServerPort');
        if (p) this.port = parseInt(p) || 19847;
        this.server = this.app.listen(this.port, '0.0.0.0', () => resolve());
        this.server.on('error', () => {
          this.port++;
          this.server = this.app.listen(this.port, '0.0.0.0', () => resolve());
        });
      } catch { resolve(); }
    });
  }

  stop() { if (this.server) this.server.close(); }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return 'localhost';
  }

  async createTemporaryLink(clipId, expiryMinutes = 30) {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;
    this.db.createShareLink(clipId, token, expiresAt);
    return `http://${this.getLocalIP()}:${this.port}/view/${token}`;
  }

  async sendEmail(clipId, email) {
    const url = await this.createTemporaryLink(clipId, 60);
    // Open default mail client with mailto link
    const { shell } = require('electron');
    const subject = encodeURIComponent('Shared Clip - ClipBro');
    const body = encodeURIComponent(`Here's a clip shared with you:\n\n${url}\n\nThis link expires in 60 minutes.`);
    shell.openExternal(`mailto:${email}?subject=${subject}&body=${body}`);
    return { success: true, url };
  }
}

module.exports = ShareServer;
