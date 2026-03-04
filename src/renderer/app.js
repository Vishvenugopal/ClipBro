// ===== Universal Clipboard - Main Renderer =====

const App = {
  clips: [],
  folders: [],
  groups: [],
  activeClip: null,
  activeView: 'all',
  openTabs: [],
  activeTabId: null,
  contextMenu: null,

  async init() {
    await this.loadData();
    this.bindEvents();
    this.bindIPC();
    this.renderSidebar();
    this.renderClipGrid();
    this.updateBadges();
  },

  // ===== Data Loading =====
  async loadData() {
    try {
      this.clips = await ucb.getClips() || [];
      this.folders = await ucb.getFolders() || [];
      this.groups = await ucb.getGroups() || [];
    } catch (e) {
      console.error('Failed to load data:', e);
    }
  },

  // ===== Event Binding =====
  bindEvents() {
    // Search
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.handleSearch(e.target.value), 300);
    });

    // Sidebar items
    document.querySelectorAll('.sidebar-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });

    // Add folder
    document.getElementById('addFolderBtn').addEventListener('click', () => Dialogs.showNewFolderDialog());

    // Hidden folder
    document.getElementById('hiddenFolderBtn').addEventListener('click', () => Dialogs.showPasscodeDialog());

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => this.switchView('settings'));

    // Tab bar actions
    document.getElementById('importBtn').addEventListener('click', () => ucb.pasteFromClipboard());
    document.getElementById('importFileBtn').addEventListener('click', () => this.importFiles());
    document.getElementById('screenshotBtn').addEventListener('click', () => this.takeScreenshot());

    // Action bar
    document.getElementById('copyBtn').addEventListener('click', () => this.copyActiveClip());
    document.getElementById('saveAsBtn').addEventListener('click', () => this.saveActiveClipAs());
    document.getElementById('deleteBtn').addEventListener('click', () => this.deleteActiveClip());
    document.getElementById('favBtn').addEventListener('click', () => this.toggleFavorite());
    document.getElementById('shareBtn').addEventListener('click', () => Dialogs.showShareDialog(this.activeClip));
    document.getElementById('aiBtn').addEventListener('click', () => Dialogs.showAIDialog(this.activeClip));
    document.getElementById('ocrBtn').addEventListener('click', () => this.extractText());
    document.getElementById('searchWebBtn').addEventListener('click', () => this.searchWeb());
    document.getElementById('highlightSearchBtn').addEventListener('click', () => this.toggleHighlightSearch());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // Drag and drop
    document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('Files')) {
        document.getElementById('dropZone').classList.remove('hidden');
      }
    });
    document.getElementById('dropZone').addEventListener('dragleave', (e) => {
      if (e.target === document.getElementById('dropZone') || e.target === document.querySelector('.drop-zone-inner')) {
        document.getElementById('dropZone').classList.add('hidden');
      }
    });
    document.getElementById('dropZone').addEventListener('drop', (e) => {
      e.preventDefault();
      document.getElementById('dropZone').classList.add('hidden');
      if (e.dataTransfer.files.length > 0) {
        // Files dropped - handled by main process via file paths
        this.toast('Files dropped - importing...', 'info');
        ucb.pasteFromClipboard();
      }
    });

    // Context menu dismiss
    document.addEventListener('click', () => this.dismissContextMenu());

    // Paste handler
    document.addEventListener('paste', (e) => {
      e.preventDefault();
      ucb.pasteFromClipboard();
    });
  },

  bindIPC() {
    ucb.onNewClip((clip) => {
      this.clips.unshift(clip);
      this.renderClipGrid();
      this.updateBadges();
      this.openClipTab(clip);
      this.toast('New clip captured', 'success');
    });

    ucb.onScreenshotCaptured((clip) => {
      if (!this.clips.find(c => c.id === clip.id)) {
        this.clips.unshift(clip);
      }
      this.renderClipGrid();
      this.openClipTab(clip);
    });

    ucb.onNavigate((section) => {
      this.switchView(section);
    });
  },

  // ===== Views =====
  switchView(view) {
    this.activeView = view;

    // Update sidebar
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    const activeBtn = document.querySelector(`.sidebar-item[data-view="${view}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Show appropriate content
    const clipGrid = document.getElementById('clipGrid');
    const clipDetail = document.getElementById('clipDetail');
    const emptyState = document.getElementById('emptyState');
    const settingsView = document.getElementById('settingsView');

    clipGrid.classList.add('hidden');
    clipDetail.classList.add('hidden');
    emptyState.classList.add('hidden');
    settingsView.classList.add('hidden');

    if (view === 'settings') {
      settingsView.classList.remove('hidden');
      this.renderSettings();
      return;
    }

    this.loadViewClips(view).then(clips => {
      this.clips = clips;
      if (clips.length === 0) {
        emptyState.classList.remove('hidden');
      } else {
        clipGrid.classList.remove('hidden');
        this.renderClipGrid();
      }
    });
  },

  async loadViewClips(view) {
    try {
      if (view === 'all') return await ucb.getClips() || [];
      if (view === 'favorites') return await ucb.getClips({ favorite: true }) || [];
      if (view === 'recent') return await ucb.getClips({ limit: 50 }) || [];
      if (view.startsWith('folder:')) return await ucb.getClips({ folderId: view.split(':')[1] }) || [];
      if (view.startsWith('group:')) return await ucb.getClips({ groupId: view.split(':')[1] }) || [];
      return await ucb.getClips() || [];
    } catch { return []; }
  },

  // ===== Rendering =====
  renderSidebar() {
    this.renderFolders();
    this.renderGroups();
  },

  renderFolders() {
    const container = document.getElementById('foldersList');
    container.innerHTML = '';
    this.folders.forEach(folder => {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.dataset.view = `folder:${folder.id}`;
      btn.innerHTML = `
        <span class="folder-color-dot" style="background:${folder.color}"></span>
        <span>${folder.name}</span>
        ${folder.pinned ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="margin-left:auto;opacity:0.3"><circle cx="12" cy="12" r="4"/></svg>' : ''}
      `;
      btn.addEventListener('click', () => this.switchView(`folder:${folder.id}`));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showFolderContextMenu(e, folder);
      });
      container.appendChild(btn);
    });
  },

  renderGroups() {
    const container = document.getElementById('groupsList');
    container.innerHTML = '';
    this.groups.forEach(group => {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.dataset.view = `group:${group.id}`;
      btn.innerHTML = `
        <span class="folder-color-dot" style="background:${group.color}"></span>
        <span>${group.name}</span>
      `;
      btn.addEventListener('click', () => this.switchView(`group:${group.id}`));
      container.appendChild(btn);
    });
  },

  renderClipGrid() {
    const grid = document.getElementById('clipGrid');
    const empty = document.getElementById('emptyState');

    if (this.clips.length === 0) {
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = '';

    this.clips.forEach((clip, index) => {
      const card = document.createElement('div');
      card.className = 'clip-card animate-in';
      card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;
      card.dataset.clipId = clip.id;
      card.draggable = true;

      let thumbContent = '';
      if (clip.type === 'image' && clip.filePath) {
        thumbContent = `<img src="file://${clip.filePath.replace(/\\/g, '/')}" alt="" loading="lazy" />`;
      } else if (clip.type === 'link') {
        thumbContent = `<div class="link-preview">${this.escapeHtml(clip.content || clip.title || '')}</div>`;
      } else {
        thumbContent = `<div class="text-preview">${this.escapeHtml(clip.content || clip.title || '')}</div>`;
      }

      const time = this.formatTime(clip.createdAt);
      const size = clip.fileSize ? this.formatSize(clip.fileSize) : '';

      card.innerHTML = `
        <div class="clip-card-thumb">${thumbContent}</div>
        <div class="clip-card-info">
          <div class="clip-card-title">${this.escapeHtml(clip.title || 'Untitled')}</div>
          <div class="clip-card-meta"><span>${time}</span><span>${size}</span></div>
        </div>
        <button class="clip-card-fav ${clip.favorite ? 'active' : ''}" data-clip-id="${clip.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${clip.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.clip-card-fav')) {
          this.toggleFavoriteById(clip.id);
          return;
        }
        this.openClipTab(clip);
      });

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showClipContextMenu(e, clip);
      });

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', clip.id);
        e.dataTransfer.effectAllowed = 'move';
        ucb.startDrag(clip.id);
      });

      grid.appendChild(card);
    });
  },

  // ===== Tabs =====
  openClipTab(clip) {
    if (!this.openTabs.find(t => t.id === clip.id)) {
      this.openTabs.push(clip);
    }
    this.activeTabId = clip.id;
    this.activeClip = clip;
    this.renderTabs();
    this.showClipDetail(clip);
  },

  closeTab(clipId) {
    this.openTabs = this.openTabs.filter(t => t.id !== clipId);
    if (this.activeTabId === clipId) {
      if (this.openTabs.length > 0) {
        const last = this.openTabs[this.openTabs.length - 1];
        this.activeTabId = last.id;
        this.activeClip = last;
        this.showClipDetail(last);
      } else {
        this.activeTabId = null;
        this.activeClip = null;
        document.getElementById('clipDetail').classList.add('hidden');
        document.getElementById('clipGrid').classList.remove('hidden');
        if (this.clips.length === 0) {
          document.getElementById('emptyState').classList.remove('hidden');
        }
      }
    }
    this.renderTabs();
  },

  renderTabs() {
    const tabList = document.getElementById('tabList');
    tabList.innerHTML = '';

    this.openTabs.forEach(clip => {
      const tab = document.createElement('div');
      tab.className = `tab ${clip.id === this.activeTabId ? 'active' : ''}`;
      tab.draggable = true;

      let icon = '';
      if (clip.type === 'image' && clip.filePath) {
        icon = `<img class="tab-icon" src="file://${clip.filePath.replace(/\\/g, '/')}" />`;
      } else {
        const colors = { text: '#5ac8fa', link: '#ff9500', code: '#af52de', file: '#4cd964' };
        const color = colors[clip.type] || '#666';
        icon = `<span class="tab-icon" style="background:${color}"></span>`;
      }

      const title = clip.title || 'Untitled';
      tab.innerHTML = `
        ${icon}
        <span class="tab-title">${this.escapeHtml(title.substring(0, 30))}</span>
        <button class="tab-close">&times;</button>
      `;

      tab.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) {
          this.closeTab(clip.id);
          return;
        }
        this.activeTabId = clip.id;
        this.activeClip = clip;
        this.renderTabs();
        this.showClipDetail(clip);
      });

      tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', clip.id);
        ucb.startDrag(clip.id);
      });

      tabList.appendChild(tab);
    });
  },

  // ===== Clip Detail =====
  showClipDetail(clip) {
    const grid = document.getElementById('clipGrid');
    const detail = document.getElementById('clipDetail');
    const empty = document.getElementById('emptyState');
    const textView = document.getElementById('textClipView');
    const canvas = document.getElementById('editorCanvas');
    const toolbar = document.getElementById('editorToolbar');

    grid.classList.add('hidden');
    empty.classList.add('hidden');
    detail.classList.remove('hidden');

    if (clip.type === 'image' && clip.filePath) {
      canvas.style.display = 'block';
      textView.classList.add('hidden');
      toolbar.style.display = 'flex';
      Editor.loadImage(clip);
      this.updateClipGlow(clip);
    } else {
      canvas.style.display = 'none';
      toolbar.style.display = 'none';
      textView.classList.remove('hidden');
      textView.contentEditable = true;
      textView.textContent = clip.content || '';
      textView.addEventListener('blur', () => this.saveTextClipContent(clip.id, textView.textContent));
      this.updateClipGlow(clip);
    }

    // Update favorite button state
    const favBtn = document.getElementById('favBtn');
    if (clip.favorite) {
      favBtn.classList.add('active');
      favBtn.querySelector('svg').setAttribute('fill', 'currentColor');
    } else {
      favBtn.classList.remove('active');
      favBtn.querySelector('svg').setAttribute('fill', 'none');
    }
  },

  updateClipGlow(clip) {
    const glow = document.getElementById('clipGlow');
    if (clip.type === 'image' && clip.filePath) {
      // Create a temporary image to extract dominant color
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 4, 4);
        try {
          const data = ctx.getImageData(0, 0, 4, 4).data;
          const r = data[0], g = data[1], b = data[2];
          glow.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.3) 0%, transparent 70%)`;
          glow.classList.add('glow-animate');
        } catch {
          glow.style.background = 'radial-gradient(ellipse at center, rgba(76,217,100,0.1) 0%, transparent 70%)';
        }
      };
      img.src = `file://${clip.filePath.replace(/\\/g, '/')}`;
    } else {
      const colors = { text: '90,200,250', link: '255,149,0', code: '175,82,222' };
      const c = colors[clip.type] || '76,217,100';
      glow.style.background = `radial-gradient(ellipse at center, rgba(${c},0.15) 0%, transparent 70%)`;
      glow.classList.add('glow-animate');
    }
  },

  // ===== Actions =====
  async copyActiveClip() {
    if (!this.activeClip) return;
    const success = await ucb.copyToClipboard(this.activeClip.id);
    if (success) this.toast('Copied to clipboard', 'success');
  },

  async saveActiveClipAs() {
    if (!this.activeClip) return;
    const result = await ucb.saveClipAs(this.activeClip.id);
    if (result) this.toast('Saved successfully', 'success');
  },

  async deleteActiveClip() {
    if (!this.activeClip) return;
    const confirmed = await Dialogs.confirm('Delete this clip?', 'This action cannot be undone.');
    if (!confirmed) return;
    await ucb.deleteClip(this.activeClip.id);
    this.clips = this.clips.filter(c => c.id !== this.activeClip.id);
    this.closeTab(this.activeClip.id);
    this.renderClipGrid();
    this.updateBadges();
    this.toast('Clip deleted', 'info');
  },

  async toggleFavorite() {
    if (!this.activeClip) return;
    await this.toggleFavoriteById(this.activeClip.id);
  },

  async toggleFavoriteById(clipId) {
    const clip = this.clips.find(c => c.id === clipId);
    if (!clip) return;
    const newVal = clip.favorite ? 0 : 1;
    await ucb.updateClip(clipId, { favorite: newVal });
    clip.favorite = newVal;

    // Update tab data too
    const tab = this.openTabs.find(t => t.id === clipId);
    if (tab) tab.favorite = newVal;
    if (this.activeClip && this.activeClip.id === clipId) this.activeClip.favorite = newVal;

    this.renderClipGrid();
    if (this.activeClip && this.activeClip.id === clipId) this.showClipDetail(this.activeClip);
  },

  async extractText() {
    if (!this.activeClip || this.activeClip.type !== 'image') {
      this.toast('Select an image clip first', 'info');
      return;
    }
    this.toast('Extracting text...', 'info');
    const text = await ucb.extractText(this.activeClip.id);
    if (text) {
      Dialogs.showTextResult('Extracted Text (OCR)', text);
    } else {
      this.toast('No text found in image', 'info');
    }
  },

  async searchWeb() {
    if (!this.activeClip) return;
    const result = await ucb.aiSearchWeb(this.activeClip.id, false);
    if (result.error) this.toast(result.error, 'error');
  },

  toggleHighlightSearch() {
    this.highlightMode = !this.highlightMode;
    const btn = document.getElementById('highlightSearchBtn');
    if (this.highlightMode) {
      btn.classList.add('active');
      btn.style.color = 'var(--accent-yellow)';
      this.toast('Highlight-to-search ON: Select text on screen then press Enter', 'info');
      document.addEventListener('mouseup', this.handleHighlightSelection);
    } else {
      btn.classList.remove('active');
      btn.style.color = '';
      document.removeEventListener('mouseup', this.handleHighlightSelection);
    }
  },

  handleHighlightSelection: function() {
    const selection = window.getSelection().toString().trim();
    if (selection.length > 0) {
      ucb.highlightSearch(selection);
    }
  },

  async saveTextClipContent(clipId, content) {
    await ucb.updateClip(clipId, { content });
    const clip = this.clips.find(c => c.id === clipId);
    if (clip) clip.content = content;
  },

  async importFiles() {
    const clips = await ucb.importFile();
    if (clips && clips.length > 0) {
      this.clips = [...clips, ...this.clips];
      this.renderClipGrid();
      this.updateBadges();
      this.openClipTab(clips[0]);
      this.toast(`Imported ${clips.length} file(s)`, 'success');
    }
  },

  async takeScreenshot() {
    // Minimize window, take screenshot, restore
    ucb.minimize();
    // Small delay to allow window to minimize
    setTimeout(async () => {
      await ucb.pasteFromClipboard();
    }, 300);
  },

  async handleSearch(query) {
    if (!query.trim()) {
      this.clips = await ucb.getClips() || [];
    } else {
      this.clips = await ucb.searchClips(query) || [];
    }
    this.renderClipGrid();
  },

  // ===== Context Menus =====
  showClipContextMenu(e, clip) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: 'Open', icon: '📂', action: () => this.openClipTab(clip) },
      { label: 'Copy to Clipboard', icon: '📋', action: () => { ucb.copyToClipboard(clip.id); this.toast('Copied', 'success'); } },
      { label: 'Save As...', icon: '💾', action: () => ucb.saveClipAs(clip.id) },
      { label: clip.favorite ? 'Unfavorite' : 'Favorite', icon: '⭐', action: () => this.toggleFavoriteById(clip.id) },
      'separator',
      { label: 'Move to Folder', icon: '📁', submenu: true, action: () => Dialogs.showMoveFolderDialog(clip, this.folders) },
      { label: 'Move to Hidden', icon: '🔒', action: () => Dialogs.showMoveToHiddenDialog(clip) },
      { label: 'Share', icon: '🔗', action: () => Dialogs.showShareDialog(clip) },
      'separator',
      { label: 'Delete', icon: '🗑️', danger: true, action: async () => {
        await ucb.deleteClip(clip.id);
        this.clips = this.clips.filter(c => c.id !== clip.id);
        this.closeTab(clip.id);
        this.renderClipGrid();
        this.updateBadges();
        this.toast('Deleted', 'info');
      }}
    ];

    items.forEach(item => {
      if (item === 'separator') {
        menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-separator' }));
        return;
      }
      const btn = document.createElement('button');
      btn.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
      btn.innerHTML = `<span style="width:16px;text-align:center">${item.icon}</span> ${item.label}`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.dismissContextMenu(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Adjust position if off-screen
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    });
  },

  showFolderContextMenu(e, folder) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: folder.pinned ? 'Unpin' : 'Pin', action: async () => { await ucb.pinFolder(folder.id, !folder.pinned); this.folders = await ucb.getFolders(); this.renderFolders(); }},
      { label: 'Delete Folder', danger: true, action: async () => { await ucb.deleteFolder(folder.id); this.folders = await ucb.getFolders(); this.renderFolders(); this.toast('Folder deleted', 'info'); }}
    ];

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.dismissContextMenu(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
  },

  dismissContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  },

  // ===== Keyboard =====
  handleKeyboard(e) {
    // Ctrl+Z - Undo (in editor)
    if (e.ctrlKey && e.key === 'z') {
      if (this.activeClip && this.activeClip.type === 'image') {
        Editor.undo();
      }
    }
    // Ctrl+Y - Redo
    if (e.ctrlKey && e.key === 'y') {
      if (this.activeClip && this.activeClip.type === 'image') {
        Editor.redo();
      }
    }
    // Delete
    if (e.key === 'Delete' && this.activeClip) {
      this.deleteActiveClip();
    }
    // Ctrl+S - Save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (this.activeClip && this.activeClip.type === 'image') {
        Editor.saveEdits();
      }
    }
    // Escape - close detail
    if (e.key === 'Escape') {
      if (this.activeClip) {
        document.getElementById('clipDetail').classList.add('hidden');
        document.getElementById('clipGrid').classList.remove('hidden');
      }
      this.dismissContextMenu();
    }
  },

  // ===== Settings =====
  async renderSettings() {
    const view = document.getElementById('settingsView');
    const settings = await ucb.getSettings() || {};
    const aiSettings = await ucb.getAISettings() || {};

    view.innerHTML = `
      <h2 style="margin-bottom:24px">Settings</h2>

      <div class="settings-section">
        <h3>General</h3>
        <div class="setting-row">
          <label>Clipboard Monitoring</label>
          <label class="toggle">
            <input type="checkbox" id="settClipMonitor" ${settings.clipboardMonitoring === 'true' ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <label>Auto-group new clips</label>
          <label class="toggle">
            <input type="checkbox" id="settAutoGroup" ${settings.autoGroup === 'true' ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-section">
        <h3>Hidden Folder</h3>
        <div class="setting-row">
          <label>Passcode</label>
          <button class="btn btn-secondary" onclick="Dialogs.showSetPasscodeDialog()">Set / Change Passcode</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>AI Provider</h3>
        <div class="form-group">
          <label class="form-label">Provider</label>
          <select class="form-select" id="settAIProvider">
            <option value="none" ${aiSettings.provider === 'none' ? 'selected' : ''}>None</option>
            <option value="openai" ${aiSettings.provider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4o)</option>
            <option value="ollama" ${aiSettings.provider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
            <option value="custom" ${aiSettings.provider === 'custom' ? 'selected' : ''}>Custom Endpoint</option>
          </select>
        </div>
        <div class="form-group" id="aiKeyGroup" style="display:${aiSettings.provider === 'openai' || aiSettings.provider === 'custom' ? 'block' : 'none'}">
          <label class="form-label">API Key</label>
          <input type="password" class="form-input" id="settAIKey" value="${aiSettings.apiKey || ''}" placeholder="sk-..." />
        </div>
        <div class="form-group">
          <label class="form-label">Model</label>
          <input type="text" class="form-input" id="settAIModel" value="${aiSettings.model || ''}" placeholder="e.g. gpt-4o-mini, llava" />
        </div>
        <div class="form-group" id="aiEndpointGroup" style="display:${aiSettings.provider === 'ollama' || aiSettings.provider === 'custom' ? 'block' : 'none'}">
          <label class="form-label">Endpoint URL</label>
          <input type="text" class="form-input" id="settAIEndpoint" value="${aiSettings.endpoint || ''}" placeholder="http://localhost:11434" />
        </div>
      </div>

      <div class="settings-section">
        <h3>Sharing</h3>
        <div class="form-group">
          <label class="form-label">Share Server Port</label>
          <input type="number" class="form-input" id="settSharePort" value="${settings.shareServerPort || '19847'}" />
        </div>
      </div>

      <div class="settings-section">
        <h3>Keyboard Shortcuts</h3>
        <div class="setting-row"><label>Take Screenshot</label><span style="color:var(--text-muted)"><kbd style="background:var(--bg-tertiary);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-family:monospace;font-size:11px">PrintScreen</kbd></span></div>
        <div class="setting-row"><label>Selection Screenshot</label><span style="color:var(--text-muted)"><kbd style="background:var(--bg-tertiary);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-family:monospace;font-size:11px">Ctrl+Shift+S</kbd></span></div>
        <div class="setting-row"><label>Show App</label><span style="color:var(--text-muted)"><kbd style="background:var(--bg-tertiary);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-family:monospace;font-size:11px">Ctrl+Shift+V</kbd></span></div>
        <div class="setting-row"><label>Paste into App</label><span style="color:var(--text-muted)"><kbd style="background:var(--bg-tertiary);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-family:monospace;font-size:11px">Ctrl+V</kbd></span></div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
      </div>
    `;

    // Bind AI provider change
    document.getElementById('settAIProvider').addEventListener('change', (e) => {
      const v = e.target.value;
      document.getElementById('aiKeyGroup').style.display = (v === 'openai' || v === 'custom') ? 'block' : 'none';
      document.getElementById('aiEndpointGroup').style.display = (v === 'ollama' || v === 'custom') ? 'block' : 'none';
    });

    // Save
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      await ucb.saveSettings({
        clipboardMonitoring: document.getElementById('settClipMonitor').checked ? 'true' : 'false',
        autoGroup: document.getElementById('settAutoGroup').checked ? 'true' : 'false',
        shareServerPort: document.getElementById('settSharePort').value
      });
      await ucb.saveAISettings({
        provider: document.getElementById('settAIProvider').value,
        apiKey: document.getElementById('settAIKey').value,
        model: document.getElementById('settAIModel').value,
        endpoint: document.getElementById('settAIEndpoint').value
      });
      this.toast('Settings saved', 'success');
    });
  },

  // ===== Helpers =====
  updateBadges() {
    document.getElementById('allClipCount').textContent = this.clips.length;
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => App.init());
