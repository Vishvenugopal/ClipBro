// ===== ClipBro - Dialogs =====

const Dialogs = {
  show(html) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    // Use onclick to avoid stacking duplicate listeners from repeated show() calls
    overlay.onclick = (e) => {
      if (e.target === overlay) this.close();
    };
  },

  close() {
    document.getElementById('modalOverlay').classList.add('hidden');
  },

  confirm(title, message, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
      this.show(`
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close" onclick="Dialogs.close()">&times;</button>
        </div>
        <p style="color:var(--text-secondary);margin-bottom:16px;white-space:pre-line">${message}</p>
        <div class="btn-row">
          <button class="btn btn-secondary" id="confirmNo">Cancel</button>
          <button class="btn btn-danger" id="confirmYes">${confirmLabel}</button>
        </div>
      `);
      document.getElementById('confirmNo').addEventListener('click', () => { this.close(); resolve(false); });
      document.getElementById('confirmYes').addEventListener('click', () => { this.close(); resolve(true); });
    });
  },

  prompt(title, message, defaultValue = '') {
    return new Promise((resolve) => {
      this.show(`
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close" onclick="Dialogs.close()">&times;</button>
        </div>
        <div class="form-group">
          <label class="form-label">${message}</label>
          <input type="text" class="form-input" id="promptInput" value="${defaultValue}" autofocus />
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="promptCancel">Cancel</button>
          <button class="btn btn-primary" id="promptOk">OK</button>
        </div>
      `);
      const input = document.getElementById('promptInput');
      input.select();
      document.getElementById('promptCancel').addEventListener('click', () => { this.close(); resolve(null); });
      document.getElementById('promptOk').addEventListener('click', () => { const val = input.value.trim(); this.close(); resolve(val || null); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('promptOk').click(); if (e.key === 'Escape') document.getElementById('promptCancel').click(); });
    });
  },

  // ===== New Folder =====
  showNewFolderDialog() {
    const colors = [
      '#2d8a4e','#c0392b','#c47200','#b8960f','#2980b9','#8e44ad','#c0294a',
      '#1a5e32','#8b1a1a','#8a5200','#7a6400','#1a5276','#6c2d82','#8a1a38',
      '#5dbe78','#e74c3c','#e8a317','#d4ac0d','#5dade2','#bb6bd9','#e84573'
    ];
    this.show(`
      <div class="modal-header">
        <h2>New Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" id="newFolderName" placeholder="Folder name" autofocus />
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">Creates a subfolder inside All Clips</div>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;max-width:260px">
          ${colors.map(c => `<button class="color-option" data-color="${c}" style="width:26px;height:26px;border-radius:50%;border:2px solid transparent;background:${c};cursor:pointer" onclick="this.parentElement.querySelectorAll('.color-option').forEach(b=>b.style.borderColor='transparent');this.style.borderColor='#fff';document.getElementById('selectedFolderColor').value='${c}'"></button>`).join('')}
        </div>
        <input type="hidden" id="selectedFolderColor" value="${colors[Math.floor(Math.random() * colors.length)]}" />
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
        <button class="btn btn-primary" id="createFolderBtn">Create</button>
      </div>
    `);

    document.getElementById('createFolderBtn').addEventListener('click', async () => {
      const name = document.getElementById('newFolderName').value.trim();
      if (!name) return;
      const color = document.getElementById('selectedFolderColor').value;
      // Build the path as a subfolder of the All Clips directory
      const basePath = App.explorerHomePath || '';
      const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
      const folderPath = basePath ? (basePath.replace(/[\\/]+$/, '') + '\\' + safeName) : null;
      await ucb.createFolder({ name, color, pinned: true, path: folderPath });
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

  // ===== Edit Folder =====
  showEditFolderDialog(folder) {
    const colors = [
      '#2d8a4e','#c0392b','#c47200','#b8960f','#2980b9','#8e44ad','#c0294a',
      '#1a5e32','#8b1a1a','#8a5200','#7a6400','#1a5276','#6c2d82','#8a1a38',
      '#5dbe78','#e74c3c','#e8a317','#d4ac0d','#5dade2','#bb6bd9','#e84573'
    ];
    this.show(`
      <div class="modal-header">
        <h2>Edit Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" id="editFolderName" value="${folder.name.replace(/"/g, '&quot;')}" autofocus />
      </div>
      <div class="form-group">
        <label class="form-label">Path</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="text" class="form-input" id="editFolderPath" value="${(folder.path || '').replace(/"/g, '&quot;')}" style="flex:1;font-size:11px" />
          <button class="btn btn-secondary" id="browseEditFolderPathBtn" style="font-size:10px;padding:5px 8px">Browse</button>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">Filesystem directory for this folder</div>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;max-width:260px">
          ${colors.map(c => `<button class="color-option" data-color="${c}" style="width:26px;height:26px;border-radius:50%;border:2px solid ${c === (folder.color || '') ? '#fff' : 'transparent'};background:${c};cursor:pointer" onclick="this.parentElement.querySelectorAll('.color-option').forEach(b=>b.style.borderColor='transparent');this.style.borderColor='#fff';document.getElementById('editFolderColor').value='${c}'"></button>`).join('')}
        </div>
        <input type="hidden" id="editFolderColor" value="${folder.color || colors[0]}" />
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
        <button class="btn btn-primary" id="saveEditFolderBtn">Save</button>
      </div>
    `);

    document.getElementById('browseEditFolderPathBtn').addEventListener('click', async () => {
      const d = await ucb.chooseDirectory();
      if (d) document.getElementById('editFolderPath').value = d;
    });

    document.getElementById('saveEditFolderBtn').addEventListener('click', async () => {
      const name = document.getElementById('editFolderName').value.trim();
      if (!name) return;
      const color = document.getElementById('editFolderColor').value;
      const folderPath = document.getElementById('editFolderPath').value.trim();
      await ucb.updateFolder(folder.id, { name, color, path: folderPath || null });
      await App.loadData();
      App.renderPinnedFolders();
      App.renderQuickAccess();
      this.close();
      App.toast('Folder updated', 'success');
    });

    document.getElementById('editFolderName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('saveEditFolderBtn').click();
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
        const folder = folders.find(f => f.id === btn.dataset.folderId);
        this.close();
        // Virtual filesystem clip — move file on disk
        if (clip._isVirtual && clip.filePath && folder && folder.path) {
          await ucb.moveFilesToDir([clip.filePath], folder.path);
          App.renderPinnedFolders();
          await App._refreshActiveFolderTab();
          App.renderClipGrid();
          App.renderLibraryTabs();
          App.refreshExplorer();
          App.toast(`Moved to ${folder.name}`, 'success');
          return;
        }
        const oldFolderId = clip.folderId || null;
        await ucb.moveClipToFolder(clip.id, btn.dataset.folderId);
        App.pushUndo({ type: 'move', clipId: clip.id, oldFolderId, newFolderId: btn.dataset.folderId, folderName: folder ? folder.name : 'folder' });
        await App.loadData();
        App.renderPinnedFolders();
        await App._refreshActiveFolderTab();
        App.renderClipGrid();
        App.renderLeftSidebar();
        App.renderLibraryTabs();
        App.refreshExplorer();
        App.toastWithUndo(`Moved to ${folder ? folder.name : 'folder'}`);
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

  // ===== Hidden Folder Dialog (Windows Hello / device security) =====
  async showPasscodeDialog() {
    // Try Windows Hello / device authentication first
    this.show(`
      <div class="modal-header">
        <h2>Hidden Folder</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:12px">Verifying your identity using Windows Hello or your device PIN...</p>
      <div style="text-align:center;padding:24px"><div class="spinner" style="width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent-green);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto"></div></div>
    `);

    try {
      const result = await ucb.authenticateDevice();
      if (result && result.success) {
        // Authenticated — use a fixed internal passcode for hidden clips
        const clips = await ucb.getHiddenClips('__device_auth__');
        this.close();
        App.clips = clips || [];
        App.activeView = 'hidden';
        document.getElementById('clipGrid').classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        App.renderClipGrid();
        return;
      }
    } catch (e) {
      console.error('Device auth error:', e);
    }

    // Check if a passcode has been set
    const hasPasscode = await ucb.hasPasscode();

    if (!hasPasscode) {
      // No passcode set and Windows Hello unavailable — open hidden folder directly
      const clips = await ucb.getHiddenClips('__device_auth__');
      this.close();
      App.clips = clips || [];
      App.activeView = 'hidden';
      document.getElementById('clipGrid').classList.remove('hidden');
      document.getElementById('emptyState').classList.add('hidden');
      App.renderClipGrid();
      return;
    }

    // Fallback to passcode if Windows Hello is unavailable
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
  async showAIDialog(clip) {
    if (!clip) { App.toast('Select a clip first', 'info'); return; }

    // Check if AI is configured
    const aiSettings = await ucb.getAISettings();
    if (!aiSettings || aiSettings.provider === 'none' || !aiSettings.provider) {
      this.show(`
        <div class="modal-header"><h2>AI Not Set Up</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">AI features are not configured yet. You can set up an AI provider (Ollama, OpenAI, or a custom endpoint) in Settings.</p>
        <div class="btn-row">
          <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
          <button class="btn btn-primary" id="goToAISettingsBtn">Open Settings</button>
        </div>
      `);
      document.getElementById('goToAISettingsBtn').addEventListener('click', () => {
        Dialogs.close();
        App.toggleSettings();
      });
      return;
    }

    // For Ollama, check if it's actually running
    if (aiSettings.provider === 'ollama') {
      try {
        const status = await ucb.ollamaStatus();
        if (!status.installed) {
          this.show(`
            <div class="modal-header"><h2>Ollama Not Installed</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
            <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">Ollama is selected as your AI provider but it is not installed. You can download and install it from Settings.</p>
            <div class="btn-row">
              <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
              <button class="btn btn-primary" id="goToAISettingsBtn">Open Settings</button>
            </div>
          `);
          document.getElementById('goToAISettingsBtn').addEventListener('click', () => {
            Dialogs.close();
            App.toggleSettings();
          });
          return;
        }
        if (!status.running) {
          this.show(`
            <div class="modal-header"><h2>Ollama Not Running</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
            <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">Ollama is installed but the server is not running. You can start it from Settings.</p>
            <div class="btn-row">
              <button class="btn btn-secondary" onclick="Dialogs.close()">Cancel</button>
              <button class="btn btn-primary" id="goToAISettingsBtn">Open Settings</button>
            </div>
          `);
          document.getElementById('goToAISettingsBtn').addEventListener('click', () => {
            Dialogs.close();
            App.toggleSettings();
          });
          return;
        }
      } catch (e) { /* proceed anyway */ }
    }

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
        <button class="btn btn-primary" id="aiAnalyzeBtn">Ask AI</button>
      </div>
      <div id="aiResultArea"></div>
    `);

    document.getElementById('aiAnalyzeBtn').addEventListener('click', async () => {
      const prompt = document.getElementById('aiPrompt').value.trim();
      if (!prompt) return;

      document.getElementById('aiResultArea').innerHTML = '<div class="ai-loading"><div class="spinner"></div> Thinking...</div>';

      const result = isImage
        ? await ucb.aiAnalyzeImage(clip.id, prompt)
        : await ucb.aiAnalyzeText(clip.id, prompt);

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
      this.close();
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
  },

  showTutorial() {
    const kbd = (text) => `<kbd style="background:var(--bg-tertiary);border:1px solid var(--border);padding:2px 6px;border-radius:var(--radius-sm);font-family:inherit;font-size:10px;font-weight:600;color:var(--text-primary)">${text}</kbd>`;
    const section = (icon, title, body) => `
      <div style="display:flex;gap:10px;padding:8px 10px">
        <div style="flex-shrink:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center">${icon}</div>
        <div style="min-width:0">
          <div style="font-size:11px;font-weight:600;color:var(--text-primary);margin-bottom:2px">${title}</div>
          <div style="font-size:10px;color:var(--text-secondary);line-height:1.5">${body}</div>
        </div>
      </div>`;

    this.show(`
      <div class="modal-header">
        <h2 style="font-size:15px;display:flex;align-items:center;gap:8px"><img src="assets/clipbro-icons/Green Guy.png" width="22" height="22" style="border-radius:5px;object-fit:contain">Welcome to ClipBro!</h2>
        <button class="modal-close" onclick="Dialogs.close()">&times;</button>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin:-8px 0 10px 0">A screenshot and clipboard manager.</p>
      <div style="display:flex;flex-direction:column;gap:4px;padding-right:4px">

        ${section(
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
          'Screenshot Management',
          'Take screenshots the way you normally would. This app intercepts the ' + kbd('PrintScreen') + ' key and captures your screen directly. Screenshots are <strong>not</strong> saved to your Windows Screenshots folder. Instead, they are stored inside the app where you can edit, organize, and share them. You can also capture a selected region with ' + kbd('Ctrl+Shift+S') + '. You can change this behavior in Settings.'
        )}

        ${section(
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg>',
          'Built-in Editor',
          'Screenshots open in the editor automatically. Double-click any image to edit it later. Crop, draw, highlight, add arrows, text, blur sensitive areas, and more.'
        )}

        ${section(
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
          'Clipboard History',
          'Everything you copy (text, images, links, code) is saved automatically. Browse your full history in the center grid or the recent clips sidebar.'
        )}

        ${section(
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
          'Organize',
          'Pin folders to the top bar, drag clips to sort them, filter by date or type from the sidebar, and star your favorites.'
        )}

        ${section(
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
          'Sharing',
          'Right-click a clip and choose "Share" to create a QR code or temporary link for other devices on your network.'
        )}

        <div style="background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.25);border-radius:var(--radius-md);padding:8px 10px">
          <div style="font-size:10px;font-weight:600;color:var(--accent-orange);margin-bottom:2px">Security Note</div>
          <div style="font-size:10px;color:var(--text-secondary);line-height:1.4">
            Share links use your local IP address and are visible to <strong>anyone on the same Wi-Fi network</strong>.
            Links expire after the time you set, but avoid sharing sensitive content on public networks.
          </div>
        </div>

        <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 10px">
          <div style="font-size:10px;font-weight:600;color:var(--text-primary);margin-bottom:6px">Keyboard Shortcuts</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;font-size:10px;color:var(--text-secondary)">
            <span>${kbd('PrintScreen')} Screenshot</span>
            <span>${kbd('Ctrl+Shift+S')} Select region</span>
            <span>${kbd('Ctrl+Alt+V')} Show / hide app</span>
            <span>${kbd('Ctrl+S')} Save edits</span>
            <span>${kbd('Ctrl+Z')} Undo</span>
            <span>${kbd('Ctrl+Shift+Z')} Redo</span>
            <span>${kbd('Delete')} Delete clip</span>
            <span>${kbd('Escape')} Close editor</span>
          </div>
        </div>

      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-secondary" onclick="Dialogs.close()" style="font-size:12px;padding:6px 20px;border-color:rgba(52,199,89,0.3);color:var(--accent-green);background:rgba(52,199,89,0.12)">Get Started</button>
      </div>
    `);
  }
};
