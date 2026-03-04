// ===== Universal Clipboard - Dialogs =====

const Dialogs = {
  show(html) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
  },

  close() {
    document.getElementById('modalOverlay').classList.add('hidden');
  },

  confirm(title, message) {
    return new Promise((resolve) => {
      this.show(`
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close" onclick="Dialogs.close()">&times;</button>
        </div>
        <p style="color:var(--text-secondary);margin-bottom:16px">${message}</p>
        <div class="btn-row">
          <button class="btn btn-secondary" id="confirmNo">Cancel</button>
          <button class="btn btn-danger" id="confirmYes">Delete</button>
        </div>
      `);
      document.getElementById('confirmNo').addEventListener('click', () => { this.close(); resolve(false); });
      document.getElementById('confirmYes').addEventListener('click', () => { this.close(); resolve(true); });
    });
  },

  // ===== New Folder =====
  showNewFolderDialog() {
    const colors = ['#4cd964','#ff3b30','#ff9500','#ffcc00','#5ac8fa','#af52de','#ff2d55'];
    const defaultPath = App.explorerHomePath || '';
    this.show(`
      <div class="modal-header">
        <h2>New Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" id="newFolderName" placeholder="Folder name" autofocus />
      </div>
      <div class="form-group">
        <label class="form-label">Path</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="text" class="form-input" id="newFolderPath" value="${defaultPath}" style="flex:1;font-size:11px" />
          <button class="btn btn-secondary" id="browseFolderPathBtn" style="font-size:10px;padding:5px 8px">Browse</button>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">Filesystem directory for this folder</div>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <div style="display:flex;gap:8px;margin-top:4px">
          ${colors.map((c, i) => `<button class="color-option" data-color="${c}" style="width:28px;height:28px;border-radius:50%;border:2px solid ${i === 0 ? '#fff' : 'transparent'};background:${c};cursor:pointer" onclick="this.parentElement.querySelectorAll('.color-option').forEach(b=>b.style.borderColor='transparent');this.style.borderColor='#fff';document.getElementById('selectedFolderColor').value='${c}'"></button>`).join('')}
        </div>
        <input type="hidden" id="selectedFolderColor" value="#4cd964" />
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-secondary)">
          <input type="checkbox" id="newFolderPinned" checked /> Pin to top bar
        </label>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
        <button class="btn btn-primary" id="createFolderBtn">Create</button>
      </div>
    `);

    document.getElementById('browseFolderPathBtn').addEventListener('click', async () => {
      const d = await ucb.chooseDirectory();
      if (d) document.getElementById('newFolderPath').value = d;
    });

    document.getElementById('createFolderBtn').addEventListener('click', async () => {
      const name = document.getElementById('newFolderName').value.trim();
      if (!name) return;
      const color = document.getElementById('selectedFolderColor').value;
      const pinned = document.getElementById('newFolderPinned').checked;
      const folderPath = document.getElementById('newFolderPath').value.trim();
      await ucb.createFolder({ name, color, pinned, path: folderPath || null });
      App.folders = await ucb.getFolders();
      App.renderPinnedFolders();
      App.renderQuickAccess();
      this.close();
      App.toast('Folder created', 'success');
    });

    document.getElementById('newFolderName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('createFolderBtn').click();
    });
  },

  // ===== Move to Folder =====
  showMoveFolderDialog(clip, folders) {
    const folderItems = folders.map(f =>
      `<button class="share-option" data-folder-id="${f.id}">
        <div class="share-option-icon" style="background:${f.color}20;color:${f.color}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <div class="share-option-text"><h3>${f.name}</h3></div>
      </button>`
    ).join('');

    this.show(`
      <div class="modal-header">
        <h2>Move to Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="share-options">${folderItems}</div>
    `);

    document.querySelectorAll('[data-folder-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await ucb.moveClipToFolder(clip.id, btn.dataset.folderId);
        this.close();
        App.toast('Moved to folder', 'success');
      });
    });
  },

  // ===== Move to Hidden =====
  showMoveToHiddenDialog(clip) {
    this.show(`
      <div class="modal-header">
        <h2>Move to Hidden Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:12px">Enter your passcode to move this clip to the hidden folder.</p>
      <div class="form-group">
        <input type="password" class="form-input" id="hiddenPasscode" placeholder="Enter passcode" maxlength="6" autofocus />
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
        <button class="btn btn-primary" id="moveHiddenBtn">Move</button>
      </div>
    `);

    document.getElementById('moveHiddenBtn').addEventListener('click', async () => {
      const passcode = document.getElementById('hiddenPasscode').value;
      const result = await ucb.moveToHidden(clip.id, passcode);
      if (result) {
        App.clips = App.clips.filter(c => c.id !== clip.id);
        App.closeTab(clip.id);
        App.renderClipGrid();
        this.close();
        App.toast('Moved to hidden folder', 'success');
      } else {
        App.toast('Invalid passcode', 'error');
      }
    });
  },

  // ===== Passcode Dialog =====
  showPasscodeDialog() {
    this.show(`
      <div class="modal-header">
        <h2>Hidden Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:12px">Enter your passcode to access hidden clips.</p>
      <div class="form-group">
        <input type="password" class="form-input" id="accessPasscode" placeholder="Enter passcode" maxlength="6" autofocus />
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
        <button class="btn btn-primary" id="accessHiddenBtn">Unlock</button>
      </div>
      <p style="margin-top:12px;text-align:center"><a href="#" id="setupPasscodeLink" style="color:var(--accent-blue);font-size:11px;text-decoration:none">Set up passcode</a></p>
    `);

    document.getElementById('accessHiddenBtn').addEventListener('click', async () => {
      const code = document.getElementById('accessPasscode').value;
      const valid = await ucb.verifyPasscode(code);
      if (valid) {
        const clips = await ucb.getHiddenClips(code);
        this.close();
        App.clips = clips || [];
        App.activeView = 'hidden';
        document.getElementById('clipGrid').classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        App.renderClipGrid();
      } else {
        App.toast('Invalid passcode', 'error');
      }
    });

    document.getElementById('setupPasscodeLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.showSetPasscodeDialog();
    });

    document.getElementById('accessPasscode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('accessHiddenBtn').click();
    });
  },

  showSetPasscodeDialog() {
    this.show(`
      <div class="modal-header">
        <h2>Set Passcode</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">New Passcode (4-6 digits)</label>
        <input type="password" class="form-input" id="newPasscode" placeholder="Enter new passcode" maxlength="6" autofocus />
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Passcode</label>
        <input type="password" class="form-input" id="confirmPasscode" placeholder="Confirm passcode" maxlength="6" />
      </div>
      <div class="form-group">
        <label class="form-label">Recovery Email (optional)</label>
        <input type="email" class="form-input" id="recoveryEmail" placeholder="your@email.com" />
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
        <button class="btn btn-primary" id="setPasscodeBtn">Set Passcode</button>
      </div>
    `);

    document.getElementById('setPasscodeBtn').addEventListener('click', async () => {
      const pass = document.getElementById('newPasscode').value;
      const confirm = document.getElementById('confirmPasscode').value;
      const email = document.getElementById('recoveryEmail').value;

      if (pass.length < 4) { App.toast('Passcode must be at least 4 characters', 'error'); return; }
      if (pass !== confirm) { App.toast('Passcodes do not match', 'error'); return; }

      await ucb.setPasscode(pass, email);
      this.close();
      App.toast('Passcode set successfully', 'success');
    });
  },

  // ===== Share Dialog =====
  showShareDialog(clip) {
    if (!clip) { App.toast('Select a clip first', 'info'); return; }

    this.show(`
      <div class="modal-header">
        <h2>Share Clip</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="share-options">
        <button class="share-option" id="shareQR">
          <div class="share-option-icon green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4"/><line x1="22" y1="18" x2="22" y2="22"/><line x1="18" y1="22" x2="22" y2="22"/></svg>
          </div>
          <div class="share-option-text">
            <h3>QR Code</h3>
            <p>Generate a temporary QR code for quick sharing</p>
          </div>
        </button>
        <button class="share-option" id="shareLink">
          <div class="share-option-icon blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          </div>
          <div class="share-option-text">
            <h3>Temporary Link</h3>
            <p>Create a link that expires after 30 minutes</p>
          </div>
        </button>
        <button class="share-option" id="shareEmail">
          <div class="share-option-icon orange">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <div class="share-option-text">
            <h3>Email</h3>
            <p>Send clip via email</p>
          </div>
        </button>
      </div>
    `);

    document.getElementById('shareQR').addEventListener('click', async () => {
      await this.showQRCode(clip);
    });

    document.getElementById('shareLink').addEventListener('click', async () => {
      const url = await ucb.createShareLink(clip.id, 30);
      this.show(`
        <div class="modal-header">
          <h2>Share Link</h2>
          <button class="modal-close" onclick="Dialogs.close()">&times;</button>
        </div>
        <p style="color:var(--text-secondary);font-size:12px;margin-bottom:12px">Link expires in 30 minutes. Share this with anyone on your local network.</p>
        <div class="form-group">
          <input type="text" class="form-input" id="shareLinkUrl" value="${url}" readonly style="font-size:12px" />
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" onclick="Dialogs.close()">Close</button>
          <button class="btn btn-primary" id="copyLinkBtn">Copy Link</button>
        </div>
      `);
      document.getElementById('copyLinkBtn').addEventListener('click', () => {
        document.getElementById('shareLinkUrl').select();
        document.execCommand('copy');
        App.toast('Link copied!', 'success');
      });
    });

    document.getElementById('shareEmail').addEventListener('click', () => {
      this.show(`
        <div class="modal-header">
          <h2>Email Clip</h2>
          <button class="modal-close" onclick="Dialogs.close()">&times;</button>
        </div>
        <div class="form-group">
          <label class="form-label">Recipient Email</label>
          <input type="email" class="form-input" id="emailRecipient" placeholder="someone@example.com" autofocus />
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
          <button class="btn btn-primary" id="sendEmailBtn">Send</button>
        </div>
      `);
      document.getElementById('sendEmailBtn').addEventListener('click', async () => {
        const email = document.getElementById('emailRecipient').value.trim();
        if (!email) return;
        await ucb.sendEmail(clip.id, email);
        this.close();
        App.toast('Opening email client...', 'info');
      });
    });
  },

  async showQRCode(clip) {
    this.show(`
      <div class="modal-header">
        <h2>QR Code</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="qr-display">
        <div class="ai-loading"><div class="spinner"></div> Generating QR code...</div>
      </div>
    `);

    try {
      const result = await ucb.generateQR(clip.id);
      this.show(`
        <div class="modal-header">
          <h2>QR Code</h2>
          <button class="modal-close" onclick="Dialogs.close()">&times;</button>
        </div>
        <div class="qr-display">
          <img src="${result.qrDataUrl}" alt="QR Code" />
          <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Scan with your phone to access</p>
          <div class="share-url" onclick="navigator.clipboard.writeText('${result.url}');App.toast('URL copied','success')">${result.url}</div>
          <p style="font-size:10px;color:var(--text-muted);margin-top:8px">Expires in 30 minutes</p>
        </div>
        <div class="btn-row" style="justify-content:center">
          <button class="btn btn-secondary" onclick="Dialogs.close()">Close</button>
        </div>
      `);
    } catch (err) {
      App.toast('Failed to generate QR code', 'error');
      this.close();
    }
  },

  // ===== AI Dialog =====
  showAIDialog(clip) {
    if (!clip) { App.toast('Select a clip first', 'info'); return; }

    const isImage = clip.type === 'image';
    const defaultPrompt = isImage ? 'Describe this image in detail.' : 'Summarize this text.';
    const previewHtml = isImage && clip.filePath
      ? `<div style="margin-bottom:12px;text-align:center"><img src="file://${clip.filePath.replace(/\\/g, '/')}" style="max-height:120px;border-radius:8px;opacity:0.8" /></div>`
      : clip.content ? `<div style="margin-bottom:12px;padding:8px;background:var(--bg-tertiary);border-radius:8px;font-size:11px;color:var(--text-secondary);max-height:80px;overflow:hidden;white-space:pre-wrap">${clip.content.substring(0, 300)}</div>` : '';

    const quickBtns = isImage
      ? `<button class="btn btn-secondary" onclick="document.getElementById('aiPrompt').value='What text is in this image?'">Extract Text</button>
         <button class="btn btn-secondary" onclick="document.getElementById('aiPrompt').value='What objects or people are in this image?'">Identify Objects</button>`
      : `<button class="btn btn-secondary" onclick="document.getElementById('aiPrompt').value='Summarize this text.'">Summarize</button>
         <button class="btn btn-secondary" onclick="document.getElementById('aiPrompt').value='Fix grammar and spelling.'">Fix Grammar</button>
         <button class="btn btn-secondary" onclick="document.getElementById('aiPrompt').value='Translate this to English.'">Translate</button>`;

    this.show(`
      <div class="modal-header">
        <h2>Ask AI</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      ${previewHtml}
      <div class="form-group">
        <label class="form-label">Question / Prompt</label>
        <textarea class="form-textarea" id="aiPrompt" placeholder="Ask anything about this ${isImage ? 'image' : 'text'}..." rows="3">${defaultPrompt}</textarea>
      </div>
      <div class="btn-row" style="margin-bottom:12px">
        ${quickBtns}
        <button class="btn btn-primary" id="aiAnalyzeBtn">Analyze</button>
      </div>
      <div id="aiResultArea"></div>
    `);

    document.getElementById('aiAnalyzeBtn').addEventListener('click', async () => {
      const prompt = document.getElementById('aiPrompt').value.trim();
      if (!prompt) return;

      document.getElementById('aiResultArea').innerHTML = '<div class="ai-loading"><div class="spinner"></div> Analyzing...</div>';

      const result = isImage
        ? await ucb.aiAnalyzeImage(clip.id, prompt)
        : await ucb.aiAnalyzeImage(clip.id, prompt);

      if (result.error) {
        document.getElementById('aiResultArea').innerHTML = `<div class="ai-response" style="border-color:var(--accent-red)">${result.error}</div>`;
      } else {
        document.getElementById('aiResultArea').innerHTML = `<div class="ai-response">${result.result.replace(/\n/g, '<br>')}</div>`;
      }
    });
  },

  // ===== Text Result =====
  showTextResult(title, text) {
    this.show(`
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="ai-response" style="margin-bottom:16px;user-select:text;cursor:text;-webkit-user-select:text" id="textResultContent">${text.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>
      <p style="font-size:10px;color:var(--text-muted);margin-bottom:12px">Select text above to copy a portion, or use the button to copy all.</p>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Close</button>
        <button class="btn btn-secondary" id="copySelectionBtn">Copy Selection</button>
        <button class="btn btn-primary" id="copyTextResultBtn">Copy All</button>
      </div>
    `);

    document.getElementById('copyTextResultBtn').addEventListener('click', () => {
      App._ignoreClipboard = true;
      navigator.clipboard.writeText(text);
      App.toast('Text copied to clipboard', 'success');
      setTimeout(() => { App._ignoreClipboard = false; }, 2000);
    });

    document.getElementById('copySelectionBtn').addEventListener('click', () => {
      const selection = window.getSelection().toString();
      if (!selection) { App.toast('Select some text first', 'info'); return; }
      App._ignoreClipboard = true;
      navigator.clipboard.writeText(selection);
      App.toast('Selection copied', 'success');
      setTimeout(() => { App._ignoreClipboard = false; }, 2000);
    });
  }
};
