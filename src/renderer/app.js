// ===== Universal Clipboard - Main Renderer =====

const App = {
  clips: [],
  folders: [],
  activeClip: null,
  openTabs: [],
  activeTabId: null,
  contextMenu: null,
  selectMode: false,
  selectedClips: new Set(),
  _internalDrag: false,
  _dragClipId: null,
  editorOpen: false,
  allClips: [],
  undoStack: [],
  redoStack: [],
  currentView: 'all',
  currentViewLabel: '',
  currentSort: 'newest',
  _ignoreClipboard: false,

  // File explorer state
  explorerPath: '',
  explorerHistory: [],
  explorerHomePath: '',
  quickAccessPaths: {},

  async init() {
    try {
      console.log('[App] Starting init...');
      await this.loadData();
      console.log('[App] Data loaded:', this.clips.length, 'clips,', this.folders.length, 'folders');
      this.bindEvents();
      this.bindIPC();
      this.renderPinnedFolders();
      this.renderLeftSidebar();
      this.renderClipGrid();
      console.log('[App] UI rendered, initializing file explorer...');
      await this.initFileExplorer();
      console.log('[App] Init complete');
    } catch (e) {
      console.error('[App] Init failed:', e);
      document.getElementById('clipArea').innerHTML = `<div style="padding:40px;color:#ff3b30;font-size:14px"><h2>Initialization Error</h2><pre style="margin-top:12px;white-space:pre-wrap;color:#a0a0b8">${e.stack || e.message || e}</pre></div>`;
    }
  },

  // ===== Data Loading =====
  async loadData(retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        this.allClips = await ucb.getClips() || [];
        this.clips = [...this.allClips];
        this.folders = await ucb.getFolders() || [];
        console.log('[App] Data loaded on attempt', attempt + 1);
        return;
      } catch (e) {
        console.warn(`[App] loadData attempt ${attempt + 1} failed:`, e);
        if (attempt < retries - 1) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    console.error('[App] All loadData attempts failed');
  },

  // ===== Event Binding =====
  bindEvents() {
    // Title bar buttons
    document.getElementById('titleMinBtn').addEventListener('click', () => ucb.minimize());
    document.getElementById('titleMaxBtn').addEventListener('click', () => ucb.maximize());
    document.getElementById('titleCloseBtn').addEventListener('click', () => ucb.close());

    // Search
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.handleSearch(e.target.value), 300);
    });

    // Tab bar actions
    document.getElementById('selectModeBtn').addEventListener('click', () => this.toggleSelectMode());
    document.getElementById('importBtn').addEventListener('click', () => ucb.pasteFromClipboard());
    document.getElementById('importFileBtn').addEventListener('click', () => this.importFiles());
    document.getElementById('screenshotBtn').addEventListener('click', () => this.takeScreenshot());

    // Pinned folder add
    document.getElementById('addPinnedFolderBtn').addEventListener('click', () => Dialogs.showNewFolderDialog());

    // Pinned folder bar: accept folder drops from file explorer
    const pinBar = document.getElementById('pinnedFoldersBar');
    pinBar.addEventListener('dragover', (e) => {
      if (this._dragFolderPath) { e.preventDefault(); pinBar.classList.add('drag-over'); }
    });
    pinBar.addEventListener('dragleave', (e) => {
      if (e.target === pinBar || !pinBar.contains(e.relatedTarget)) pinBar.classList.remove('drag-over');
    });
    pinBar.addEventListener('drop', async (e) => {
      e.preventDefault(); pinBar.classList.remove('drag-over');
      const folderPath = this._dragFolderPath || e.dataTransfer.getData('text/x-folder-path');
      if (folderPath) {
        const folderName = this._dragFolderName || folderPath.replace(/\\/g, '/').split('/').pop();
        const alreadyPinned = this.folders.some(f => f.path && f.path.replace(/\\/g, '/') === folderPath.replace(/\\/g, '/'));
        if (!alreadyPinned) {
          await ucb.createFolder({ name: folderName, color: '#4cd964', pinned: true, path: folderPath });
          this.folders = await ucb.getFolders();
          this.renderPinnedFolders();
          this.renderQuickAccess();
          this.toast(`Pinned "${folderName}"`, 'success');
        } else {
          this.toast('Already pinned', 'info');
        }
      }
    });

    // Bottom buttons
    document.getElementById('hiddenFolderBtn').addEventListener('click', () => Dialogs.showPasscodeDialog());
    document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());

    // Sort bar
    document.getElementById('sortBackBtn').addEventListener('click', () => this.showAllClips());
    document.getElementById('sortSelect').addEventListener('change', (e) => {
      this.currentSort = e.target.value;
      this.applySortAndRender();
    });

    // Editor overlay actions
    document.getElementById('closeEditorBtn').addEventListener('click', () => this.closeEditor());
    document.getElementById('edCopyBtn').addEventListener('click', () => this.copyActiveClip());
    document.getElementById('edSaveBtn').addEventListener('click', () => { if (this.activeClip?.type === 'image') Editor.saveEdits(); });
    document.getElementById('edSaveAsBtn').addEventListener('click', () => this.saveActiveClipAs());
    document.getElementById('edShareBtn').addEventListener('click', () => Dialogs.showShareDialog(this.activeClip));
    document.getElementById('edOcrBtn').addEventListener('click', () => this.extractText());
    document.getElementById('edAiBtn').addEventListener('click', () => Dialogs.showAIDialog(this.activeClip));
    document.getElementById('edDeleteBtn').addEventListener('click', () => this.deleteActiveClip());

    // Bulk delete
    document.getElementById('bulkDeleteBtn').addEventListener('click', () => this.bulkDeleteSelected());

    // File explorer nav
    document.getElementById('explorerHomeBtn').addEventListener('click', () => this.navigateExplorer(this.explorerHomePath));
    document.getElementById('explorerBackBtn').addEventListener('click', () => this.explorerGoBack());
    document.getElementById('explorerOpenExternalBtn').addEventListener('click', () => {
      if (this.explorerPath) ucb.openInExplorer(this.explorerPath);
    });

    // Keyboard
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // Drop zone (external files only)
    document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!this._internalDrag && e.dataTransfer.types.includes('Files')) {
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
        this.toast('Importing files...', 'info');
        ucb.pasteFromClipboard();
      }
    });

    // Context menu dismiss
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) this.dismissContextMenu();
    });

    // Paste
    document.addEventListener('paste', (e) => { e.preventDefault(); ucb.pasteFromClipboard(); });

    // Drag select
    this.bindDragSelect();
  },

  // ===== Drag Select with auto-scroll =====
  bindDragSelect() {
    const clipArea = document.getElementById('clipArea');
    const selRect = document.getElementById('selectionRect');
    let isDragging = false, startX, startY, scrollInterval;

    clipArea.addEventListener('mousedown', (e) => {
      if (!this.selectMode) return;
      if (e.target.closest('.clip-card')) return;
      if (e.button !== 0) return;
      isDragging = true;
      const rect = clipArea.getBoundingClientRect();
      startX = e.clientX - rect.left + clipArea.scrollLeft;
      startY = e.clientY - rect.top + clipArea.scrollTop;
      selRect.style.left = startX + 'px';
      selRect.style.top = startY + 'px';
      selRect.style.width = '0';
      selRect.style.height = '0';
      selRect.classList.remove('hidden');
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = clipArea.getBoundingClientRect();
      const curX = e.clientX - rect.left + clipArea.scrollLeft;
      const curY = e.clientY - rect.top + clipArea.scrollTop;
      const x = Math.min(startX, curX), y = Math.min(startY, curY);
      const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
      selRect.style.left = x + 'px'; selRect.style.top = y + 'px';
      selRect.style.width = w + 'px'; selRect.style.height = h + 'px';

      // Auto-scroll when mouse is near edges
      clearInterval(scrollInterval);
      const edgeThreshold = 40;
      if (e.clientY < rect.top + edgeThreshold) {
        scrollInterval = setInterval(() => { clipArea.scrollTop -= 10; }, 16);
      } else if (e.clientY > rect.bottom - edgeThreshold) {
        scrollInterval = setInterval(() => { clipArea.scrollTop += 10; }, 16);
      }

      const selR = { left: x, top: y, right: x + w, bottom: y + h };
      document.querySelectorAll('.clip-card').forEach(card => {
        const cr = card.getBoundingClientRect();
        const areaR = clipArea.getBoundingClientRect();
        const cardR = {
          left: cr.left - areaR.left + clipArea.scrollLeft,
          top: cr.top - areaR.top + clipArea.scrollTop,
          right: cr.right - areaR.left + clipArea.scrollLeft,
          bottom: cr.bottom - areaR.top + clipArea.scrollTop
        };
        const overlaps = !(cardR.right < selR.left || cardR.left > selR.right || cardR.bottom < selR.top || cardR.top > selR.bottom);
        const clipId = card.dataset.clipId;
        if (overlaps) { this.selectedClips.add(clipId); card.classList.add('selected'); }
      });
      this.updateBulkUI();
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        selRect.classList.add('hidden');
        clearInterval(scrollInterval);
      }
    });
  },

  bindIPC() {
    ucb.onNewClip(async (clip) => {
      // Ignore clips that were copied from inside the app
      if (this._ignoreClipboard) { this._ignoreClipboard = false; return; }
      this.allClips.unshift(clip);
      this.clips.unshift(clip);
      this.renderClipGrid();
      this.renderLeftSidebar();
      this.toast('New clip captured', 'success');
      // Auto-OCR for images if enabled
      if (clip.type === 'image') this.autoOcrIfEnabled(clip);
    });
    ucb.onScreenshotCaptured(async (clip) => {
      if (!this.clips.find(c => c.id === clip.id)) {
        this.allClips.unshift(clip);
        this.clips.unshift(clip);
      }
      this.renderClipGrid();
      this.renderLeftSidebar();
      // Auto-open editor for screenshots
      this.openEditor(clip);
      // Auto-OCR for screenshots if enabled
      this.autoOcrIfEnabled(clip);
    });
    ucb.onNavigate((section) => {
      if (section === 'settings') this.showSettings();
    });
  },

  // ===== Select Mode =====
  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    this.selectedClips.clear();
    document.getElementById('selectModeBtn').classList.toggle('active', this.selectMode);
    this.renderClipGrid();
    this.updateBulkUI();
  },

  updateBulkUI() {
    const bar = document.getElementById('bulkBar');
    const count = this.selectedClips.size;
    if (this.selectMode && count > 0) {
      bar.classList.remove('hidden');
      document.getElementById('bulkCount').textContent = `${count} selected`;
    } else {
      bar.classList.add('hidden');
    }
  },

  async bulkDeleteSelected() {
    const count = this.selectedClips.size;
    if (count === 0) return;
    const confirmed = await Dialogs.confirm(`Delete ${count} clip(s)?`, 'This cannot be undone.');
    if (!confirmed) return;
    for (const id of this.selectedClips) {
      await ucb.deleteClip(id);
      this.closeTab(id);
    }
    this.clips = this.clips.filter(c => !this.selectedClips.has(c.id));
    this.allClips = this.allClips.filter(c => !this.selectedClips.has(c.id));
    this.selectedClips.clear();
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.updateBulkUI();
    this.toast(`Deleted ${count} clip(s)`, 'info');
  },

  // ===== Pinned Folders (TOP BAR - large, animated, peek thumbnails) =====
  renderPinnedFolders() {
    const container = document.getElementById('pinnedFoldersList');
    container.innerHTML = '';
    const pinned = this.folders.filter(f => f.pinned);
    if (pinned.length === 0 && this.folders.length > 0) {
      // Show all folders if none pinned yet
      this.folders.forEach(f => this._renderPinnedCard(container, f));
    } else {
      pinned.forEach(f => this._renderPinnedCard(container, f));
    }
  },

  _renderPinnedCard(container, folder) {
    const card = document.createElement('div');
    card.className = 'pinned-folder-card';
    card.dataset.folderId = folder.id;
    const color = folder.color || '#4cd964';
    card.style.background = color + '18';
    card.style.borderColor = color + '30';

    // Get folder clips for thumbnails
    const folderClips = this.allClips.filter(c => c.folderId === folder.id).slice(0, 3);
    let thumbsHtml = '';
    if (folderClips.length > 0) {
      thumbsHtml = folderClips.map(c => {
        if (c.type === 'image' && c.filePath) {
          return `<img src="file://${c.filePath.replace(/\\/g, '/')}" alt="" />`;
        }
        return `<div class="thumb-placeholder">Txt</div>`;
      }).join('');
    } else {
      thumbsHtml = '<div class="thumb-placeholder">Empty</div>';
    }

    const count = this.allClips.filter(c => c.folderId === folder.id).length;
    const pinSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M16 2L20.5 6.5L18 9L21 12L12 21L9 18L6.5 20.5L2 16L9 9L4 4L7 7L9 5L16 2Z"/></svg>';
    const pathLabel = folder.path ? folder.path.replace(/\\/g, '/').split('/').slice(-2).join('/') : '';

    card.innerHTML = `
      <div class="pinned-folder-card-name" style="color:${color}">
        <span class="pinned-pin-icon">${pinSvg}</span>
        ${this.escapeHtml(folder.name)}
      </div>
      <div class="pinned-folder-card-count">${count} item${count !== 1 ? 's' : ''}</div>
      ${pathLabel ? `<div class="pinned-folder-card-path" title="${this.escapeHtml(folder.path || '')}">${this.escapeHtml(pathLabel)}</div>` : ''}
      <div class="pinned-folder-card-thumbs">${thumbsHtml}</div>
    `;

    // Make path copyable on click
    const pathEl = card.querySelector('.pinned-folder-card-path');
    if (pathEl) {
      pathEl.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(folder.path || '');
        this.toast('Path copied', 'success');
      });
    }

    card.addEventListener('click', () => {
      if (folder.path) {
        this.navigateExplorer(folder.path);
      }
      this.loadFolderView(folder);
    });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showFolderContextMenu(e, folder); });

    // Drop target for clips
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', async (e) => {
      e.preventDefault(); card.classList.remove('drag-over');
      const clipId = e.dataTransfer.getData('text/plain');
      if (clipId && this._internalDrag) {
        await ucb.moveClipToFolder(clipId, folder.id);
        await this.loadData();
        this.renderPinnedFolders();
        this.renderClipGrid();
        this.toast(`Moved to ${folder.name}`, 'success');
      }
    });

    container.appendChild(card);
  },

  async loadFolderView(folder) {
    this.clips = this.allClips.filter(c => c.folderId === folder.id);
    this.currentView = 'folder';
    this.currentViewLabel = folder.name;
    this.showSortBar(folder.name);
    this.applySortAndRender();
  },

  showAllClips() {
    this.clips = [...this.allClips];
    this.currentView = 'all';
    this.currentViewLabel = '';
    this.closeEditor();
    document.getElementById('sortBar').style.display = 'none';
    this.renderClipGrid();
    document.querySelectorAll('.group-item').forEach(gi => gi.classList.remove('active'));
  },

  showFilteredView(label, filteredClips) {
    this.clips = filteredClips;
    this.currentView = 'filtered';
    this.currentViewLabel = label;
    this.closeEditor();
    this.showSortBar(label);
    this.applySortAndRender();
  },

  showSortBar(label) {
    const bar = document.getElementById('sortBar');
    bar.style.display = 'flex';
    document.getElementById('sortTitle').textContent = label;
  },

  applySortAndRender() {
    const sorted = [...this.clips];
    switch (this.currentSort) {
      case 'oldest': sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); break;
      case 'newest': sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
      case 'az': sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
      case 'za': sorted.sort((a, b) => (b.title || '').localeCompare(a.title || '')); break;
      case 'largest': sorted.sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0)); break;
      case 'smallest': sorted.sort((a, b) => (a.fileSize || 0) - (b.fileSize || 0)); break;
    }
    this.clips = sorted;
    this.renderClipGrid();
  },

  // ===== Left Sidebar: Recent Clips + Groups =====
  renderLeftSidebar() {
    this.renderRecentClips();
    this.renderDateGroups();
    this.renderTypeGroups();
  },

  renderRecentClips() {
    const list = document.getElementById('recentClipsList');
    const countEl = document.getElementById('recentClipCount');
    list.innerHTML = '';
    countEl.textContent = this.clips.length;

    this.allClips.forEach(clip => {
      const item = document.createElement('div');
      item.className = 'recent-clip-item';
      if (this.activeClip && this.activeClip.id === clip.id) item.classList.add('active');

      let thumbHtml = '';
      if (clip.type === 'image' && clip.filePath) {
        thumbHtml = `<img src="file://${clip.filePath.replace(/\\/g, '/')}" alt="" loading="lazy" />`;
      } else {
        thumbHtml = `<div class="mini-text">${this.escapeHtml((clip.content || clip.title || '').substring(0, 30))}</div>`;
      }

      item.innerHTML = `
        <div class="recent-clip-thumb">${thumbHtml}</div>
        <div class="recent-clip-info">
          <div class="rc-title">${this.escapeHtml(clip.title || 'Untitled')}</div>
          <div class="rc-meta">${this.formatTime(clip.createdAt)}</div>
        </div>
        <button class="recent-clip-delete" data-clip-id="${clip.id}" title="Delete">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;

      item.querySelector('.recent-clip-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.quickDeleteClip(clip.id);
      });
      item.addEventListener('click', () => {
        this.activeClip = clip;
        this.renderRecentClips();
        this.openEditor(clip);
      });
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showClipContextMenu(e, clip); });
      list.appendChild(item);
    });
  },

  renderDateGroups() {
    const container = document.getElementById('dateGroupsList');
    container.innerHTML = '';
    const now = Date.now();
    const day = 86400000;
    const dateGroups = [
      { label: 'Today', filter: c => (now - c.createdAt) < day, icon: '📅', bg: 'rgba(90,200,250,0.15)' },
      { label: 'Yesterday', filter: c => (now - c.createdAt) >= day && (now - c.createdAt) < day * 2, icon: '📆', bg: 'rgba(175,82,222,0.15)' },
      { label: 'This Week', filter: c => (now - c.createdAt) >= day * 2 && (now - c.createdAt) < day * 7, icon: '🗓️', bg: 'rgba(255,149,0,0.15)' },
      { label: 'Older', filter: c => (now - c.createdAt) >= day * 7, icon: '📁', bg: 'rgba(150,150,150,0.15)' }
    ];

    dateGroups.forEach(g => {
      const clips = this.allClips.filter(g.filter);
      if (clips.length === 0) return;
      const item = document.createElement('div');
      item.className = 'group-item';
      const thumbs = clips.filter(c => c.type === 'image' && c.filePath).slice(0, 2)
        .map(c => `<img src="file://${c.filePath.replace(/\\/g, '/')}" />`).join('');
      item.innerHTML = `
        <div class="group-item-icon" style="background:${g.bg};color:#fff;font-size:10px">${g.icon}</div>
        <span class="group-item-name">${g.label}</span>
        <span class="group-item-count">${clips.length}</span>
        <div class="group-item-thumbs">${thumbs}</div>
      `;
      item.addEventListener('click', () => {
        document.querySelectorAll('.group-item').forEach(gi => gi.classList.remove('active'));
        item.classList.add('active');
        this.showFilteredView(g.label, clips);
      });
      container.appendChild(item);
    });
  },

  renderTypeGroups() {
    const container = document.getElementById('typeGroupsList');
    container.innerHTML = '';

    // "All Clips" item at top
    const allItem = document.createElement('div');
    allItem.className = 'group-item group-item-all';
    allItem.innerHTML = `
      <div class="group-item-icon" style="color:#fff;font-size:10px">📋</div>
      <span class="group-item-name">All Clips</span>
      <span class="group-item-count">${this.allClips.length}</span>
    `;
    allItem.addEventListener('click', () => {
      document.querySelectorAll('.group-item').forEach(gi => gi.classList.remove('active'));
      allItem.classList.add('active');
      this.showFilteredView('All Clips', [...this.allClips]);
    });
    container.appendChild(allItem);

    const typeGroups = [
      { label: 'Images', type: 'image', icon: '🖼️', bg: 'rgba(76,217,100,0.15)' },
      { label: 'Text', type: 'text', icon: '📝', bg: 'rgba(90,200,250,0.15)' },
      { label: 'Links', type: 'link', icon: '🔗', bg: 'rgba(255,149,0,0.15)' },
      { label: 'Code', type: 'code', icon: '💻', bg: 'rgba(175,82,222,0.15)' },
      { label: 'Favorites', type: '_fav', icon: '⭐', bg: 'rgba(255,204,0,0.15)' }
    ];

    typeGroups.forEach(g => {
      const clips = g.type === '_fav'
        ? this.allClips.filter(c => c.favorite)
        : this.allClips.filter(c => c.type === g.type);
      if (clips.length === 0) return;
      const item = document.createElement('div');
      item.className = 'group-item';
      const thumbs = clips.filter(c => c.type === 'image' && c.filePath).slice(0, 2)
        .map(c => `<img src="file://${c.filePath.replace(/\\/g, '/')}" />`).join('');
      item.innerHTML = `
        <div class="group-item-icon" style="background:${g.bg};color:#fff;font-size:10px">${g.icon}</div>
        <span class="group-item-name">${g.label}</span>
        <span class="group-item-count">${clips.length}</span>
        <div class="group-item-thumbs">${thumbs}</div>
      `;
      item.addEventListener('click', () => {
        document.querySelectorAll('.group-item').forEach(gi => gi.classList.remove('active'));
        item.classList.add('active');
        this.showFilteredView(g.label, clips);
      });
      container.appendChild(item);
    });
  },

  // ===== Clip Grid (center) =====
  renderClipGrid() {
    const grid = document.getElementById('clipGrid');
    const empty = document.getElementById('emptyState');
    const settings = document.getElementById('settingsView');

    settings.classList.add('hidden');

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
      card.className = 'clip-card';
      if (this.selectedClips.has(clip.id)) card.classList.add('selected');
      card.style.animationDelay = `${Math.min(index * 20, 200)}ms`;
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

      let overlayBtn = '';
      if (this.selectMode) {
        const checked = this.selectedClips.has(clip.id) ? 'checked' : '';
        overlayBtn = `<div class="clip-card-select ${checked}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
      } else {
        overlayBtn = `<button class="clip-card-delete" data-clip-id="${clip.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
      }

      card.innerHTML = `
        <div class="clip-card-thumb">${thumbContent}</div>
        <div class="clip-card-info">
          <div class="clip-card-title">${this.escapeHtml(clip.title || 'Untitled')}</div>
          <div class="clip-card-meta"><span>${time}</span><span>${size}</span></div>
        </div>
        ${overlayBtn}
        <button class="clip-card-fav ${clip.favorite ? 'active' : ''}" data-clip-id="${clip.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${clip.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.clip-card-fav')) { this.toggleFavoriteById(clip.id); return; }
        if (e.target.closest('.clip-card-delete')) { this.quickDeleteClip(clip.id); return; }
        if (this.selectMode) {
          if (this.selectedClips.has(clip.id)) { this.selectedClips.delete(clip.id); card.classList.remove('selected'); }
          else { this.selectedClips.add(clip.id); card.classList.add('selected'); }
          this.updateBulkUI();
          return;
        }
        this.openEditor(clip);
      });

      card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showClipContextMenu(e, clip); });

      // Internal drag
      card.addEventListener('dragstart', (e) => {
        this._internalDrag = true; this._dragClipId = clip.id;
        e.dataTransfer.setData('text/plain', clip.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        this._internalDrag = false; this._dragClipId = null;
        card.classList.remove('dragging');
        document.getElementById('dropZone').classList.add('hidden');
      });

      grid.appendChild(card);
    });
  },

  async quickDeleteClip(clipId) {
    await ucb.deleteClip(clipId);
    this.clips = this.clips.filter(c => c.id !== clipId);
    this.allClips = this.allClips.filter(c => c.id !== clipId);
    this.closeTab(clipId);
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.toast('Clip deleted', 'info');
  },

  // ===== Editor Overlay (opens over center panel) =====
  openEditor(clip) {
    if (!this.openTabs.find(t => t.id === clip.id)) this.openTabs.push(clip);
    this.activeTabId = clip.id;
    this.activeClip = clip;
    this.editorOpen = true;
    this.renderTabs();

    const overlay = document.getElementById('editorOverlay');
    const canvas = document.getElementById('editorCanvas');
    const textView = document.getElementById('textClipView');
    const toolbar = document.getElementById('editorToolbar');

    overlay.classList.remove('hidden');
    document.getElementById('editorClipTitle').textContent = clip.title || 'Untitled';

    // Reset both views first
    canvas.style.display = 'none';
    canvas.classList.add('hidden');
    textView.style.display = 'none';
    textView.classList.add('hidden');
    textView.innerHTML = '';
    toolbar.style.display = 'none';

    if (clip.type === 'image' && clip.filePath) {
      canvas.classList.remove('hidden');
      canvas.style.display = 'block';
      toolbar.style.display = 'flex';
      Editor.loadImage(clip);
    } else {
      textView.classList.remove('hidden');
      textView.style.display = 'flex';
      this._initTextEditor(textView, clip);
    }
  },

  _initTextEditor(textView, clip) {
    const content = clip.content || '';
    textView.innerHTML = `
      <div class="md-toolbar">
        <button class="md-btn" data-action="bold" title="Bold"><b>B</b></button>
        <button class="md-btn" data-action="italic" title="Italic"><i>I</i></button>
        <button class="md-btn" data-action="underline" title="Underline"><u>U</u></button>
        <button class="md-btn" data-action="strikethrough" title="Strikethrough"><s>S</s></button>
        <span class="md-sep"></span>
        <button class="md-btn" data-action="heading" title="Heading">H</button>
        <button class="md-btn" data-action="insertUnorderedList" title="Bullet List">•</button>
        <button class="md-btn" data-action="insertOrderedList" title="Numbered List">1.</button>
        <button class="md-btn" data-action="code" title="Code">&lt;/&gt;</button>
        <button class="md-btn" data-action="insertHorizontalRule" title="Divider">—</button>
        <span class="md-sep"></span>
        <button class="md-btn" data-action="createLink" title="Link">🔗</button>
      </div>
      <div class="md-editor" contenteditable="true">${this.escapeHtml(content)}</div>
    `;

    const editor = textView.querySelector('.md-editor');
    editor.onblur = () => this.saveTextClipContent(clip.id, editor.innerText);

    textView.querySelectorAll('.md-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        if (action === 'heading') {
          document.execCommand('formatBlock', false, 'h3');
        } else if (action === 'code') {
          const sel = window.getSelection();
          if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            const code = document.createElement('code');
            code.style.cssText = 'background:var(--bg-tertiary);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:12px';
            range.surroundContents(code);
          }
        } else if (action === 'createLink') {
          const url = prompt('Enter URL:');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(action, false, null);
        }
        editor.focus();
      });
    });
  },

  closeEditor() {
    document.getElementById('editorOverlay').classList.add('hidden');
    // Reset text view so it doesn't linger when opening an image next
    const textView = document.getElementById('textClipView');
    textView.classList.add('hidden');
    textView.style.display = 'none';
    textView.innerHTML = '';
    this.editorOpen = false;
  },

  // ===== Tabs =====
  closeTab(clipId) {
    this.openTabs = this.openTabs.filter(t => t.id !== clipId);
    if (this.activeTabId === clipId) {
      if (this.openTabs.length > 0) {
        const last = this.openTabs[this.openTabs.length - 1];
        this.activeTabId = last.id;
        this.activeClip = last;
      } else {
        this.activeTabId = null;
        this.activeClip = null;
        this.closeEditor();
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

      let icon = '';
      if (clip.type === 'image' && clip.filePath) {
        icon = `<img class="tab-icon" src="file://${clip.filePath.replace(/\\/g, '/')}" />`;
      } else {
        const colors = { text: '#5ac8fa', link: '#ff9500', code: '#af52de' };
        icon = `<span class="tab-icon" style="background:${colors[clip.type] || '#666'}"></span>`;
      }

      tab.innerHTML = `${icon}<span class="tab-title">${this.escapeHtml((clip.title || 'Untitled').substring(0, 30))}</span><button class="tab-close">&times;</button>`;

      tab.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) { this.closeTab(clip.id); return; }
        this.activeTabId = clip.id;
        this.activeClip = clip;
        this.renderTabs();
        this.openEditor(clip);
      });

      // Right-click tab context menu
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showTabContextMenu(e, clip);
      });

      tabList.appendChild(tab);
    });
  },

  showTabContextMenu(e, clip) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: 'Close', action: () => this.closeTab(clip.id) },
      { label: 'Close All Tabs', action: () => { this.openTabs = []; this.activeTabId = null; this.activeClip = null; this.closeEditor(); this.renderTabs(); }},
      { label: 'Close Tabs to the Right', action: () => {
        const idx = this.openTabs.findIndex(t => t.id === clip.id);
        const removed = this.openTabs.splice(idx + 1);
        removed.forEach(t => { if (this.activeTabId === t.id) { this.activeTabId = clip.id; this.activeClip = clip; }});
        this.renderTabs();
      }}
    ];

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'context-menu-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => { this.dismissContextMenu(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
  },

  // ===== File Explorer (right sidebar) =====
  async initFileExplorer() {
    this.explorerHomePath = await ucb.getAppFolder();
    this.quickAccessPaths = await ucb.getQuickAccessPaths();
    this.renderQuickAccess();
    this.navigateExplorer(this.explorerHomePath);
  },

  renderQuickAccess() {
    const container = document.getElementById('explorerQuickAccess');
    container.innerHTML = '';

    // Pinned folders from DB (with filesystem paths)
    const pinnedWithPaths = this.folders.filter(f => f.pinned && f.path);
    if (pinnedWithPaths.length > 0) {
      const pinHeader = document.createElement('div');
      pinHeader.className = 'qa-header';
      pinHeader.textContent = 'PINNED';
      container.appendChild(pinHeader);

      pinnedWithPaths.forEach(f => {
        const div = document.createElement('div');
        div.className = 'qa-item';
        div.style.color = f.color || 'var(--text-secondary)';
        div.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${f.color || '#4cd964'}" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg><span>${this.escapeHtml(f.name)}</span>`;
        div.addEventListener('click', () => this.navigateExplorer(f.path));
        div.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showExplorerContextMenu(e, f.path, f.name, true); });
        container.appendChild(div);
      });
    }

    // System quick access
    const sysHeader = document.createElement('div');
    sysHeader.className = 'qa-header';
    sysHeader.textContent = 'QUICK ACCESS';
    container.appendChild(sysHeader);

    const items = [
      { label: 'Saved Clips', path: this.quickAccessPaths.clipsFolder, icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4cd964" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>', highlight: true },
      { label: 'Desktop', path: this.quickAccessPaths.desktop, icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
      { label: 'Documents', path: this.quickAccessPaths.documents, icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>' },
      { label: 'Downloads', path: this.quickAccessPaths.downloads, icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' },
      { label: 'Pictures', path: this.quickAccessPaths.pictures, icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' }
    ];

    items.forEach(qa => {
      const div = document.createElement('div');
      div.className = 'qa-item';
      if (qa.highlight) div.style.color = 'var(--accent-green)';
      div.innerHTML = `${qa.icon}<span>${qa.label}</span>`;
      div.addEventListener('click', () => this.navigateExplorer(qa.path));
      div.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showExplorerContextMenu(e, qa.path, qa.label, false); });
      container.appendChild(div);
    });
  },

  async navigateExplorer(dirPath) {
    if (!dirPath) return;
    this.explorerHistory.push(this.explorerPath);
    this.explorerPath = dirPath;
    this.renderExplorerBreadcrumb();
    const entries = await ucb.listDirectory(dirPath);
    this.renderExplorerFiles(entries);
  },

  explorerGoBack() {
    if (this.explorerHistory.length === 0) return;
    const prev = this.explorerHistory.pop();
    this.explorerPath = prev;
    this.renderExplorerBreadcrumb();
    ucb.listDirectory(prev).then(entries => this.renderExplorerFiles(entries));
  },

  renderExplorerBreadcrumb() {
    const bc = document.getElementById('explorerBreadcrumb');
    // Show last 2 path segments
    const parts = this.explorerPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const display = parts.slice(-2).join(' / ');
    bc.textContent = display;
    bc.title = this.explorerPath;
  },

  renderExplorerFiles(entries) {
    const container = document.getElementById('explorerFileList');
    container.innerHTML = '';

    if (entries.length === 0) {
      container.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted);text-align:center">Empty folder</div>';
      return;
    }

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'file-item';

      let icon = '';
      if (entry.isDirectory) {
        icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffcc00" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
      } else {
        const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
        if (imgExts.includes(entry.extension)) {
          icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4cd964" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
        } else {
          icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5ac8fa" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        }
      }

      const size = entry.isDirectory ? '' : this.formatSize(entry.size);

      item.innerHTML = `<div class="file-item-icon">${icon}</div><span class="file-item-name">${this.escapeHtml(entry.name)}</span><span class="file-item-meta">${size}</span>`;

      // Right-click context menu
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showExplorerContextMenu(e, entry.path, entry.name, false, entry.isDirectory);
      });

      if (entry.isDirectory) {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
          this._dragFolderPath = entry.path;
          this._dragFolderName = entry.name;
          e.dataTransfer.setData('text/x-folder-path', entry.path);
        });
        item.addEventListener('dragend', () => { this._dragFolderPath = null; this._dragFolderName = null; });
        item.addEventListener('click', () => this.navigateExplorer(entry.path));
        // Drop target for clips
        item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
        item.addEventListener('drop', async (e) => {
          e.preventDefault(); item.classList.remove('drag-over');
          const clipId = e.dataTransfer.getData('text/plain');
          if (clipId && this._internalDrag) {
            await ucb.copyClipToPath(clipId, entry.path);
            this.toast(`Copied to ${entry.name}`, 'success');
            this.navigateExplorer(this.explorerPath);
          }
        });
      } else {
        item.addEventListener('click', () => ucb.openInExplorer(entry.path));
      }

      container.appendChild(item);
    });
  },

  // ===== Explorer Context Menu =====
  showExplorerContextMenu(e, filePath, name, isPinned, isDirectory) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:999;`;

    let items = `<button class="context-menu-item" data-action="open-explorer">View in File Explorer</button>`;
    if (isDirectory || isPinned) {
      const alreadyPinned = this.folders.some(f => f.path && f.path.replace(/\\/g, '/') === (filePath || '').replace(/\\/g, '/'));
      if (!alreadyPinned) {
        items += `<button class="context-menu-item" data-action="add-pin">Add to Pins</button>`;
      }
    }
    items += `<button class="context-menu-item" data-action="copy-path">Copy Path</button>`;
    menu.innerHTML = items;

    menu.addEventListener('click', async (ev) => {
      const action = ev.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'open-explorer') ucb.openInExplorer(filePath);
      else if (action === 'add-pin') {
        const folderName = name || filePath.replace(/\\/g, '/').split('/').pop();
        await ucb.createFolder({ name: folderName, color: '#4cd964', pinned: true, path: filePath });
        this.folders = await ucb.getFolders();
        this.renderPinnedFolders();
        this.renderQuickAccess();
        this.toast(`Pinned "${folderName}"`, 'success');
      } else if (action === 'copy-path') {
        navigator.clipboard.writeText(filePath);
        this.toast('Path copied', 'success');
      }
      this.dismissContextMenu();
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
  },

  // ===== Actions =====
  async copyActiveClip() {
    if (!this.activeClip) return;
    this._ignoreClipboard = true;
    const success = await ucb.copyToClipboard(this.activeClip.id);
    if (success) this.toast('Copied to clipboard', 'success');
    // Reset ignore flag after a short delay in case the event doesn't fire
    setTimeout(() => { this._ignoreClipboard = false; }, 2000);
  },

  async saveActiveClipAs() {
    if (!this.activeClip) return;
    const result = await ucb.saveClipAs(this.activeClip.id);
    if (result) this.toast('Saved', 'success');
  },

  async deleteActiveClip() {
    if (!this.activeClip) return;
    const confirmed = await Dialogs.confirm('Delete this clip?', 'This cannot be undone.');
    if (!confirmed) return;
    await ucb.deleteClip(this.activeClip.id);
    this.clips = this.clips.filter(c => c.id !== this.activeClip.id);
    this.closeTab(this.activeClip.id);
    this.closeEditor();
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.toast('Clip deleted', 'info');
  },

  async toggleFavoriteById(clipId) {
    // If in select mode with multiple selected, bulk toggle favorite
    if (this.selectMode && this.selectedClips.size > 1 && this.selectedClips.has(clipId)) {
      await this.bulkToggleFavorite();
      return;
    }
    const clip = this.clips.find(c => c.id === clipId);
    if (!clip) return;
    const oldVal = clip.favorite;
    const newVal = oldVal ? 0 : 1;
    this.pushUndo({ type: 'favorite', clipId, oldVal, newVal });
    await ucb.updateClip(clipId, { favorite: newVal });
    clip.favorite = newVal;
    const ac = this.allClips.find(c => c.id === clipId);
    if (ac) ac.favorite = newVal;
    this.renderClipGrid();
    this.renderLeftSidebar();
  },

  async bulkToggleFavorite() {
    const ids = [...this.selectedClips];
    const clipsToToggle = this.clips.filter(c => ids.includes(c.id));
    const anyNotFav = clipsToToggle.some(c => !c.favorite);
    const newVal = anyNotFav ? 1 : 0;
    const undoEntries = [];
    for (const c of clipsToToggle) {
      undoEntries.push({ clipId: c.id, oldVal: c.favorite });
      await ucb.updateClip(c.id, { favorite: newVal });
      c.favorite = newVal;
      const ac = this.allClips.find(a => a.id === c.id);
      if (ac) ac.favorite = newVal;
    }
    this.pushUndo({ type: 'bulkFavorite', entries: undoEntries, newVal });
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.toast(`${anyNotFav ? 'Favorited' : 'Unfavorited'} ${ids.length} clip(s)`, 'success');
  },

  pushUndo(action) {
    this.undoStack.push(action);
    this.redoStack = [];
    if (this.undoStack.length > 50) this.undoStack.shift();
  },

  async performUndo() {
    if (this.undoStack.length === 0) return;
    const action = this.undoStack.pop();
    this.redoStack.push(action);
    if (action.type === 'favorite') {
      await ucb.updateClip(action.clipId, { favorite: action.oldVal });
      const c = this.clips.find(x => x.id === action.clipId);
      if (c) c.favorite = action.oldVal;
      const ac = this.allClips.find(x => x.id === action.clipId);
      if (ac) ac.favorite = action.oldVal;
    } else if (action.type === 'bulkFavorite') {
      for (const e of action.entries) {
        await ucb.updateClip(e.clipId, { favorite: e.oldVal });
        const c = this.clips.find(x => x.id === e.clipId);
        if (c) c.favorite = e.oldVal;
        const ac = this.allClips.find(x => x.id === e.clipId);
        if (ac) ac.favorite = e.oldVal;
      }
    }
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.toast('Undone', 'info');
  },

  async performRedo() {
    if (this.redoStack.length === 0) return;
    const action = this.redoStack.pop();
    this.undoStack.push(action);
    if (action.type === 'favorite') {
      await ucb.updateClip(action.clipId, { favorite: action.newVal });
      const c = this.clips.find(x => x.id === action.clipId);
      if (c) c.favorite = action.newVal;
      const ac = this.allClips.find(x => x.id === action.clipId);
      if (ac) ac.favorite = action.newVal;
    } else if (action.type === 'bulkFavorite') {
      for (const e of action.entries) {
        await ucb.updateClip(e.clipId, { favorite: action.newVal });
        const c = this.clips.find(x => x.id === e.clipId);
        if (c) c.favorite = action.newVal;
        const ac = this.allClips.find(x => x.id === e.clipId);
        if (ac) ac.favorite = action.newVal;
      }
    }
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.toast('Redone', 'info');
  },

  async autoOcrIfEnabled(clip) {
    try {
      const settings = await ucb.getSettings() || {};
      if (settings.autoOcr !== 'true') return;
      if (!clip || clip.type !== 'image') return;
      const text = await ucb.extractText(clip.id);
      if (text) {
        await ucb.updateClip(clip.id, { extractedText: text });
        clip.extractedText = text;
        const ac = this.allClips.find(c => c.id === clip.id);
        if (ac) ac.extractedText = text;
      }
    } catch (e) { console.error('Auto-OCR error:', e); }
  },

  async extractText() {
    if (!this.activeClip || this.activeClip.type !== 'image') { this.toast('Select an image first', 'info'); return; }
    this.toast('Extracting text...', 'info');
    const text = await ucb.extractText(this.activeClip.id);
    if (text) Dialogs.showTextResult('Extracted Text (OCR)', text);
    else this.toast('No text found', 'info');
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
      this.renderLeftSidebar();
      this.openEditor(clips[0]);
      this.toast(`Imported ${clips.length} file(s)`, 'success');
    }
  },

  async takeScreenshot() {
    try {
      await ucb.takeScreenshot();
    } catch (e) { console.error('Screenshot error:', e); }
  },

  async handleSearch(query) {
    if (!query.trim()) {
      this.clips = [...this.allClips];
      document.getElementById('sortBar').style.display = 'none';
    } else {
      // Check for filter commands like "type:image" or "date:today"
      const filters = this._parseSearchFilters(query);
      if (filters.hasFilters) {
        let results = [...this.allClips];
        if (filters.type) results = results.filter(c => c.type === filters.type);
        if (filters.fav) results = results.filter(c => c.favorite);
        if (filters.dateFrom) results = results.filter(c => c.createdAt >= filters.dateFrom);
        if (filters.dateTo) results = results.filter(c => c.createdAt <= filters.dateTo);
        if (filters.text) {
          const q = filters.text.toLowerCase();
          results = results.filter(c =>
            (c.title || '').toLowerCase().includes(q) ||
            (c.content || '').toLowerCase().includes(q) ||
            (c.extractedText || '').toLowerCase().includes(q)
          );
        }
        this.clips = results;
        this.showSortBar(`Search: ${query}`);
      } else {
        // Plain text search
        const q = query.toLowerCase();
        this.clips = this.allClips.filter(c =>
          (c.title || '').toLowerCase().includes(q) ||
          (c.content || '').toLowerCase().includes(q) ||
          (c.extractedText || '').toLowerCase().includes(q)
        );
      }
    }
    this.renderClipGrid();
    this.renderLeftSidebar();
  },

  _parseSearchFilters(query) {
    const filters = { hasFilters: false, text: '' };
    const parts = query.split(/\s+/);
    const textParts = [];
    const now = Date.now();
    const day = 86400000;

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower.startsWith('type:')) {
        filters.type = lower.replace('type:', '');
        filters.hasFilters = true;
      } else if (lower === 'is:favorite' || lower === 'is:fav') {
        filters.fav = true;
        filters.hasFilters = true;
      } else if (lower.startsWith('date:')) {
        const d = lower.replace('date:', '');
        filters.hasFilters = true;
        if (d === 'today') { filters.dateFrom = now - day; }
        else if (d === 'yesterday') { filters.dateFrom = now - day * 2; filters.dateTo = now - day; }
        else if (d === 'week') { filters.dateFrom = now - day * 7; }
        else if (d === 'month') { filters.dateFrom = now - day * 30; }
        else {
          // Try parsing as date: date:2024-01-01
          const ts = Date.parse(d);
          if (!isNaN(ts)) { filters.dateFrom = ts; filters.dateTo = ts + day; }
        }
      } else if (lower.startsWith('from:')) {
        const ts = Date.parse(lower.replace('from:', ''));
        if (!isNaN(ts)) { filters.dateFrom = ts; filters.hasFilters = true; }
      } else if (lower.startsWith('to:')) {
        const ts = Date.parse(lower.replace('to:', ''));
        if (!isNaN(ts)) { filters.dateTo = ts + day; filters.hasFilters = true; }
      } else {
        textParts.push(part);
      }
    }
    filters.text = textParts.join(' ');
    return filters;
  },

  // ===== Settings =====
  showSettings() {
    document.getElementById('clipGrid').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    this.closeEditor();
    const settings = document.getElementById('settingsView');
    settings.classList.remove('hidden');
    this.renderSettings();
  },

  async renderSettings() {
    const view = document.getElementById('settingsView');
    const settings = await ucb.getSettings() || {};
    const aiSettings = await ucb.getAISettings() || {};

    view.innerHTML = `
      <h2 style="margin-bottom:24px">Settings</h2>
      <div class="settings-section">
        <h3>General</h3>
        <div class="setting-row"><label>Clipboard Monitoring</label><label class="toggle"><input type="checkbox" id="settClipMonitor" ${settings.clipboardMonitoring === 'true' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Open on startup</label><label class="toggle"><input type="checkbox" id="settOpenOnStartup" ${settings.openOnStartup !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Minimize to tray</label><label class="toggle"><input type="checkbox" id="settMinToTray" ${settings.minimizeToTray !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Clipboard capture notification</label><label class="toggle"><input type="checkbox" id="settClipNotification" ${settings.clipboardNotification !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Auto-OCR screenshots</label><label class="toggle"><input type="checkbox" id="settAutoOcr" ${settings.autoOcr === 'true' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Automatically extract text from screenshots so you can search text inside images.</p>
      </div>
      <div class="settings-section">
        <h3>Storage</h3>
        <div class="setting-row"><label>Data location</label><div style="display:flex;gap:8px;align-items:center"><input type="text" class="form-input" id="settDataDir" value="${settings.dataDirectory || ''}" placeholder="Default" style="width:200px;font-size:11px" readonly /><button class="btn btn-secondary" id="changeDataDirBtn" style="font-size:10px;padding:5px 8px">Change</button></div></div>
        <div class="setting-row"><label>Clear all data</label><button class="btn btn-danger" id="clearAllDataBtn" style="font-size:11px">Delete All Clips</button></div>
      </div>
      <div class="settings-section">
        <h3>Hidden Folder</h3>
        <div class="setting-row"><label>Passcode</label><button class="btn btn-secondary" onclick="Dialogs.showSetPasscodeDialog()">Set / Change</button></div>
      </div>
      <div class="settings-section">
        <h3>AI Provider</h3>
        <div class="form-group"><label class="form-label">Provider</label><select class="form-select" id="settAIProvider"><option value="none" ${aiSettings.provider==='none'?'selected':''}>None</option><option value="openai" ${aiSettings.provider==='openai'?'selected':''}>OpenAI</option><option value="ollama" ${aiSettings.provider==='ollama'?'selected':''}>Ollama</option><option value="custom" ${aiSettings.provider==='custom'?'selected':''}>Custom</option></select></div>
        <div class="form-group" id="aiKeyGroup" style="display:${aiSettings.provider==='openai'||aiSettings.provider==='custom'?'block':'none'}"><label class="form-label">API Key</label><input type="password" class="form-input" id="settAIKey" value="${aiSettings.apiKey||''}" placeholder="sk-..." /></div>
        <div class="form-group"><label class="form-label">Model</label><input type="text" class="form-input" id="settAIModel" value="${aiSettings.model||''}" placeholder="gpt-4o-mini" /></div>
        <div class="form-group" id="aiEndpointGroup" style="display:${aiSettings.provider==='ollama'||aiSettings.provider==='custom'?'block':'none'}"><label class="form-label">Endpoint</label><input type="text" class="form-input" id="settAIEndpoint" value="${aiSettings.endpoint||''}" placeholder="http://localhost:11434" /></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button></div>
    `;

    document.getElementById('settAIProvider').addEventListener('change', (e) => {
      const v = e.target.value;
      document.getElementById('aiKeyGroup').style.display = (v==='openai'||v==='custom')?'block':'none';
      document.getElementById('aiEndpointGroup').style.display = (v==='ollama'||v==='custom')?'block':'none';
    });
    document.getElementById('changeDataDirBtn').addEventListener('click', async () => {
      const d = await ucb.chooseDirectory();
      if (d) document.getElementById('settDataDir').value = d;
    });
    document.getElementById('clearAllDataBtn').addEventListener('click', async () => {
      const ok = await Dialogs.confirm('Delete ALL clips?', 'Files will be moved to the Recycle Bin.');
      if (!ok) return;
      await ucb.clearAllClips();
      this.clips = []; this.openTabs = []; this.activeClip = null; this.closeEditor();
      this.renderClipGrid(); this.renderLeftSidebar(); this.renderTabs();
      this.toast('All clips deleted', 'info');
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      await ucb.saveSettings({
        clipboardMonitoring: document.getElementById('settClipMonitor').checked?'true':'false',
        openOnStartup: document.getElementById('settOpenOnStartup').checked?'true':'false',
        minimizeToTray: document.getElementById('settMinToTray').checked?'true':'false',
        clipboardNotification: document.getElementById('settClipNotification').checked?'true':'false',
        autoOcr: document.getElementById('settAutoOcr').checked?'true':'false',
        dataDirectory: document.getElementById('settDataDir').value
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

  // ===== Context Menus =====
  showClipContextMenu(e, clip) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: 'Edit', action: () => this.openEditor(clip) },
      { label: 'Copy to Clipboard', action: () => { this._ignoreClipboard = true; ucb.copyToClipboard(clip.id); this.toast('Copied', 'success'); setTimeout(() => { this._ignoreClipboard = false; }, 2000); } },
      { label: 'Save As...', action: () => ucb.saveClipAs(clip.id) },
      { label: clip.favorite ? 'Unfavorite' : 'Favorite', action: () => this.toggleFavoriteById(clip.id) },
      'separator',
      { label: 'Move to Folder', action: () => Dialogs.showMoveFolderDialog(clip, this.folders) },
      { label: 'Move to Hidden', action: () => Dialogs.showMoveToHiddenDialog(clip) },
      { label: 'Share', action: () => Dialogs.showShareDialog(clip) },
      'separator',
      { label: 'Delete', danger: true, action: async () => {
        await ucb.deleteClip(clip.id); this.clips = this.clips.filter(c => c.id !== clip.id);
        this.closeTab(clip.id); this.renderClipGrid(); this.renderLeftSidebar(); this.toast('Deleted', 'info');
      }}
    ];

    items.forEach(item => {
      if (item === 'separator') { menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-separator' })); return; }
      const btn = document.createElement('button');
      btn.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('click', () => { this.dismissContextMenu(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 8) + 'px';
      if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 8) + 'px';
    });
  },

  showFolderContextMenu(e, folder) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: folder.pinned ? 'Unpin' : 'Pin', action: async () => { await ucb.pinFolder(folder.id, !folder.pinned); await this.loadData(); this.renderPinnedFolders(); this.renderQuickAccess(); }},
      { label: 'Open in File Explorer', action: () => { ucb.openInExplorer(folder.path || this.explorerHomePath); }},
      { label: 'Browse in Sidebar', action: () => { if (folder.path) this.navigateExplorer(folder.path); }},
      { label: 'Copy Path', action: () => { navigator.clipboard.writeText(folder.path || ''); this.toast('Path copied', 'success'); }},
      { label: 'Delete Folder', danger: true, action: async () => { await ucb.deleteFolder(folder.id); await this.loadData(); this.renderPinnedFolders(); this.renderQuickAccess(); this.toast('Folder deleted', 'info'); }}
    ];

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('click', () => { this.dismissContextMenu(); item.action(); });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    this.contextMenu = menu;
  },

  dismissContextMenu() {
    if (this.contextMenu) { this.contextMenu.remove(); this.contextMenu = null; }
  },

  // ===== Keyboard =====
  handleKeyboard(e) {
    if (e.ctrlKey && e.key === 'z') {
      if (this.editorOpen && this.activeClip?.type === 'image') Editor.undo();
      else { e.preventDefault(); this.performUndo(); }
    }
    if (e.ctrlKey && e.key === 'y') {
      if (this.editorOpen && this.activeClip?.type === 'image') Editor.redo();
      else { e.preventDefault(); this.performRedo(); }
    }
    if (e.key === 'Delete') {
      if (this.selectMode && this.selectedClips.size > 0) this.bulkDeleteSelected();
      else if (this.activeClip) this.deleteActiveClip();
    }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (this.editorOpen && this.activeClip?.type === 'image') Editor.saveEdits(); }
    if (e.ctrlKey && e.key === 'a' && this.selectMode) {
      e.preventDefault();
      if (this.selectedClips.size === this.clips.length) {
        this.selectedClips.clear();
      } else {
        this.clips.forEach(c => this.selectedClips.add(c.id));
      }
      this.renderClipGrid(); this.updateBulkUI();
    }
    if (e.key === 'Escape') {
      if (this.editorOpen) this.closeEditor();
      else if (this.selectMode) this.toggleSelectMode();
      this.dismissContextMenu();
    }
  },

  // ===== Helpers =====
  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => toast.remove(), 300); }, 3000);
  },

  escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; },

  formatTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(timestamp).toLocaleDateString();
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
