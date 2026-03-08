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
        ? `<img src="/share/${req.params.token}" style="width:100%;border-radius:10px;display:block" />`
        : `<pre style="padding:16px;white-space:pre-wrap;word-break:break-word;margin:0;font-size:13px;line-height:1.6;color:#e8e8e8;font-family:monospace">${(clip.content||'').replace(/</g,'&lt;')}</pre>`;

      const shareUrl = `http://${this.getLocalIP()}:${this.port}/share/${req.params.token}`;
      const downloadUrl = `/download/${req.params.token}`;

      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>ClipBro - Shared Clip</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d0d;color:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px}
.wrap{max-width:560px;width:100%}
.card{background:#161616;border:1px solid #343434;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.5)}
.card-header{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #343434;background:#1e1e1e}
.logo{width:24px;height:24px;background:#27773A;border-radius:6px;display:flex;align-items:center;justify-content:center}
.logo svg{width:14px;height:14px}
.brand{font-size:14px;font-weight:600;color:#e8e8e8;letter-spacing:0.3px}
.expiry{margin-left:auto;font-size:11px;color:#6b6b6b;background:#1e1e1e;border:1px solid #343434;border-radius:12px;padding:3px 10px}
.content{background:#0d0d0d;margin:12px;border-radius:10px;overflow:hidden;border:1px solid #282828}
.meta{display:flex;align-items:center;justify-content:space-between;padding:8px 18px;font-size:11px;color:#6b6b6b}
.actions{display:flex;gap:8px;padding:4px 14px 14px;flex-wrap:wrap}
.btn{flex:1;min-width:120px;padding:10px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s;font-family:inherit}
.btn-green{background:linear-gradient(135deg,#34c759,#2d8a4e);color:#fff}
.btn-green:hover{filter:brightness(1.1)}
.btn-blue{background:rgba(10,132,255,0.15);color:#5ac8fa;border:1px solid rgba(10,132,255,0.3)}
.btn-blue:hover{background:rgba(10,132,255,0.25)}
.btn svg{flex-shrink:0}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#34c759;border:1px solid rgba(52,199,89,0.25);padding:10px 20px;border-radius:12px;font-size:13px;font-weight:500;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:10;box-shadow:0 4px 20px rgba(0,0,0,0.4)}
.toast.show{opacity:1}
.footer{text-align:center;padding:12px;font-size:10px;color:#6b6b6b40}
</style>
<script>
function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2500)}
async function copyClip(){
  ${isImg ? `
  try{
    if(navigator.clipboard&&navigator.clipboard.write){
      var r=await fetch('${shareUrl}');var b=await r.blob();
      await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);
      showToast('Copied to clipboard!');return;
    }
  }catch(e){}
  var a=document.createElement('a');a.href='${downloadUrl}';a.download='clip.png';document.body.appendChild(a);a.click();a.remove();
  showToast('Image saved!');
  ` : `
  var text='';
  try{var r=await fetch('${shareUrl}');text=await r.text()}catch(e){showToast('Failed to load');return}
  // Try modern clipboard API first (works on some HTTP mobile browsers with user gesture)
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);showToast('Copied to clipboard!');return;
    }
  }catch(e){}
  // Fallback: hidden textarea + execCommand
  try{
    var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01';
    document.body.appendChild(ta);
    ta.focus();ta.setSelectionRange(0,ta.value.length);
    var ok=document.execCommand('copy');
    ta.remove();
    if(ok){showToast('Copied to clipboard!');return}
  }catch(e){}
  // Last resort: select the visible text
  try{
    var pre=document.querySelector('.content pre');
    if(pre){var range=document.createRange();range.selectNodeContents(pre);var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
    var ok2=document.execCommand('copy');if(ok2){showToast('Copied to clipboard!');return}}
  }catch(e){}
  showToast('Long-press the text to copy');
  `}
}
</script></head>
<body><div class="wrap">
<div class="card">
  <div class="card-header">
    <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/></svg></div>
    <span class="brand">ClipBro</span>
    <span class="expiry">${mins > 0 ? mins + 'm remaining' : 'Expiring soon'}</span>
  </div>
  ${isImg ? '' : `<div class="meta"><span>${clip.title||'Shared Clip'}</span><span>Text</span></div>
  <div class="actions">
    <button class="btn btn-green" onclick="copyClip()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>
    <a href="${downloadUrl}" class="btn btn-blue"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download</a>
  </div>`}
  <div class="content">${content}</div>
  ${isImg ? `<div class="meta"><span>${clip.title||'Shared Clip'}</span><span>Image</span></div>
  <div class="actions">
    <button class="btn btn-green" onclick="copyClip()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>
    <a href="${downloadUrl}" class="btn btn-blue"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download</a>
  </div>` : ''}
</div>
<div class="footer">Shared via ClipBro</div>
</div>
<div class="toast" id="toast"></div>
</body></html>`);
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
