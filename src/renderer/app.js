// ===== Universal Clipboard - Main Renderer =====

const FOLDER_COLORS = [
  '#2d8a4e','#c0392b','#c47200','#b8960f','#2980b9','#8e44ad','#c0294a',
  '#1a5e32','#8b1a1a','#8a5200','#7a6400','#1a5276','#6c2d82','#8a1a38',
  '#5dbe78','#e74c3c','#e8a317','#d4ac0d','#5dade2','#bb6bd9','#e84573'
];
function randomFolderColor() { return FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]; }

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
  selectedTabs: new Set(),
  _lastClickedTabId: null,
  currentView: 'all',
  currentViewLabel: '',
  currentSort: 'newest',
  _ignoreClipboard: false,

  // Library tabs state
  libraryTabs: [{ id: 'all', label: 'All Clips', filter: null }],
  activeLibTab: 'all',

  // File explorer state
  explorerPath: '',
  explorerHistory: [],
  explorerHomePath: '',
  quickAccessPaths: {},
  _explorerSelectedPaths: new Set(),
  _explorerSortedEntries: [],
  _explorerLastClickIdx: -1,

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
      this.renderLibraryTabs();
      this.hideSortBarNav();
      // Set editor to empty state on launch (show empty message, hide editor chrome)
      document.querySelector('.editor-overlay-header').style.display = 'none';
      document.querySelector('.editor-action-bar').style.display = 'none';
      document.querySelector('.editor-canvas-wrapper').style.display = 'none';
      document.getElementById('editorToolbar').style.display = 'none';
      document.getElementById('editorCanvas').style.display = 'none';
      document.getElementById('panelResizeHandle').classList.add('hidden');
      console.log('[App] UI rendered, initializing file explorer...');
      await this.initFileExplorer();
      // Apply saved zoom (default 100%) using Electron webFrame
      const savedSettings = await ucb.getSettings() || {};
      const savedScale = parseInt(savedSettings.uiScale) || 100;
      this._setZoom(savedScale, true);
      // Show hidden folder button if experimental feature is enabled
      if (savedSettings.experimentalHiddenFolder === 'true') {
        const hiddenBtn = document.getElementById('hiddenFolderBtn');
        if (hiddenBtn) hiddenBtn.classList.remove('hidden');
      }
      // First launch tutorial
      if (!savedSettings.tutorialShown) {
        Dialogs.showTutorial();
        await ucb.saveSettings({ tutorialShown: 'true' });
      }
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

    // Search (left sidebar - filters recent clips list only)
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.handleRecentSearch(e.target.value), 300);
    });

    // Tab bar actions
    document.getElementById('selectModeBtnSort').addEventListener('click', () => this.toggleSelectMode());
    document.getElementById('importBtn').addEventListener('click', () => ucb.pasteFromClipboard());
    document.getElementById('importFileBtn').addEventListener('click', () => this.importFiles());
    document.getElementById('screenshotBtn').addEventListener('click', () => this.takeScreenshot());

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
          await ucb.createFolder({ name: folderName, color: randomFolderColor(), pinned: true, path: folderPath });
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
    document.getElementById('helpBtn').addEventListener('click', () => Dialogs.showTutorial());
    document.getElementById('actionHistoryBtn').addEventListener('click', () => this.showActionHistory());
    document.getElementById('settingsBtn').addEventListener('click', () => this.toggleSettings());
    document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());
    document.getElementById('settingsOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'settingsOverlay') this.closeSettings();
    });

    // Library search
    const libSearchInput = document.getElementById('librarySearchInput');
    let libSearchTimeout;
    libSearchInput.addEventListener('input', (e) => {
      clearTimeout(libSearchTimeout);
      libSearchTimeout = setTimeout(() => this.handleLibrarySearch(e.target.value), 300);
    });

    // Search filter buttons
    document.getElementById('recentFilterBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSearchFilterDropdown('recentFilterBtn', 'searchInput', 'recent');
    });
    document.getElementById('libraryFilterBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSearchFilterDropdown('libraryFilterBtn', 'librarySearchInput', 'library');
    });

    // Library thumbnail scale
    document.getElementById('libraryThumbScale').addEventListener('input', (e) => {
      this._libGridMode = parseInt(e.target.value);
      this._applyLibGridMode();
    });

    // Explorer search
    const explorerSearchInput = document.getElementById('explorerSearchInput');
    let explorerSearchTimeout;
    explorerSearchInput.addEventListener('input', (e) => {
      clearTimeout(explorerSearchTimeout);
      explorerSearchTimeout = setTimeout(() => this.handleExplorerSearch(e.target.value), 300);
    });

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
    document.getElementById('edQrBtn').addEventListener('click', () => this.showQrCode());
    document.getElementById('edLinkBtn').addEventListener('click', () => this.generateShareLink());
    document.getElementById('edOcrBtn').addEventListener('click', () => this.extractText());
    document.getElementById('edHistoryBtn').addEventListener('click', () => this.showClipHistory());
    document.getElementById('edAiBtn').addEventListener('click', () => Dialogs.showAIDialog(this.activeClip));
    document.getElementById('edDeleteBtn').addEventListener('click', () => this.deleteActiveClip());

    // Bulk actions
    document.getElementById('bulkDeleteBtn').addEventListener('click', () => this.bulkDeleteSelected());
    document.getElementById('bulkFavBtn').addEventListener('click', () => this.bulkToggleFavorite());
    document.getElementById('bulkMoveBtn').addEventListener('click', () => this.bulkMoveToFolder());
    document.getElementById('bulkCancelBtn').addEventListener('click', () => this.toggleSelectMode());

    // File explorer nav
    document.getElementById('explorerHomeBtn').addEventListener('click', () => this.navigateExplorer(this.explorerHomePath));
    document.getElementById('explorerBackBtn').addEventListener('click', () => this.explorerGoBack());
    document.getElementById('explorerForwardBtn').addEventListener('click', () => this.explorerGoForward());
    document.getElementById('explorerOpenExternalBtn').addEventListener('click', () => {
      if (this.explorerPath) ucb.openInExplorer(this.explorerPath);
    });
    document.getElementById('explorerThumbScale').addEventListener('input', (e) => {
      this._explorerThumbMode = parseInt(e.target.value);
      if (this.explorerPath) ucb.listDirectory(this.explorerPath).then(entries => this.renderExplorerFiles(entries));
    });
    document.getElementById('explorerSortSelect').addEventListener('change', (e) => {
      this._explorerSortMode = e.target.value;
      if (this._lastExplorerEntries) this.renderExplorerFiles(this._lastExplorerEntries);
    });
    document.getElementById('explorerFilterBtn').addEventListener('click', () => {
      this._toggleSearchFilterDropdown('explorerFilterBtn', 'explorerSearchInput', 'explorer');
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

    // Sidebar resize handles
    this.bindSidebarResize('leftResizeHandle', 'leftSidebar', 'left');
    this.bindSidebarResize('rightResizeHandle', 'rightSidebar', 'right');

    // Panel resize handle (horizontal, between top and bottom sub-panels)
    this.bindPanelResize();

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

  bindSidebarResize(handleId, sidebarId, side) {
    const handle = document.getElementById(handleId);
    const sidebar = document.getElementById(sidebarId);
    if (!handle || !sidebar) return;
    let isResizing = false, startX, startW;
    handle.addEventListener('mousedown', (e) => {
      isResizing = true; startX = e.clientX; startW = sidebar.offsetWidth;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = side === 'left' ? e.clientX - startX : startX - e.clientX;
      const newW = Math.max(180, Math.min(450, startW + diff));
      sidebar.style.width = newW + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (isResizing) { isResizing = false; handle.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    });
  },

  bindPanelResize() {
    const handle = document.getElementById('panelResizeHandle');
    // In DOM order: bottomPanel (editor) is first, then resize handle, then topPanel (library)
    const editorPanel = document.getElementById('bottomPanel');
    const libraryPanel = document.getElementById('topPanel');
    if (!handle) return;
    let isResizing = false, startY, startEditorH, startLibH;
    handle.addEventListener('mousedown', (e) => {
      if (!App.editorOpen) return;
      isResizing = true; startY = e.clientY;
      startEditorH = editorPanel.offsetHeight; startLibH = libraryPanel.offsetHeight;
      handle.classList.add('active');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = e.clientY - startY;
      const totalH = startEditorH + startLibH;
      // Drag down = grow editor (above handle), shrink library (below handle)
      const newEditorH = Math.max(150, Math.min(totalH - 100, startEditorH + diff));
      const newLibH = totalH - newEditorH;
      editorPanel.style.flex = `0 0 ${newEditorH}px`;
      libraryPanel.style.flex = `0 0 ${newLibH}px`;
    });
    document.addEventListener('mouseup', () => {
      if (isResizing) { isResizing = false; handle.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
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
      this.renderPinnedFolders();
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
      this.renderPinnedFolders();
      // Auto-open editor for screenshots
      this.openEditor(clip);
      // Auto-OCR for screenshots if enabled
      this.autoOcrIfEnabled(clip);
    });
    ucb.onNavigate((section) => {
      if (section === 'settings') this.showSettings();
    });

    // Memory optimization: reduce work when window is hidden
    ucb.onWindowVisibility((visible) => {
      this._windowVisible = visible;
      if (!visible) {
        // Clear thumbnail image caches to free memory
        document.querySelectorAll('.clip-card-thumb img, .recent-clip-thumb img').forEach(img => {
          img.dataset.src = img.src;
          img.src = '';
        });
      } else {
        // Restore thumbnails when window becomes visible again
        document.querySelectorAll('.clip-card-thumb img[data-src], .recent-clip-thumb img[data-src]').forEach(img => {
          if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
        });
      }
    });
  },

  // ===== Select Mode =====
  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    this.selectedClips.clear();
    const sortBtn = document.getElementById('selectModeBtnSort');
    if (sortBtn) sortBtn.classList.toggle('active', this.selectMode);
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
    const confirmed = await Dialogs.confirm(`Delete ${count} clip(s)?`, 'Files will be moved to the Recycle Bin.');
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
    this.renderPinnedFolders();
    this.refreshExplorer();
    this.updateBulkUI();
    this.toast(`${count} clip(s) moved to Recycle Bin`, 'info');
  },

  async bulkMoveToFolder() {
    if (this.selectedClips.size === 0) return;
    // Show a quick folder picker using context-menu style dropdown
    const folders = this.folders.filter(f => f.path || f.id);
    if (folders.length === 0) { this.toast('No folders available', 'info'); return; }
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    const bar = document.getElementById('bulkBar');
    const rect = bar.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.top - folders.length * 30 - 10) + 'px';
    const header = document.createElement('div');
    header.style.cssText = 'padding:4px 10px;font-size:10px;color:var(--text-muted);font-weight:600';
    header.textContent = 'Move to folder:';
    menu.appendChild(header);
    folders.forEach(folder => {
      const btn = document.createElement('button');
      btn.className = 'context-menu-item';
      btn.textContent = folder.name;
      btn.addEventListener('click', async () => {
        this.dismissContextMenu();
        const ids = [...this.selectedClips];
        const undoEntries = [];
        for (const clipId of ids) {
          const clip = this.allClips.find(c => c.id === clipId);
          undoEntries.push({ clipId, oldFolderId: clip ? clip.folderId : null });
          await ucb.moveClipToFolder(clipId, folder.id);
        }
        this.pushUndo({ type: 'bulkMove', entries: undoEntries, newFolderId: folder.id, folderName: folder.name });
        await this.loadData();
        this.renderPinnedFolders();
        this.selectedClips.clear();
        this.renderClipGrid();
        this.renderLibraryTabs();
        this.refreshExplorer();
        this.updateBulkUI();
        this.toastWithUndo(`Moved ${ids.length} clip(s) to ${folder.name}`);
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    this.contextMenu = menu;
  },

  // ===== Pinned Folders (TOP BAR - large, animated, peek thumbnails) =====
  renderPinnedFolders() {
    const container = document.getElementById('pinnedFoldersList');
    container.innerHTML = '';
    const pinned = this.folders.filter(f => f.pinned);
    const foldersToRender = (pinned.length === 0 && this.folders.length > 0) ? this.folders : pinned;
    foldersToRender.forEach(f => this._renderPinnedCard(container, f));
    // Add button after last folder card
    const addBtn = document.createElement('button');
    addBtn.className = 'pinned-folder-add';
    addBtn.id = 'addPinnedFolderBtn';
    addBtn.title = 'Pin a folder';
    addBtn.innerHTML = `
      <div class="pinned-folder-icon-wrap">
        <div class="pinned-folder-svg-wrap">
          <svg class="folder-svg-icon" viewBox="0 -960 960 960" fill="var(--text-muted)"><path d="M575.38-340h30.77v-84.62h84.62v-30.76h-84.62V-540h-30.77v84.62h-84.61v30.76h84.61V-340Zm-400 140q-23.05 0-39.22-16.19Q120-232.38 120-255.38v-449.24q0-23 16.16-39.19Q152.33-760 175.38-760h217.93l70.77 70.77h320.54q23 0 39.19 16.19Q840-656.85 840-633.85v378.47q0 23-16.19 39.19Q807.62-200 784.62-200H175.38Zm0-30.77h609.24q10.76 0 17.69-6.92 6.92-6.93 6.92-17.69v-378.47q0-10.77-6.92-17.69-6.93-6.92-17.69-6.92H452.15l-70.77-70.77h-206q-10.76 0-17.69 6.92-6.92 6.93-6.92 17.69v449.24q0 10.76 6.92 17.69 6.93 6.92 17.69 6.92Zm-24.61 0V-729.23-230.77Z"/></svg>
        </div>
      </div>
      <div class="pinned-folder-details"><div class="pinned-folder-card-count">New Folder</div></div>`;
    addBtn.addEventListener('click', () => Dialogs.showNewFolderDialog());
    container.appendChild(addBtn);
    // Update scroll fades
    this._updatePinnedFades();
    // Async: scan filesystem-backed folders for image thumbnails
    this._loadPinnedFolderThumbs(foldersToRender);
  },

  async _loadPinnedFolderThumbs(folders) {
    if (!this._pinnedFolderThumbs) this._pinnedFolderThumbs = {};
    const imgExts = ['.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.ico'];
    let changed = false;
    for (const f of folders) {
      if (!f.path) continue;
      try {
        const entries = await ucb.listDirectory(f.path);
        const images = entries.filter(e => !e.isDirectory && imgExts.includes(e.extension))
          .sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 3).map(e => e.path);
        const old = this._pinnedFolderThumbs[f.id];
        if (!old || JSON.stringify(old) !== JSON.stringify(images)) {
          this._pinnedFolderThumbs[f.id] = images;
          changed = true;
        }
      } catch { /* skip inaccessible */ }
    }
    if (changed) {
      // Re-render only the paper thumbnails without full re-render to avoid loops
      for (const f of folders) {
        if (!f.path || !this._pinnedFolderThumbs[f.id]?.length) continue;
        const card = document.querySelector(`.pinned-folder-card[data-folder-id="${f.id}"]`);
        if (!card) continue;
        const papersEl = card.querySelector('.pinned-folder-papers');
        if (!papersEl) continue;
        const folderClips = this.allClips.filter(c => c.folderId === f.id);
        const hasClipImages = folderClips.some(c => c.type === 'image' && c.filePath);
        if (hasClipImages) continue; // clip images take priority
        papersEl.innerHTML = this._pinnedFolderThumbs[f.id].map(p =>
          `<div class="folder-paper"><img src="file://${p.replace(/\\/g, '/')}" /></div>`
        ).join('');
      }
    }
  },

  _updatePinnedFades() {
    const list = document.getElementById('pinnedFoldersList');
    const fl = document.getElementById('pinnedFadeLeft');
    const fr = document.getElementById('pinnedFadeRight');
    if (!list || !fl || !fr) return;
    const update = () => {
      fl.classList.toggle('visible', list.scrollLeft > 4);
      fr.classList.toggle('visible', list.scrollLeft < list.scrollWidth - list.clientWidth - 4);
    };
    update();
    list.removeEventListener('scroll', update);
    list.addEventListener('scroll', update);
    // Also update on window resize
    if (!this._pinnedFadesResizeBound) {
      this._pinnedFadesResizeBound = true;
      window.addEventListener('resize', () => {
        requestAnimationFrame(() => update());
      });
    }
  },

  _renderPinnedCard(container, folder) {
    const card = document.createElement('div');
    card.className = 'pinned-folder-card';
    card.dataset.folderId = folder.id;
    const color = folder.color || '#4cd964';

    // Get ALL folder clips (not just 3)
    const folderClips = this.allClips.filter(c => c.folderId === folder.id);
    const count = folderClips.length;

    // Papers behind the folder (recent clip thumbnails peeking out)
    // For filesystem-backed folders, use cached directory images; for DB folders, use clip images
    let papersHtml = '';
    const paperClips = folderClips.filter(c => c.type === 'image' && c.filePath).slice(0, 3);
    if (paperClips.length > 0) {
      paperClips.forEach(c => {
        papersHtml += `<div class="folder-paper"><img src="file://${c.filePath.replace(/\\/g, '/')}" /></div>`;
      });
    } else if (folder.path && this._pinnedFolderThumbs && this._pinnedFolderThumbs[folder.id]) {
      this._pinnedFolderThumbs[folder.id].forEach(p => {
        papersHtml += `<div class="folder-paper"><img src="file://${p.replace(/\\/g, '/')}" /></div>`;
      });
    } else if (count > 0) {
      papersHtml = '<div class="folder-paper"><div class="folder-paper-text">TXT</div></div>';
    }

    // Folder SVG icon with color fill, name overlaid
    const folderSvg = `<svg class="folder-svg-icon" viewBox="0 0 59 47" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.375 46.6667C3.20833 46.6667 2.1875 46.217 1.3125 45.3177C0.4375 44.4184 0 43.4097 0 42.2917V4.375C0 3.25694 0.4375 2.24826 1.3125 1.34896C2.1875 0.449653 3.20833 0 4.375 0H24.8646L29.2396 4.375H53.9583C55.0764 4.375 56.0851 4.82465 56.9844 5.72396C57.8837 6.62326 58.3333 7.63194 58.3333 8.75V42.2917C58.3333 43.4097 57.8837 44.4184 56.9844 45.3177C56.0851 46.217 55.0764 46.6667 53.9583 46.6667H4.375Z" fill="${color}"/>
      <path d="M4.375 46.6667C3.20833 46.6667 2.1875 46.217 1.3125 45.3177C0.4375 44.4184 0 43.4097 0 42.2917V4.375C0 3.25694 0.4375 2.24826 1.3125 1.34896C2.1875 0.449653 3.20833 0 4.375 0H24.8646L29.2396 4.375H53.9583C55.0764 4.375 56.0851 4.82465 56.9844 5.72396C57.8837 6.62326 58.3333 7.63194 58.3333 8.75V42.2917C58.3333 43.4097 57.8837 44.4184 56.9844 45.3177C56.0851 46.217 55.0764 46.6667 53.9583 46.6667H4.375Z" fill="rgba(255,255,255,0.08)"/>
    </svg>`;

    const pathLabel = folder.path ? folder.path.replace(/\\/g, '/').split('/').slice(-2).join('/') : '';

    card.innerHTML = `
      <div class="pinned-folder-icon-wrap">
        <div class="pinned-folder-papers">${papersHtml}</div>
        <div class="pinned-folder-svg-wrap">
          ${folderSvg}
          <span class="pinned-folder-label">${this.escapeHtml(folder.name)}</span>
        </div>
      </div>
      <div class="pinned-folder-details">
        <div class="pinned-folder-card-count">${count} item${count !== 1 ? 's' : ''}</div>
        ${pathLabel ? `<div class="pinned-folder-card-path" title="${this.escapeHtml(folder.path || '')}">${this.escapeHtml(pathLabel)}</div>` : ''}
      </div>
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
        this.openFolderInLibrary(folder.path, folder.name);
      } else {
        this.loadFolderView(folder);
      }
    });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showFolderContextMenu(e, folder); });

    // Drop target for clips
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', async (e) => {
      e.preventDefault(); card.classList.remove('drag-over');
      const clipId = e.dataTransfer.getData('text/plain');
      if (clipId && this._internalDrag) {
        const clip = this.allClips.find(c => c.id === clipId);
        const oldFolderId = clip ? clip.folderId : null;
        await ucb.moveClipToFolder(clipId, folder.id);
        this.pushUndo({ type: 'move', clipId, oldFolderId, newFolderId: folder.id, folderName: folder.name });
        await this.loadData();
        this.renderPinnedFolders();
        this.renderClipGrid();
        this.renderLibraryTabs();
        this.refreshExplorer();
        this.toastWithUndo(`Moved to ${folder.name}`);
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
    this.activeLibTab = 'all';
    this.clips = [...this.allClips];
    this.currentView = 'all';
    this.currentViewLabel = '';
    this.hideSortBarNav();
    this.renderClipGrid();
    this.renderLibraryTabs();
    document.querySelectorAll('.group-item').forEach(gi => gi.classList.remove('active'));
  },

  showFilteredView(label, filteredClips) {
    // Check if a library tab already exists for this label
    let tab = this.libraryTabs.find(t => t.label === label);
    if (!tab) {
      tab = { id: 'lib_' + Date.now(), label, filter: label };
      this.libraryTabs.push(tab);
    }
    this.activeLibTab = tab.id;
    this.clips = filteredClips;
    this.currentView = 'filtered';
    this.currentViewLabel = label;
    this.showSortBar(label);
    this.applySortAndRender();
    this.renderLibraryTabs();
  },

  renderLibraryTabs() {
    const container = document.getElementById('libraryTabs');
    container.innerHTML = '';
    this.libraryTabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'library-tab' + (tab.id === this.activeLibTab ? ' active' : '');
      el.dataset.libTab = tab.id;
      const closable = tab.id !== 'all';
      const libTabIcons = {
        'All Clips': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20"/><path d="M10 3v6"/></svg>',
        'Today': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        'Yesterday': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        'This Week': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/></svg>',
        'Older': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M17 18l2 2" opacity="0.5"/></svg>',
        'Favorites': '<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-yellow)" stroke="var(--accent-yellow)" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        'Images': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        'Text': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        'Links': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
        'Code': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
        'Other': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      };
      const tabIcon = libTabIcons[tab.label] || (tab.folderPath ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffcc00" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' : '');
      el.innerHTML = `${tabIcon}<span>${this.escapeHtml(tab.label)}</span>${closable ? '<button class="lib-tab-close">&times;</button>' : ''}`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.lib-tab-close')) {
          this.closeLibraryTab(tab.id);
          return;
        }
        this.switchLibraryTab(tab.id);
      });
      container.appendChild(el);
    });
    this._updateLibTabFades();

    // Allow drag-drop of folders onto the library tab bar
    container.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-folder-path')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        container.style.outline = '2px dashed var(--accent-green)';
        container.style.outlineOffset = '-2px';
      }
    });
    container.addEventListener('dragleave', () => {
      container.style.outline = '';
      container.style.outlineOffset = '';
    });
    container.addEventListener('drop', (e) => {
      container.style.outline = '';
      container.style.outlineOffset = '';
      const folderPath = e.dataTransfer.getData('text/x-folder-path');
      if (folderPath) {
        e.preventDefault();
        const folderName = this._dragFolderName || folderPath.replace(/\\/g, '/').split('/').pop();
        this.openFolderInLibrary(folderPath, folderName);
      }
    });
  },

  switchLibraryTab(tabId) {
    const tab = this.libraryTabs.find(t => t.id === tabId);
    if (!tab) return;
    this.activeLibTab = tabId;
    if (tab.id === 'all') {
      this.showAllClips();
    } else {
      // Re-filter based on the tab's label
      this._applyLibTabFilter(tab);
    }
  },

  closeLibraryTab(tabId) {
    this.libraryTabs = this.libraryTabs.filter(t => t.id !== tabId);
    if (this.activeLibTab === tabId) {
      this.activeLibTab = 'all';
      this.showAllClips();
    }
    this.renderLibraryTabs();
  },

  _applyLibTabFilter(tab) {
    const label = tab.label;
    // Re-derive the filtered clips based on the label
    const typeMap = { 'Images': 'image', 'Text': 'text', 'Links': 'link', 'Code': 'code' };
    if (label === 'Favorites') {
      this.clips = this.allClips.filter(c => c.favorite);
    } else if (typeMap[label]) {
      this.clips = this.allClips.filter(c => c.type === typeMap[label]);
    } else if (label === 'Other') {
      this.clips = this.allClips.filter(c => !['image','text','link','code'].includes(c.type));
    } else if (tab.folderPath) {
      // Folder-based tab: show clips from this folder
      const folder = this.folders.find(f => f.path === tab.folderPath);
      if (folder) {
        this.clips = this.allClips.filter(c => c.folderId === folder.id);
      } else {
        this.clips = [];
      }
    } else {
      // Date groups or custom — fallback to all
      this.clips = [...this.allClips];
    }
    this.currentView = 'filtered';
    this.currentViewLabel = label;
    this.showSortBar(label);
    this.applySortAndRender();
    this.renderLibraryTabs();
  },

  openFolderInLibrary(folderPath, folderName) {
    const name = folderName || folderPath.replace(/\\/g, '/').split('/').pop();
    // Check if tab already exists for this path
    const existing = this.libraryTabs.find(t => t.folderPath === folderPath);
    if (existing) {
      this.switchLibraryTab(existing.id);
      return;
    }
    const tabId = 'folder_' + Date.now();
    this.libraryTabs.push({ id: tabId, label: name, filter: null, folderPath });
    this.activeLibTab = tabId;
    this._applyLibTabFilter({ id: tabId, label: name, folderPath });
  },

  showSortBar(label) {
    document.getElementById('sortBackBtn').style.display = (label === 'All Clips') ? 'none' : '';
    document.getElementById('sortTitle').textContent = label;
    document.getElementById('sortTitle').style.display = '';
  },

  hideSortBarNav() {
    document.getElementById('sortBackBtn').style.display = 'none';
    document.getElementById('sortTitle').textContent = 'All Clips';
    document.getElementById('sortTitle').style.display = '';
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
    const imgList = document.getElementById('recentImagesList');
    const txtList = document.getElementById('recentTextsList');
    const imgCount = document.getElementById('recentImageCount');
    const txtCount = document.getElementById('recentTextCount');
    imgList.innerHTML = '';
    txtList.innerHTML = '';

    const imageClips = this.allClips.filter(c => c.type === 'image');
    const textClips = this.allClips.filter(c => c.type !== 'image');
    imgCount.textContent = imageClips.length + ' Items';
    txtCount.textContent = textClips.length + ' Items';

    const renderItem = (clip, list) => {
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
          <div class="rc-title">${this.escapeHtml(this.midTruncate(clip.title || 'Untitled', 32))}</div>
          <div class="rc-meta">${this.formatTime(clip.createdAt)}</div>
        </div>
        <button class="recent-clip-delete" data-clip-id="${clip.id}" title="Delete">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
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

      // Make recent clips draggable
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        this._internalDrag = true;
        this._dragClipId = clip.id;
        e.dataTransfer.setData('text/plain', clip.id);
        e.dataTransfer.effectAllowed = 'move';
        item.style.opacity = '0.5';
      });
      item.addEventListener('dragend', () => {
        this._internalDrag = false;
        this._dragClipId = null;
        item.style.opacity = '';
      });

      list.appendChild(item);
    };

    imageClips.slice(0, 20).forEach(c => renderItem(c, imgList));
    textClips.slice(0, 20).forEach(c => renderItem(c, txtList));
  },

  renderDateGroups() {
    const container = document.getElementById('dateGroupsList');
    container.innerHTML = '';
    const now = Date.now();
    const day = 86400000;
    const dateGroups = [
      { label: 'Today', filter: c => (now - c.createdAt) < day, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
      { label: 'Yesterday', filter: c => (now - c.createdAt) >= day && (now - c.createdAt) < day * 2, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
      { label: 'This Week', filter: c => (now - c.createdAt) >= day * 2 && (now - c.createdAt) < day * 7, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/></svg>' },
      { label: 'Older', filter: c => (now - c.createdAt) >= day * 7, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M17 18l2 2" opacity="0.5"/></svg>' }
    ];

    dateGroups.forEach(g => {
      const clips = this.allClips.filter(g.filter);
      if (clips.length === 0) return;
      const item = document.createElement('div');
      item.className = 'group-item';
      const thumbs = clips.filter(c => c.type === 'image' && c.filePath).slice(0, 2)
        .map(c => `<img src="file://${c.filePath.replace(/\\/g, '/')}" />`).join('');
      item.innerHTML = `
        <div class="group-item-icon">${g.icon}</div>
        <span class="group-item-name">${g.label}</span>
        <div class="group-item-thumbs">${thumbs}</div>
        <span class="group-item-count">${clips.length} Items</span>
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
      <div class="group-item-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20"/><path d="M10 3v6"/></svg></div>
      <span class="group-item-name">All Clips</span>
      <span class="group-item-count">${this.allClips.length} Items</span>
    `;
    allItem.addEventListener('click', () => {
      document.querySelectorAll('.group-item').forEach(gi => gi.classList.remove('active'));
      allItem.classList.add('active');
      this.showFilteredView('All Clips', [...this.allClips]);
    });
    container.appendChild(allItem);

    const typeGroups = [
      { label: 'Favorites', type: '_fav', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent-yellow)" stroke="var(--accent-yellow)" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' },
      { label: 'Images', type: 'image', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
      { label: 'Text', type: 'text', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
      { label: 'Links', type: 'link', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>' },
      { label: 'Code', type: 'code', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' },
      { label: 'Other', type: '_other', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' }
    ];

    typeGroups.forEach(g => {
      const clips = g.type === '_fav'
        ? this.allClips.filter(c => c.favorite)
        : g.type === '_other'
        ? this.allClips.filter(c => !['image','text','link','code'].includes(c.type))
        : this.allClips.filter(c => c.type === g.type);
      if (clips.length === 0) return;
      const item = document.createElement('div');
      item.className = 'group-item';
      const thumbs = clips.filter(c => c.type === 'image' && c.filePath).slice(0, 2)
        .map(c => `<img src="file://${c.filePath.replace(/\\/g, '/')}" />`).join('');
      item.innerHTML = `
        <div class="group-item-icon">${g.icon}</div>
        <span class="group-item-name">${g.label}</span>
        <div class="group-item-thumbs">${thumbs}</div>
        <span class="group-item-count">${clips.length} Items</span>
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

    if (this.clips.length === 0) {
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      // Show contextual empty message based on current view
      const isFiltered = this.currentView === 'filtered' || this.activeView === 'hidden';
      const emptyIcon = empty.querySelector('.empty-icon');
      const emptyH2 = empty.querySelector('h2');
      const emptyP = empty.querySelector('p');
      const emptyShortcuts = empty.querySelector('.empty-shortcuts');
      if (isFiltered) {
        if (emptyH2) emptyH2.textContent = 'This group is empty';
        if (emptyP) emptyP.textContent = 'No clips match this filter.';
        if (emptyShortcuts) emptyShortcuts.style.display = 'none';
      } else {
        if (emptyH2) emptyH2.textContent = 'No clips yet';
        if (emptyP) emptyP.textContent = 'Copy something, take a screenshot, or import a file to get started.';
        if (emptyShortcuts) emptyShortcuts.style.display = '';
      }
      return;
    }

    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = '';

    let lastDateLabel = '';
    this.clips.forEach((clip, index) => {
      // Insert date separator if label changed
      const dateLabel = this._getDateLabel(clip.createdAt);
      if (dateLabel !== lastDateLabel) {
        lastDateLabel = dateLabel;
        const sep = document.createElement('div');
        sep.className = 'clip-date-separator';
        sep.textContent = dateLabel;
        grid.appendChild(sep);
      }
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
        const isChecked = this.selectedClips.has(clip.id);
        overlayBtn = `<div class="clip-card-select ${isChecked ? 'checked' : ''}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isChecked ? '#000' : 'rgba(255,255,255,0.5)'}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
      } else {
        overlayBtn = `<button class="clip-card-delete" data-clip-id="${clip.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>`;
      }

      card.innerHTML = `
        <div class="clip-card-thumb">${thumbContent}</div>
        <div class="clip-card-info">
          <div class="clip-card-title">${this.escapeHtml(this.midTruncate(clip.title || 'Untitled', 30))}</div>
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
          // Shift-click: select range between last clicked and this clip
          if (e.shiftKey && this._lastClickedClipId) {
            const lastIdx = this.clips.findIndex(c => c.id === this._lastClickedClipId);
            const curIdx = this.clips.findIndex(c => c.id === clip.id);
            if (lastIdx >= 0 && curIdx >= 0) {
              const start = Math.min(lastIdx, curIdx);
              const end = Math.max(lastIdx, curIdx);
              for (let i = start; i <= end; i++) {
                this.selectedClips.add(this.clips[i].id);
              }
              this.renderClipGrid();
              this.updateBulkUI();
              return;
            }
          }
          this._lastClickedClipId = clip.id;
          const sel = card.querySelector('.clip-card-select');
          if (this.selectedClips.has(clip.id)) {
            this.selectedClips.delete(clip.id); card.classList.remove('selected');
            if (sel) { sel.classList.remove('checked'); sel.querySelector('svg')?.setAttribute('stroke', 'rgba(255,255,255,0.5)'); }
          } else {
            this.selectedClips.add(clip.id); card.classList.add('selected');
            if (sel) { sel.classList.add('checked'); sel.querySelector('svg')?.setAttribute('stroke', '#000'); }
          }
          this.updateBulkUI();
          return;
        }
        // Shift-click outside select mode: enter select mode with range
        if (e.shiftKey) {
          this.selectMode = true;
          this.selectedClips.add(clip.id);
          this._lastClickedClipId = clip.id;
          const sortBtn = document.getElementById('selectModeBtnSort');
          if (sortBtn) sortBtn.classList.add('active');
          this.renderClipGrid();
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
    this._applyLibGridMode();
    this._updateClipAreaFades();
  },

  _updateClipAreaFades() {
    const area = document.getElementById('clipArea');
    const ft = document.getElementById('clipFadeTop');
    const fb = document.getElementById('clipFadeBottom');
    if (!area || !ft || !fb) return;
    const update = () => {
      ft.classList.toggle('visible', area.scrollTop > 8);
      fb.classList.toggle('visible', area.scrollTop < area.scrollHeight - area.clientHeight - 8);
    };
    update();
    area.removeEventListener('scroll', this._clipAreaScrollHandler);
    this._clipAreaScrollHandler = update;
    area.addEventListener('scroll', update);
  },

  async quickDeleteClip(clipId) {
    await ucb.deleteClip(clipId);
    this.clips = this.clips.filter(c => c.id !== clipId);
    this.allClips = this.allClips.filter(c => c.id !== clipId);
    this.closeTab(clipId);
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.renderPinnedFolders();
    this.refreshExplorer();
    this.toast('Clip moved to Recycle Bin', 'info');
  },

  // ===== Editor Panel (bottom sub-panel) =====
  openEditor(clip) {
    if (!this.openTabs.find(t => t.id === clip.id)) this.openTabs.push(clip);
    this.activeTabId = clip.id;
    this.activeClip = clip;
    this.editorOpen = true;
    this.renderTabs();

    const resizeHandle = document.getElementById('panelResizeHandle');
    const canvas = document.getElementById('editorCanvas');
    const textView = document.getElementById('textClipView');
    const toolbar = document.getElementById('editorToolbar');
    const emptyState = document.getElementById('editorEmptyState');

    if (emptyState) emptyState.classList.add('hidden');
    document.querySelector('.editor-canvas-wrapper').style.display = '';
    document.querySelector('.editor-overlay-header').style.display = '';
    document.querySelector('.editor-action-bar').style.display = '';
    resizeHandle.classList.remove('hidden');
    document.getElementById('editorClipTitle').textContent = clip.title || 'Untitled';

    // Reset both views first
    canvas.style.display = 'none';
    canvas.classList.add('hidden');
    textView.style.display = 'none';
    textView.classList.add('hidden');
    textView.innerHTML = '';
    toolbar.style.display = 'none';

    // Show/hide Extract Text button based on clip type (images only)
    document.getElementById('edOcrBtn').style.display = (clip.type === 'image') ? '' : 'none';

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
    // Undo/redo stack for this text editor session (uses innerHTML to preserve formatting)
    this._textUndoStack = [this.escapeHtml(content)];
    this._textRedoStack = [];
    this._textUndoTimer = null;

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
        <span class="md-sep"></span>
        <button class="md-btn md-undo-btn" data-action="textUndo" title="Undo (Ctrl+Z)">↩</button>
        <button class="md-btn md-redo-btn" data-action="textRedo" title="Redo (Ctrl+Y)">↪</button>
      </div>
      <div class="md-editor" contenteditable="true">${this.escapeHtml(content)}</div>
    `;

    const editor = textView.querySelector('.md-editor');
    this._textSavedContent = content;
    editor.onblur = () => {
      this.saveTextClipContent(clip.id, editor.innerText);
      this._textSavedContent = editor.innerText;
      const ind = document.getElementById('unsavedIndicator');
      if (ind) ind.style.display = 'none';
    };

    // Track changes for undo/redo (debounced snapshot every 500ms of typing)
    editor.addEventListener('input', () => {
      const ind = document.getElementById('unsavedIndicator');
      if (ind) ind.style.display = (editor.innerText !== this._textSavedContent) ? '' : 'none';
      clearTimeout(this._textUndoTimer);
      this._textUndoTimer = setTimeout(() => {
        const current = editor.innerHTML;
        if (this._textUndoStack[this._textUndoStack.length - 1] !== current) {
          this._textUndoStack.push(current);
          this._textRedoStack = [];
          if (this._textUndoStack.length > 100) this._textUndoStack.shift();
        }
      }, 500);
    });

    // Keyboard shortcuts for undo/redo within text editor
    editor.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this._textEditorUndo(editor);
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this._textEditorRedo(editor);
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        this._textEditorRedo(editor);
      }
    });

    textView.querySelectorAll('.md-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        if (action === 'textUndo') {
          this._textEditorUndo(editor);
          return;
        } else if (action === 'textRedo') {
          this._textEditorRedo(editor);
          return;
        } else if (action === 'heading') {
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
        // Snapshot after formatting action so undo captures it
        setTimeout(() => {
          const current = editor.innerHTML;
          if (this._textUndoStack[this._textUndoStack.length - 1] !== current) {
            this._textUndoStack.push(current);
            this._textRedoStack = [];
            if (this._textUndoStack.length > 100) this._textUndoStack.shift();
          }
        }, 50);
        editor.focus();
      });
    });
  },

  _textEditorUndo(editor) {
    // Snapshot current state before undoing so we don't lose the latest
    const current = editor.innerHTML;
    if (this._textUndoStack[this._textUndoStack.length - 1] !== current) {
      this._textUndoStack.push(current);
    }
    if (this._textUndoStack.length > 1) {
      const popped = this._textUndoStack.pop();
      this._textRedoStack.push(popped);
      editor.innerHTML = this._textUndoStack[this._textUndoStack.length - 1];
    }
  },

  _textEditorRedo(editor) {
    if (this._textRedoStack.length > 0) {
      const next = this._textRedoStack.pop();
      this._textUndoStack.push(next);
      editor.innerHTML = next;
    }
  },

  closeEditor() {
    document.getElementById('panelResizeHandle').classList.add('hidden');
    // Reset text view so it doesn't linger when opening an image next
    const textView = document.getElementById('textClipView');
    textView.classList.add('hidden');
    textView.style.display = 'none';
    textView.innerHTML = '';
    // Hide editor content, show empty state
    const canvas = document.getElementById('editorCanvas');
    canvas.style.display = 'none'; canvas.classList.add('hidden');
    document.getElementById('editorToolbar').style.display = 'none';
    document.querySelector('.editor-overlay-header').style.display = 'none';
    document.querySelector('.editor-action-bar').style.display = 'none';
    document.querySelector('.editor-canvas-wrapper').style.display = 'none';
    const emptyState = document.getElementById('editorEmptyState');
    if (emptyState) emptyState.classList.remove('hidden');
    this.editorOpen = false;
    // Reset panel heights
    document.getElementById('topPanel').style.flex = '';
    document.getElementById('bottomPanel').style.flex = '';
  },

  // ===== Tabs =====
  closeTab(clipId) {
    this._hideTabPreview();
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
      const isActive = clip.id === this.activeTabId;
      const isSelected = this.selectedTabs.has(clip.id);
      tab.className = `tab ${isActive ? 'active' : ''} ${isSelected ? 'tab-selected' : ''}`;

      let icon = '';
      if (clip.type === 'image' && clip.filePath) {
        icon = `<img class="tab-icon" src="file://${clip.filePath.replace(/\\/g, '/')}" />`;
      } else {
        const tabIcons = {
          text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ac8fa" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
          link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff9500" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
          code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#af52de" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
        };
        icon = `<span class="tab-icon" style="display:flex;align-items:center;justify-content:center">${tabIcons[clip.type] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'}</span>`;
      }

      tab.innerHTML = `${icon}<span class="tab-title">${this.escapeHtml(this.midTruncate(clip.title || 'Untitled', 30))}</span><button class="tab-close">&times;</button>`;

      // Hover preview
      let hoverTimer = null;
      tab.addEventListener('mouseenter', (e) => {
        hoverTimer = setTimeout(() => {
          this._showTabPreview(clip, tab);
        }, 400);
      });
      tab.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimer);
        this._hideTabPreview();
      });

      tab.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) {
          // If this tab is in a multi-select, close all selected
          if (this.selectedTabs.has(clip.id) && this.selectedTabs.size > 1) {
            const toClose = [...this.selectedTabs];
            this.selectedTabs.clear();
            toClose.forEach(id => this.closeTab(id));
            return;
          }
          this.closeTab(clip.id);
          return;
        }
        if (e.shiftKey && this._lastClickedTabId) {
          // Shift-click: select range between last clicked and this tab
          const lastIdx = this.openTabs.findIndex(t => t.id === this._lastClickedTabId);
          const curIdx = this.openTabs.findIndex(t => t.id === clip.id);
          if (lastIdx >= 0 && curIdx >= 0) {
            const start = Math.min(lastIdx, curIdx);
            const end = Math.max(lastIdx, curIdx);
            for (let i = start; i <= end; i++) {
              this.selectedTabs.add(this.openTabs[i].id);
            }
          }
          this.renderTabs();
          return;
        }
        // Normal click: clear selection, activate tab
        this.selectedTabs.clear();
        this._lastClickedTabId = clip.id;
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

      // Make tab draggable so it can be dropped into pinned folders
      tab.draggable = true;
      tab.addEventListener('dragstart', (e) => {
        this._internalDrag = true;
        this._dragClipId = clip.id;
        e.dataTransfer.setData('text/plain', clip.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      tab.addEventListener('dragend', () => {
        this._internalDrag = false;
        this._dragClipId = null;
      });

      tabList.appendChild(tab);
    });
    // Update tab fade indicators
    this._updateTabFades();
  },

  _updateTabFades() {
    const tabList = document.getElementById('tabList');
    const fl = document.getElementById('tabFadeLeft');
    const fr = document.getElementById('tabFadeRight');
    if (!tabList || !fl || !fr) return;
    const update = () => {
      fl.classList.toggle('visible', tabList.scrollLeft > 4);
      fr.classList.toggle('visible', tabList.scrollLeft < tabList.scrollWidth - tabList.clientWidth - 4);
    };
    update();
    tabList.removeEventListener('scroll', update);
    tabList.addEventListener('scroll', update);
  },

  _updateLibTabFades() {
    const tabList = document.getElementById('libraryTabs');
    const fl = document.getElementById('libFadeLeft');
    const fr = document.getElementById('libFadeRight');
    if (!tabList || !fl || !fr) return;
    const update = () => {
      fl.classList.toggle('visible', tabList.scrollLeft > 4);
      const canScrollRight = tabList.scrollLeft < tabList.scrollWidth - tabList.clientWidth - 4;
      fr.classList.toggle('visible', canScrollRight);
      // Position right fade at the right edge of tabs container
      if (canScrollRight) {
        const header = tabList.parentElement;
        const tabsRect = tabList.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        fr.style.right = (headerRect.right - tabsRect.right) + 'px';
      }
    };
    update();
    tabList.removeEventListener('scroll', update);
    tabList.addEventListener('scroll', update);
  },

  showTabContextMenu(e, clip) {
    this.dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: 'Close', action: () => this.closeTab(clip.id) },
    ];
    if (this.selectedTabs.size > 1) {
      items.push({ label: `Close ${this.selectedTabs.size} Selected`, action: () => {
        const toClose = [...this.selectedTabs];
        this.selectedTabs.clear();
        toClose.forEach(id => this.closeTab(id));
      }});
    }
    items.push(
      { label: 'Close All Tabs', action: () => { this.openTabs = []; this.selectedTabs.clear(); this.activeTabId = null; this.activeClip = null; this.closeEditor(); this.renderTabs(); }},
      { label: 'Close Tabs to the Right', action: () => {
        const idx = this.openTabs.findIndex(t => t.id === clip.id);
        const removed = this.openTabs.splice(idx + 1);
        removed.forEach(t => { if (this.activeTabId === t.id) { this.activeTabId = clip.id; this.activeClip = clip; }});
        this.selectedTabs.clear();
        this.renderTabs();
      }}
    );

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

  explorerForwardHistory: [],

  refreshExplorer() {
    if (this.explorerPath) {
      ucb.listDirectory(this.explorerPath).then(entries => this.renderExplorerFiles(entries));
    }
  },

  async navigateExplorer(dirPath) {
    if (!dirPath) return;
    this.explorerHistory.push(this.explorerPath);
    this.explorerForwardHistory = [];
    this.explorerPath = dirPath;
    this.renderExplorerBreadcrumb();
    const entries = await ucb.listDirectory(dirPath);
    this.renderExplorerFiles(entries);
  },

  explorerGoBack() {
    if (this.explorerHistory.length === 0) return;
    this.explorerForwardHistory.push(this.explorerPath);
    const prev = this.explorerHistory.pop();
    this.explorerPath = prev;
    this.renderExplorerBreadcrumb();
    ucb.listDirectory(prev).then(entries => this.renderExplorerFiles(entries));
  },

  explorerGoForward() {
    if (this.explorerForwardHistory.length === 0) return;
    this.explorerHistory.push(this.explorerPath);
    const next = this.explorerForwardHistory.pop();
    this.explorerPath = next;
    this.renderExplorerBreadcrumb();
    ucb.listDirectory(next).then(entries => this.renderExplorerFiles(entries));
  },

  renderExplorerBreadcrumb() {
    const bc = document.getElementById('explorerBreadcrumb');
    bc.innerHTML = '';
    const parts = this.explorerPath.replace(/\\/g, '/').split('/').filter(Boolean);

    const startEdit = () => {
      bc.style.direction = 'ltr';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = this.explorerPath.replace(/\\/g, '/');
      input.style.cssText = 'flex:1;width:100%;font-size:10px;background:transparent;border:none;color:var(--text-primary);padding:0;outline:none;min-width:0';
      bc.innerHTML = '';
      bc.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const val = input.value.trim();
        if (val && val !== this.explorerPath.replace(/\\/g, '/')) {
          this.navigateExplorer(val);
        } else {
          this.renderExplorerBreadcrumb();
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); this.renderExplorerBreadcrumb(); }
      });
    };

    // Wrap all segments in an LTR container (breadcrumb is RTL to show end)
    const inner = document.createElement('span');
    inner.style.cssText = 'direction:ltr;display:inline-flex;align-items:center;white-space:nowrap';

    parts.forEach((part, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.textContent = ' › ';
        sep.style.cssText = 'opacity:0.4;pointer-events:none;margin:0 1px';
        inner.appendChild(sep);
      }
      const seg = document.createElement('span');
      seg.textContent = part;
      seg.style.cssText = 'cursor:pointer;border-radius:3px;padding:1px 3px;transition:background 0.15s';
      seg.addEventListener('mouseenter', () => { seg.style.background = 'var(--bg-hover)'; seg.style.color = 'var(--text-primary)'; });
      seg.addEventListener('mouseleave', () => { seg.style.background = ''; seg.style.color = ''; });
      const targetPath = parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isLast) this.navigateExplorer(targetPath);
      });
      if (isLast) {
        seg.addEventListener('dblclick', (e) => { e.stopPropagation(); startEdit(); });
      }
      inner.appendChild(seg);
    });
    bc.appendChild(inner);
    bc.title = 'Double-click to edit path';
    bc.addEventListener('dblclick', startEdit);
    // Update breadcrumb scroll fades
    this._updateBcFades();
  },

  _updateBcFades() {
    const bc = document.getElementById('explorerBreadcrumb');
    const fl = document.getElementById('bcFadeLeft');
    const fr = document.getElementById('bcFadeRight');
    if (!bc || !fl || !fr) return;
    const update = () => {
      // RTL: scrollLeft is negative or 0
      const maxScroll = bc.scrollWidth - bc.clientWidth;
      const scrollPos = Math.abs(bc.scrollLeft);
      fl.classList.toggle('visible', scrollPos < maxScroll - 4);
      fr.classList.toggle('visible', scrollPos > 4);
    };
    update();
    bc.removeEventListener('scroll', update);
    bc.addEventListener('scroll', update);
  },

  _libGridMode: 2,

  _applyLibGridMode() {
    const grid = document.getElementById('clipGrid');
    grid.classList.remove('grid-xs', 'grid-sm', 'grid-md', 'grid-lg');
    const modes = ['grid-xs', 'grid-sm', 'grid-md', 'grid-lg'];
    grid.classList.add(modes[this._libGridMode] || 'grid-sm');
  },

  _explorerThumbMode: 0,

  _explorerSortMode: 'name-asc',

  _sortExplorerEntries(entries) {
    const mode = this._explorerSortMode;
    // Directories always first
    const dirs = entries.filter(e => e.isDirectory);
    const files = entries.filter(e => !e.isDirectory);
    const sorter = (a, b) => {
      if (mode === 'name-asc') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (mode === 'name-desc') return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
      if (mode === 'date-desc') return (b.modified || 0) - (a.modified || 0);
      if (mode === 'date-asc') return (a.modified || 0) - (b.modified || 0);
      if (mode === 'size-desc') return (b.size || 0) - (a.size || 0);
      if (mode === 'size-asc') return (a.size || 0) - (b.size || 0);
      if (mode === 'type') return (a.extension || '').localeCompare(b.extension || '');
      return 0;
    };
    dirs.sort(sorter);
    files.sort(sorter);
    return [...dirs, ...files];
  },

  renderExplorerFiles(entries) {
    this._lastExplorerEntries = entries;
    this._explorerSelectedPaths = new Set();
    this._explorerLastClickIdx = -1;
    // Clean up previous rubber-band listeners
    if (this._explorerRubberCleanup) { this._explorerRubberCleanup(); this._explorerRubberCleanup = null; }
    const container = document.getElementById('explorerFileList');
    container.innerHTML = '';
    container.style.position = 'relative';
    container.className = 'explorer-file-list' + (this._explorerThumbMode === 1 ? ' thumb-grid' : this._explorerThumbMode === 2 ? ' thumb-grid-lg' : '');

    const sorted = this._sortExplorerEntries(entries);
    this._explorerSortedEntries = sorted;

    // Update status bar
    this._updateExplorerStatus(sorted.length);

    if (sorted.length === 0) {
      container.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted);text-align:center">Empty folder</div>';
      return;
    }

    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.xml', '.csv', '.log', '.py', '.java', '.c', '.cpp', '.h'];
    const showThumbs = this._explorerThumbMode > 0;

    sorted.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.dataset.idx = idx;
      item.dataset.path = entry.path;
      const isImage = !entry.isDirectory && imgExts.includes(entry.extension);
      const isText = !entry.isDirectory && textExts.includes(entry.extension);

      let icon = '';
      if (entry.isDirectory) {
        icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffcc00" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
      } else if (isImage) {
        icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4cd964" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      } else {
        icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5ac8fa" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      }

      const size = entry.isDirectory ? '' : this.formatSize(entry.size);

      if (showThumbs && isImage) {
        item.innerHTML = `<div class="file-item-thumb"><img src="file://${entry.path.replace(/\\/g, '/')}" loading="lazy" /></div><span class="file-item-name">${this.escapeHtml(this.midTruncate(entry.name, 24))}</span><span class="file-item-meta">${size}</span>`;
      } else if (showThumbs) {
        item.innerHTML = `<div class="file-item-thumb">${icon}</div><span class="file-item-name">${this.escapeHtml(this.midTruncate(entry.name, 24))}</span><span class="file-item-meta">${size}</span>`;
      } else {
        item.innerHTML = `<div class="file-item-icon">${icon}</div><span class="file-item-name">${this.escapeHtml(this.midTruncate(entry.name, 28))}</span><span class="file-item-meta">${size}</span>`;
      }

      // Right-click context menu
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this._explorerSelectedPaths.has(entry.path)) {
          this._explorerSelectSingle(idx);
        }
        this.showExplorerContextMenu(e, entry.path, entry.name, false, entry.isDirectory);
      });

      // Click = select; double-click = open
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          this._explorerToggleSelect(idx);
        } else if (e.shiftKey && this._explorerLastClickIdx >= 0) {
          this._explorerRangeSelect(this._explorerLastClickIdx, idx);
        } else {
          this._explorerSelectSingle(idx);
        }
      });

      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (entry.isDirectory) {
          this.navigateExplorer(entry.path);
        } else if (isImage || isText) {
          // Open in editor
          const fakeClip = { id: '__explorer__', type: isImage ? 'image' : 'text', filePath: entry.path, title: entry.name, content: '' };
          if (isText) {
            // Read text content and open
            ucb.readTextFile(entry.path).then(text => {
              fakeClip.content = text;
              this.openEditor(fakeClip);
            }).catch(() => ucb.openInExplorer(entry.path));
          } else {
            this.openEditor(fakeClip);
          }
        } else {
          ucb.openInExplorer(entry.path);
        }
      });

      // Drag (directories are drop targets)
      if (entry.isDirectory) {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
          this._internalDrag = true;
          this._dragFolderPath = entry.path;
          this._dragFolderName = entry.name;
          e.dataTransfer.setData('text/x-folder-path', entry.path);
          e.dataTransfer.effectAllowed = 'copyMove';
        });
        item.addEventListener('dragend', () => { this._internalDrag = false; this._dragFolderPath = null; this._dragFolderName = null; document.getElementById('dropZone').classList.add('hidden'); });
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
      }

      container.appendChild(item);
    });

    // Click empty area to deselect
    container.addEventListener('click', (e) => {
      if (e.target === container) {
        this._explorerClearSelection();
      }
    });

    // Rubber-band (drag-to-select) on empty area
    this._bindExplorerRubberBand(container, sorted);
  },

  // -- Explorer selection helpers --
  _explorerSelectSingle(idx) {
    this._explorerSelectedPaths = new Set();
    const entry = this._explorerSortedEntries[idx];
    if (entry) this._explorerSelectedPaths.add(entry.path);
    this._explorerLastClickIdx = idx;
    this._explorerUpdateSelectionUI();
  },
  _explorerToggleSelect(idx) {
    const entry = this._explorerSortedEntries[idx];
    if (!entry) return;
    if (this._explorerSelectedPaths.has(entry.path)) {
      this._explorerSelectedPaths.delete(entry.path);
    } else {
      this._explorerSelectedPaths.add(entry.path);
    }
    this._explorerLastClickIdx = idx;
    this._explorerUpdateSelectionUI();
  },
  _explorerRangeSelect(fromIdx, toIdx) {
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    this._explorerSelectedPaths = new Set();
    for (let i = lo; i <= hi; i++) {
      const entry = this._explorerSortedEntries[i];
      if (entry) this._explorerSelectedPaths.add(entry.path);
    }
    this._explorerUpdateSelectionUI();
  },
  _explorerClearSelection() {
    this._explorerSelectedPaths = new Set();
    this._explorerLastClickIdx = -1;
    this._explorerUpdateSelectionUI();
  },
  _explorerUpdateSelectionUI() {
    const container = document.getElementById('explorerFileList');
    if (!container) return;
    container.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('selected', this._explorerSelectedPaths.has(el.dataset.path));
    });
    const total = (this._explorerSortedEntries || []).length;
    this._updateExplorerStatus(total);
  },
  _updateExplorerStatus(total) {
    const countEl = document.getElementById('explorerFileCount');
    const selEl = document.getElementById('explorerSelectionCount');
    if (countEl) countEl.textContent = `${total} item${total !== 1 ? 's' : ''}`;
    if (selEl) {
      const sel = (this._explorerSelectedPaths || new Set()).size;
      selEl.textContent = sel > 0 ? `${sel} selected` : '';
    }
  },
  _bindExplorerRubberBand(container, sorted) {
    let rect = null, startX = 0, startY = 0, active = false;
    const onDown = (e) => {
      if (e.target !== container && e.target.closest('.file-item')) return;
      if (e.button !== 0) return;
      active = true;
      const cr = container.getBoundingClientRect();
      startX = e.clientX - cr.left + container.scrollLeft;
      startY = e.clientY - cr.top + container.scrollTop;
      rect = document.createElement('div');
      rect.className = 'explorer-selection-rect';
      container.appendChild(rect);
      if (!e.ctrlKey && !e.shiftKey) this._explorerSelectedPaths = new Set();
    };
    const onMove = (e) => {
      if (!active || !rect) return;
      const cr = container.getBoundingClientRect();
      const curX = e.clientX - cr.left + container.scrollLeft;
      const curY = e.clientY - cr.top + container.scrollTop;
      const x = Math.min(startX, curX), y = Math.min(startY, curY);
      const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
      rect.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;position:absolute;border:1px solid rgba(10,132,255,0.6);background:rgba(10,132,255,0.1);pointer-events:none;z-index:5`;
      // Hit-test items
      const rr = { left: x, top: y, right: x + w, bottom: y + h };
      container.querySelectorAll('.file-item').forEach(el => {
        const er = { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight };
        const hit = !(er.right < rr.left || er.left > rr.right || er.bottom < rr.top || er.top > rr.bottom);
        const path = el.dataset.path;
        if (hit) this._explorerSelectedPaths.add(path);
        else if (!e.ctrlKey) this._explorerSelectedPaths.delete(path);
        el.classList.toggle('selected', this._explorerSelectedPaths.has(path));
      });
      this._updateExplorerStatus(sorted.length);
    };
    const onUp = () => {
      active = false;
      if (rect) { rect.remove(); rect = null; }
    };
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Store cleanup ref
    this._explorerRubberCleanup = () => {
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
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
      items += `<button class="context-menu-item" data-action="open-in-library">Open in Library</button>`;
    }
    items += `<button class="context-menu-item" data-action="copy-path">Copy Path</button>`;
    menu.innerHTML = items;

    menu.addEventListener('click', async (ev) => {
      const action = ev.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'open-explorer') ucb.openInExplorer(filePath);
      else if (action === 'add-pin') {
        const folderName = name || filePath.replace(/\\/g, '/').split('/').pop();
        await ucb.createFolder({ name: folderName, color: randomFolderColor(), pinned: true, path: filePath });
        this.folders = await ucb.getFolders();
        this.renderPinnedFolders();
        this.renderQuickAccess();
        this.toast(`Pinned "${folderName}"`, 'success');
      } else if (action === 'open-in-library') {
        this.openFolderInLibrary(filePath, name);
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

  async showQrCode() {
    if (!this.activeClip) return;
    this.toast('Generating QR code...', 'info');
    try {
      const result = await ucb.generateQR(this.activeClip.id);
      const qrImg = result?.qrDataUrl || result;
      if (qrImg) {
        Dialogs.show(`
          <div class="modal-header"><h2>QR Code</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
          <p style="color:var(--text-secondary);font-size:11px;margin-bottom:12px">Scan this QR code from another device to access this clip. <strong>Both devices must be on the same Wi-Fi network.</strong></p>
          <div style="text-align:center;padding:16px"><img src="${qrImg}" style="width:200px;height:200px;image-rendering:pixelated;border-radius:8px" /></div>
          <div class="btn-row"><button class="btn btn-secondary" onclick="Dialogs.close()">Close</button></div>
        `);
      } else {
        this.toast('Failed to generate QR code', 'error');
      }
    } catch (e) { console.error('QR error:', e); this.toast('QR code error', 'error'); }
  },

  async generateShareLink() {
    if (!this.activeClip) return;
    this.toast('Generating link...', 'info');
    try {
      const result = await ucb.createShareLink(this.activeClip.id, 60);
      const url = typeof result === 'string' ? result : (result && result.url);
      if (url) {
        Dialogs.show(`
          <div class="modal-header"><h2>Temporary Link</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
          <p style="color:var(--text-secondary);font-size:11px;margin-bottom:12px">This link will expire in 1 hour. <strong>The other device must be on the same Wi-Fi network</strong> to access it.</p>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <input type="text" class="form-input" id="shareLinkInput" value="${url}" readonly style="flex:1;font-size:11px" />
            <button class="btn btn-primary" id="copyShareLinkBtn">Copy</button>
          </div>
          <div class="btn-row"><button class="btn btn-secondary" onclick="Dialogs.close()">Close</button></div>
        `);
        document.getElementById('copyShareLinkBtn').addEventListener('click', () => {
          navigator.clipboard.writeText(url);
          this.toast('Link copied', 'success');
        });
      } else {
        this.toast('Failed to generate link', 'error');
      }
    } catch (e) { console.error('Share link error:', e); this.toast('Link generation error', 'error'); }
  },

  _simpleDiff(oldText, newText) {
    const oldLines = (oldText || '').split('\n');
    const newLines = (newText || '').split('\n');
    const result = [];
    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
      const ol = i < oldLines.length ? oldLines[i] : null;
      const nl = i < newLines.length ? newLines[i] : null;
      if (ol === nl) {
        result.push({ type: 'same', text: ol });
      } else {
        if (ol !== null) result.push({ type: 'removed', text: ol });
        if (nl !== null) result.push({ type: 'added', text: nl });
      }
    }
    return result;
  },

  async showClipHistory() {
    if (!this.activeClip) return;
    const history = await ucb.getClipHistory(this.activeClip.id);
    if (!history || history.length === 0) {
      this.toast('No edit history for this clip', 'info');
      return;
    }
    const isImage = this.activeClip.type === 'image';
    const rows = history.map((h, i) => {
      const date = new Date(h.editedAt).toLocaleString();
      if (isImage && h.filePath) {
        const src = `file://${h.filePath.replace(/\\/g, '/')}`;
        return `<div class="history-item" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:6px">
          <img src="${src}" style="width:80px;height:56px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border);flex-shrink:0;background:var(--bg-tertiary)" />
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;color:var(--text-muted)">${date}</div>
          </div>
          <button class="btn btn-secondary history-restore-btn" data-idx="${i}" style="font-size:10px;padding:3px 8px;flex-shrink:0">Restore</button>
        </div>`;
      } else if (h.content) {
        const currentContent = this.activeClip.content || '';
        const diff = this._simpleDiff(h.content, currentContent);
        const diffHtml = diff.slice(0, 8).map(d => {
          const escaped = this.escapeHtml(d.text || '');
          if (d.type === 'added') return `<div style="background:rgba(52,199,89,0.12);color:var(--accent-green);padding:1px 4px;border-radius:2px;font-size:10px;font-family:monospace;white-space:pre-wrap">+ ${escaped}</div>`;
          if (d.type === 'removed') return `<div style="background:rgba(255,69,58,0.12);color:var(--accent-red);padding:1px 4px;border-radius:2px;font-size:10px;font-family:monospace;white-space:pre-wrap">- ${escaped}</div>`;
          return `<div style="color:var(--text-muted);padding:1px 4px;font-size:10px;font-family:monospace;white-space:pre-wrap;opacity:0.5">&nbsp; ${escaped}</div>`;
        }).join('');
        const moreLines = diff.length > 8 ? `<div style="font-size:9px;color:var(--text-muted);padding:2px 4px">... ${diff.length - 8} more lines</div>` : '';
        return `<div class="history-item" style="padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:10px;color:var(--text-muted)">${date}</div>
            <button class="btn btn-secondary history-restore-btn" data-idx="${i}" style="font-size:10px;padding:3px 8px;flex-shrink:0">Restore</button>
          </div>
          <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px;max-height:120px;overflow-y:auto">${diffHtml}${moreLines}</div>
        </div>`;
      }
      return '';
    }).join('');

    Dialogs.show(`
      <div class="modal-header"><h2>Edit History</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
      <p style="color:var(--text-secondary);font-size:11px;margin-bottom:12px">${history.length} version(s) saved. Click Restore to revert.</p>
      <div style="max-height:400px;overflow-y:auto">${rows}</div>
      <div class="btn-row"><button class="btn btn-secondary" onclick="Dialogs.close()">Close</button></div>
    `);

    document.querySelectorAll('.history-restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const entry = history[idx];
        if (entry.content) {
          await ucb.updateClip(this.activeClip.id, { content: entry.content });
          this.activeClip.content = entry.content;
        }
        Dialogs.close();
        this.openEditor(this.activeClip);
        this.toast('Version restored', 'success');
      });
    });
  },

  async deleteActiveClip() {
    if (!this.activeClip) return;
    await ucb.deleteClip(this.activeClip.id);
    this.clips = this.clips.filter(c => c.id !== this.activeClip.id);
    this.allClips = this.allClips.filter(c => c.id !== this.activeClip.id);
    this.closeTab(this.activeClip.id);
    this.closeEditor();
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.renderPinnedFolders();
    this.refreshExplorer();
    this.toast('Clip moved to Recycle Bin', 'info');
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
    } else if (action.type === 'move') {
      await ucb.moveClipToFolder(action.clipId, action.oldFolderId);
      await this.loadData();
      this.renderPinnedFolders();
      this.refreshExplorer();
    } else if (action.type === 'bulkMove') {
      for (const e of action.entries) {
        await ucb.moveClipToFolder(e.clipId, e.oldFolderId);
      }
      await this.loadData();
      this.renderPinnedFolders();
      this.refreshExplorer();
    }
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.renderLibraryTabs();
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
    } else if (action.type === 'move') {
      await ucb.moveClipToFolder(action.clipId, action.newFolderId);
      await this.loadData();
      this.renderPinnedFolders();
      this.refreshExplorer();
    } else if (action.type === 'bulkMove') {
      for (const e of action.entries) {
        await ucb.moveClipToFolder(e.clipId, action.newFolderId);
      }
      await this.loadData();
      this.renderPinnedFolders();
      this.refreshExplorer();
    }
    this.renderClipGrid();
    this.renderLeftSidebar();
    this.renderLibraryTabs();
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
    // Save version before updating
    const clip = this.clips.find(c => c.id === clipId) || this.allClips.find(c => c.id === clipId);
    if (clip && clip.content && clip.content !== content) {
      await ucb.saveClipVersion(clipId, clip.content, clip.filePath || null);
    }
    await ucb.updateClip(clipId, { content, editedAt: Date.now() });
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
      // Hide the app first so it doesn't appear in the screenshot
      await ucb.minimize();
      // Small delay to let the window fully hide
      await new Promise(r => setTimeout(r, 300));
      await ucb.takeScreenshot();
      // Bring app back into focus after screenshot
      await new Promise(r => setTimeout(r, 500));
      ucb.showWindow();
    } catch (e) { console.error('Screenshot error:', e); }
  },

  _toggleSearchFilterDropdown(btnId, inputId, mode) {
    const btn = document.getElementById(btnId);
    const existing = btn.parentElement.querySelector('.search-filter-dropdown');
    if (existing) { existing.remove(); btn.classList.remove('active'); return; }
    btn.classList.add('active');
    const parent = btn.parentElement;
    parent.style.position = 'relative';
    const dd = document.createElement('div');
    dd.className = 'search-filter-dropdown';
    dd.innerHTML = `
      <div class="filter-row"><label>Type</label><select id="_filterType"><option value="">All</option><option value="image">Images</option><option value="text">Text</option><option value="link">Links</option><option value="code">Code</option></select></div>
      <div class="filter-row"><label>Date</label><select id="_filterDate"><option value="">Any time</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option></select></div>
      <div class="filter-row"><label>Favorite</label><select id="_filterFav"><option value="">Any</option><option value="yes">Favorites only</option></select></div>
      <div class="filter-actions"><button class="btn btn-primary" id="_filterApply" style="font-size:10px;padding:4px 12px;flex:1">Apply</button><button class="btn btn-secondary" id="_filterClear" style="font-size:10px;padding:4px 12px">Clear</button></div>
    `;
    parent.appendChild(dd);
    dd.querySelector('#_filterApply').addEventListener('click', () => {
      const type = dd.querySelector('#_filterType').value;
      const date = dd.querySelector('#_filterDate').value;
      const fav = dd.querySelector('#_filterFav').value;
      let parts = [];
      if (type) parts.push(`type:${type}`);
      if (date) parts.push(`date:${date}`);
      if (fav) parts.push('is:fav');
      const input = document.getElementById(inputId);
      const existingText = input.value.replace(/\b(type|date|is):\S+/g, '').trim();
      input.value = (parts.join(' ') + (existingText ? ' ' + existingText : '')).trim();
      input.dispatchEvent(new Event('input'));
      dd.remove(); btn.classList.remove('active');
    });
    dd.querySelector('#_filterClear').addEventListener('click', () => {
      const input = document.getElementById(inputId);
      input.value = '';
      input.dispatchEvent(new Event('input'));
      dd.remove(); btn.classList.remove('active');
    });
    // Close on outside click
    const closeHandler = (e) => {
      if (!dd.contains(e.target) && e.target !== btn) {
        dd.remove(); btn.classList.remove('active');
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  },

  handleRecentSearch(query) {
    // Filter both recent clips lists in the left sidebar
    const q = query.toLowerCase().trim();
    ['#recentImagesList', '#recentTextsList'].forEach(sel => {
      document.querySelectorAll(`${sel} .recent-clip-item`).forEach(item => {
        const title = (item.querySelector('.rc-title')?.textContent || '').toLowerCase();
        const meta = (item.querySelector('.rc-meta')?.textContent || '').toLowerCase();
        item.style.display = (!q || title.includes(q) || meta.includes(q)) ? '' : 'none';
      });
    });
  },

  handleLibrarySearch(query) {
    if (!query.trim()) {
      this.clips = [...this.allClips];
    } else {
      const q = query.toLowerCase();
      this.clips = this.allClips.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.content || '').toLowerCase().includes(q) ||
        (c.extractedText || '').toLowerCase().includes(q)
      );
    }
    this.renderClipGrid();
  },

  handleExplorerSearch(query) {
    const items = document.querySelectorAll('#explorerFileList .file-item');
    const q = query.toLowerCase();
    items.forEach(item => {
      const name = (item.querySelector('.file-item-name')?.textContent || '').toLowerCase();
      item.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
  },

  async handleSearch(query) {
    if (!query.trim()) {
      this.clips = [...this.allClips];
      this.hideSortBarNav();
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

  // ===== Action History =====
  showActionHistory() {
    // Show a chronological view of all clips sorted by most recent
    const recent = [...this.allClips].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50);
    if (recent.length === 0) { this.toast('No clip history yet', 'info'); return; }

    const rows = recent.map((clip, i) => {
      const date = new Date(clip.createdAt).toLocaleString();
      const typeIcons = {
        image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
        text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
      };
      const typeIcon = typeIcons[clip.type] || typeIcons.text;
      const preview = this.escapeHtml((clip.title || clip.content || 'Untitled').substring(0, 60));
      const folder = this.folders.find(f => f.id === clip.folderId);
      const folderLabel = folder ? `<span style="font-size:9px;color:var(--accent-green);margin-left:4px;display:inline-flex;align-items:center;gap:2px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> ${this.escapeHtml(folder.name)}</span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background 0.15s" class="history-row" data-idx="${i}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
        <span style="flex-shrink:0;display:flex;align-items:center">${typeIcon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preview}${folderLabel}</div>
          <div style="font-size:9px;color:var(--text-muted)">${date}${clip.source ? ' · ' + clip.source : ''}</div>
        </div>
      </div>`;
    }).join('');

    Dialogs.show(`
      <div class="modal-header"><h2>Clipboard History</h2><button class="modal-close" onclick="Dialogs.close()">&times;</button></div>
      <p style="color:var(--text-secondary);font-size:11px;margin-bottom:12px">Last ${recent.length} clips, newest first. Click to open.</p>
      <div style="max-height:400px;overflow-y:auto">${rows}</div>
      <div class="btn-row"><button class="btn btn-secondary" onclick="Dialogs.close()">Close</button></div>
    `);

    document.querySelectorAll('.history-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.idx);
        const clip = recent[idx];
        if (clip) { Dialogs.close(); this.openEditor(clip); }
      });
    });
  },

  // ===== Settings =====
  toggleSettings() {
    const overlay = document.getElementById('settingsOverlay');
    if (!overlay.classList.contains('hidden')) {
      this.closeSettings();
      return;
    }
    this.showSettings();
  },

  showSettings() {
    document.getElementById('settingsOverlay').classList.remove('hidden');
    this.renderSettings();
  },

  closeSettings() {
    document.getElementById('settingsOverlay').classList.add('hidden');
  },

  async renderSettings() {
    const view = document.getElementById('settingsContent');
    const settings = await ucb.getSettings() || {};
    const aiSettings = await ucb.getAISettings() || {};
    const hotkeys = await ucb.getHotkeys() || {};
    const defaultHotkeys = await ucb.getDefaultHotkeys() || {};
    const defaultDataDir = await ucb.getAppFolder().catch(() => '') || '';

    view.innerHTML = `
      <div class="settings-section">
        <h3>Display</h3>
        <div class="setting-row"><label>UI Scale</label><div style="display:flex;gap:8px;align-items:center"><input type="range" id="settUiScale" min="60" max="150" step="5" value="${Math.round((parseInt(settings.uiScale)||100)/5)*5}" class="modern-slider" style="width:120px" /><span id="settUiScaleLabel" style="font-size:11px;color:var(--text-secondary);min-width:36px">${Math.round((parseInt(settings.uiScale)||100)/5)*5}%</span></div></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Ctrl+= to zoom in, Ctrl+- to zoom out, Ctrl+0 to reset.</p>
      </div>
      <div class="settings-section">
        <h3>General</h3>
        <div class="setting-row"><label>Clipboard Monitoring</label><label class="toggle"><input type="checkbox" id="settClipMonitor" ${settings.clipboardMonitoring === 'true' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Open on startup</label><label class="toggle"><input type="checkbox" id="settOpenOnStartup" ${settings.openOnStartup !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Minimize to tray</label><label class="toggle"><input type="checkbox" id="settMinToTray" ${settings.minimizeToTray !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Auto-OCR screenshots</label><label class="toggle"><input type="checkbox" id="settAutoOcr" ${settings.autoOcr === 'true' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Automatically extract text from screenshots so you can search text inside images.</p>
        <div class="setting-row"><label>Intercept screenshots</label><label class="toggle"><input type="checkbox" id="settInterceptScreenshots" ${settings.interceptScreenshots !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">When enabled, screenshots are only saved inside the app. When disabled, a copy is also saved to your Windows Pictures/Screenshots folder.</p>
      </div>
      <div class="settings-section">
        <h3>Clipboard Capture</h3>
        <div class="setting-row"><label>Save text clips</label><label class="toggle"><input type="checkbox" id="settSaveText" ${settings.saveTextClips !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row" id="rowNotifyText" style="padding-left:16px"><label>Notify on text clip</label><label class="toggle"><input type="checkbox" id="settNotifyText" ${settings.notifyTextClips !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row"><label>Save image clips</label><label class="toggle"><input type="checkbox" id="settSaveImage" ${settings.saveImageClips !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <div class="setting-row" id="rowNotifyImage" style="padding-left:16px"><label>Notify on image clip</label><label class="toggle"><input type="checkbox" id="settNotifyImage" ${settings.notifyImageClips !== 'false' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Notification options are only available when the parent save option is enabled.</p>
      </div>
      <div class="settings-section">
        <h3>Keyboard Shortcuts</h3>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Click a field, then press the key combination you want. Use Ctrl, Shift, Alt as modifiers. Leave empty to disable.</p>
        <div class="setting-row"><label>Toggle app</label><div style="display:flex;gap:4px;align-items:center"><input type="text" class="form-input hotkey-input" id="settHotkeyToggleApp" value="${this._hotkeyDisplay(hotkeys.toggleApp)}" data-accelerator="${hotkeys.toggleApp || ''}" readonly style="width:160px;font-size:11px;cursor:pointer" placeholder="Click to set..." /><button class="btn btn-secondary hotkey-clear-btn" data-target="settHotkeyToggleApp" style="font-size:10px;padding:4px 6px" title="Clear">&times;</button></div></div>
        <div class="setting-row"><label>Screenshot</label><div style="display:flex;gap:4px;align-items:center"><input type="text" class="form-input hotkey-input" id="settHotkeyScreenshot" value="${this._hotkeyDisplay(hotkeys.screenshot)}" data-accelerator="${hotkeys.screenshot || ''}" readonly style="width:160px;font-size:11px;cursor:pointer" placeholder="Click to set..." /><button class="btn btn-secondary hotkey-clear-btn" data-target="settHotkeyScreenshot" style="font-size:10px;padding:4px 6px" title="Clear">&times;</button></div></div>
        <div class="setting-row"><label>Screenshot selection</label><div style="display:flex;gap:4px;align-items:center"><input type="text" class="form-input hotkey-input" id="settHotkeyScreenshotSelection" value="${this._hotkeyDisplay(hotkeys.screenshotSelection)}" data-accelerator="${hotkeys.screenshotSelection || ''}" readonly style="width:160px;font-size:11px;cursor:pointer" placeholder="Click to set..." /><button class="btn btn-secondary hotkey-clear-btn" data-target="settHotkeyScreenshotSelection" style="font-size:10px;padding:4px 6px" title="Clear">&times;</button></div></div>
        <button class="btn btn-secondary" id="resetHotkeysBtn" style="font-size:10px;margin-top:4px">Reset to Defaults</button>
      </div>
      <div class="settings-section">
        <h3>Storage</h3>
        <div class="setting-row"><label>Data location</label><div style="display:flex;gap:8px;align-items:center"><input type="text" class="form-input" id="settDataDir" value="${settings.dataDirectory || defaultDataDir}" placeholder="${defaultDataDir}" style="width:200px;font-size:11px" readonly /><button class="btn btn-secondary" id="changeDataDirBtn" style="font-size:10px;padding:5px 8px">Change</button></div></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Changing the directory starts fresh in the new location. Use "Move" to migrate all existing clips.</p>
        <div class="setting-row"><label>Move all clips to new folder</label><button class="btn btn-secondary" id="moveDataDirBtn" style="font-size:11px">Move Clips Folder</button></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Copies all your clips and data to a new location, then switches to it.</p>
      </div>
      <div class="settings-section">
        <h3>Edit History</h3>
        <div class="setting-row"><label>Auto-cleanup older than</label><div style="display:flex;gap:8px;align-items:center"><select class="form-select" id="settHistoryDays" style="width:120px"><option value="7" ${(settings.historyCleanupDays||'30')==='7'?'selected':''}>7 days</option><option value="14" ${(settings.historyCleanupDays||'30')==='14'?'selected':''}>14 days</option><option value="30" ${(settings.historyCleanupDays||'30')==='30'?'selected':''}>30 days</option><option value="90" ${(settings.historyCleanupDays||'30')==='90'?'selected':''}>90 days</option><option value="0" ${(settings.historyCleanupDays||'30')==='0'?'selected':''}>Never</option></select></div></div>
        <div class="setting-row"><label>Clean up old versions now</label><button class="btn btn-secondary" id="cleanupHistoryBtn" style="font-size:11px">Cleanup Now</button></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Edit versions are saved automatically when you modify a clip. Old versions are cleaned up on the schedule above.</p>
      </div>
      <div class="settings-section">
        <h3>Experimental</h3>
        <div class="setting-row"><label>Hidden Folder</label><label class="toggle"><input type="checkbox" id="settHiddenFolder" ${settings.experimentalHiddenFolder === 'true' ? 'checked' : ''} /><span class="toggle-slider"></span></label></div>
        <p style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px 0">Enable the Hidden Folder feature (protected by Windows Hello or passcode). Shows a "Hidden" button in the sidebar.</p>
        <div class="setting-row" id="rowPasscode" style="${settings.experimentalHiddenFolder === 'true' ? '' : 'display:none'}"><label>Fallback passcode</label><button class="btn btn-secondary" onclick="Dialogs.showSetPasscodeDialog()">Set / Change</button></div>
      </div>
      <div class="settings-section">
        <h3>AI Provider</h3>
        <div class="form-group"><label class="form-label">Provider</label><select class="form-select" id="settAIProvider"><option value="none" ${aiSettings.provider==='none'?'selected':''}>None</option><option value="openai" ${aiSettings.provider==='openai'?'selected':''}>OpenAI</option><option value="ollama" ${aiSettings.provider==='ollama'?'selected':''}>Ollama</option><option value="custom" ${aiSettings.provider==='custom'?'selected':''}>Custom</option></select></div>
        <div id="ollamaSetupGroup" style="display:${aiSettings.provider==='ollama'?'block':'none'}">
          <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:12px;font-weight:600;color:var(--text-primary)">Ollama Status</span>
              <span id="ollamaStatusBadge" style="font-size:10px;padding:2px 8px;border-radius:var(--radius-sm);background:var(--bg-hover);color:var(--text-muted)">Checking...</span>
            </div>
            <div id="ollamaSetupActions"></div>
            <div id="ollamaProgress" style="display:none;margin-top:8px">
              <div style="background:var(--bg-elevated);border-radius:4px;height:6px;overflow:hidden"><div id="ollamaProgressBar" style="height:100%;background:var(--accent-green);width:0%;transition:width 0.3s"></div></div>
              <p id="ollamaProgressText" style="font-size:10px;color:var(--text-muted);margin-top:4px"></p>
            </div>
          </div>
        </div>
        <div class="form-group" id="aiKeyGroup" style="display:${aiSettings.provider==='openai'||aiSettings.provider==='custom'?'block':'none'}"><label class="form-label">API Key</label><input type="password" class="form-input" id="settAIKey" value="${aiSettings.apiKey||''}" placeholder="sk-..." /></div>
        <div class="form-group"><label class="form-label">Model</label><input type="text" class="form-input" id="settAIModel" value="${aiSettings.model||''}" placeholder="gpt-4o-mini" /></div>
        <div class="form-group" id="aiEndpointGroup" style="display:${aiSettings.provider==='ollama'||aiSettings.provider==='custom'?'block':'none'}"><label class="form-label">Endpoint</label><input type="text" class="form-input" id="settAIEndpoint" value="${aiSettings.endpoint||''}" placeholder="http://127.0.0.1:11434" /></div>
        <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
          <button class="btn btn-secondary" id="resetAIBtn" style="font-size:10px;color:var(--accent-red)">Disable AI Features</button>
          <p style="font-size:10px;color:var(--text-muted);margin-top:4px">Sets the AI provider to None. To uninstall Ollama from your system, use Windows Settings &gt; Apps.</p>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button></div>
    `;

    // UI Scale slider — preview label on input, apply only on mouseup
    const scaleSlider = document.getElementById('settUiScale');
    scaleSlider.addEventListener('input', () => {
      document.getElementById('settUiScaleLabel').textContent = scaleSlider.value + '%';
    });
    scaleSlider.addEventListener('change', () => {
      this._setZoom(parseInt(scaleSlider.value), true);
    });

    // Dependent save/notify toggles for clipboard capture
    const saveTextCb = document.getElementById('settSaveText');
    const notifyTextCb = document.getElementById('settNotifyText');
    const saveImageCb = document.getElementById('settSaveImage');
    const notifyImageCb = document.getElementById('settNotifyImage');
    const updateNotifyDeps = () => {
      notifyTextCb.disabled = !saveTextCb.checked;
      if (!saveTextCb.checked) notifyTextCb.checked = false;
      document.getElementById('rowNotifyText').style.opacity = saveTextCb.checked ? '1' : '0.4';
      notifyImageCb.disabled = !saveImageCb.checked;
      if (!saveImageCb.checked) notifyImageCb.checked = false;
      document.getElementById('rowNotifyImage').style.opacity = saveImageCb.checked ? '1' : '0.4';
    };
    saveTextCb.addEventListener('change', updateNotifyDeps);
    saveImageCb.addEventListener('change', updateNotifyDeps);
    updateNotifyDeps();

    // Hotkey input bindings
    this._bindHotkeyInput('settHotkeyToggleApp');
    this._bindHotkeyInput('settHotkeyScreenshot');
    this._bindHotkeyInput('settHotkeyScreenshotSelection');
    // Hotkey clear (×) buttons
    document.querySelectorAll('.hotkey-clear-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const el = document.getElementById(targetId);
        if (el) { el.value = ''; el.dataset.accelerator = ''; }
      });
    });
    document.getElementById('resetHotkeysBtn').addEventListener('click', async () => {
      const defs = await ucb.getDefaultHotkeys();
      ['settHotkeyToggleApp','settHotkeyScreenshot','settHotkeyScreenshotSelection'].forEach((id, i) => {
        const key = ['toggleApp','screenshot','screenshotSelection'][i];
        const el = document.getElementById(id);
        el.value = this._hotkeyDisplay(defs[key]);
        el.dataset.accelerator = defs[key] || '';
      });
      this.toast('Hotkeys reset to defaults', 'info');
    });

    document.getElementById('settHiddenFolder').addEventListener('change', (e) => {
      document.getElementById('rowPasscode').style.display = e.target.checked ? '' : 'none';
      const hiddenBtn = document.getElementById('hiddenFolderBtn');
      if (hiddenBtn) hiddenBtn.classList.toggle('hidden', !e.target.checked);
    });

    document.getElementById('settAIProvider').addEventListener('change', (e) => {
      const v = e.target.value;
      document.getElementById('aiKeyGroup').style.display = (v==='openai'||v==='custom')?'block':'none';
      document.getElementById('aiEndpointGroup').style.display = (v==='ollama'||v==='custom')?'block':'none';
      document.getElementById('ollamaSetupGroup').style.display = v==='ollama'?'block':'none';
      if (v === 'ollama') this._checkOllamaStatus();
    });
    // Check Ollama status on load if provider is ollama
    if (aiSettings.provider === 'ollama') this._checkOllamaStatus();
    document.getElementById('changeDataDirBtn').addEventListener('click', async () => {
      const d = await ucb.chooseDirectory();
      if (d) document.getElementById('settDataDir').value = d;
    });
    document.getElementById('cleanupHistoryBtn').addEventListener('click', async () => {
      const days = parseInt(document.getElementById('settHistoryDays').value) || 30;
      await ucb.cleanupOldHistory(days);
      this.toast(`Edit history older than ${days} days cleaned up`, 'success');
    });
    document.getElementById('moveDataDirBtn').addEventListener('click', async () => {
      const newDir = await ucb.chooseDirectory();
      if (!newDir) return;
      const ok = await Dialogs.confirm('Move clips folder?', `All clips and data will be copied to:\n${newDir}\n\nThis may take a moment.`);
      if (!ok) return;
      this.toast('Moving clips folder...', 'info');
      try {
        const result = await ucb.moveDataDirectory(newDir);
        if (result && result.success) {
          document.getElementById('settDataDir').value = newDir;
          this.toast('Clips folder moved successfully', 'success');
        } else {
          this.toast(result?.error || 'Failed to move clips folder', 'error');
        }
      } catch (e) {
        console.error('Move data dir error:', e);
        this.toast('Error moving clips folder', 'error');
      }
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      await ucb.saveSettings({
        clipboardMonitoring: document.getElementById('settClipMonitor').checked?'true':'false',
        openOnStartup: document.getElementById('settOpenOnStartup').checked?'true':'false',
        minimizeToTray: document.getElementById('settMinToTray').checked?'true':'false',
        autoOcr: document.getElementById('settAutoOcr').checked?'true':'false',
        saveTextClips: document.getElementById('settSaveText').checked?'true':'false',
        notifyTextClips: document.getElementById('settNotifyText').checked?'true':'false',
        saveImageClips: document.getElementById('settSaveImage').checked?'true':'false',
        notifyImageClips: document.getElementById('settNotifyImage').checked?'true':'false',
        dataDirectory: document.getElementById('settDataDir').value,
        historyCleanupDays: document.getElementById('settHistoryDays').value,
        uiScale: document.getElementById('settUiScale').value,
        hotkeyToggleApp: document.getElementById('settHotkeyToggleApp').dataset.accelerator || '',
        hotkeyScreenshot: document.getElementById('settHotkeyScreenshot').dataset.accelerator || '',
        hotkeyScreenshotSelection: document.getElementById('settHotkeyScreenshotSelection').dataset.accelerator || '',
        interceptScreenshots: document.getElementById('settInterceptScreenshots').checked?'true':'false',
        experimentalHiddenFolder: document.getElementById('settHiddenFolder').checked?'true':'false'
      });
      // Auto-cleanup history based on setting
      const cleanupDays = parseInt(document.getElementById('settHistoryDays').value);
      if (cleanupDays > 0) await ucb.cleanupOldHistory(cleanupDays);
      await ucb.saveAISettings({
        provider: document.getElementById('settAIProvider').value,
        apiKey: document.getElementById('settAIKey').value,
        model: document.getElementById('settAIModel').value,
        endpoint: document.getElementById('settAIEndpoint').value
      });
      this.toast('Settings saved', 'success');
    });
    document.getElementById('resetAIBtn').addEventListener('click', async () => {
      document.getElementById('settAIProvider').value = 'none';
      document.getElementById('settAIKey').value = '';
      document.getElementById('settAIModel').value = '';
      document.getElementById('settAIEndpoint').value = '';
      await ucb.saveAISettings({ provider: 'none', apiKey: '', model: '', endpoint: '' });
      document.getElementById('ollamaSetupGroup').style.display = 'none';
      document.getElementById('aiKeyGroup').style.display = 'none';
      document.getElementById('aiEndpointGroup').style.display = 'none';
      this.toast('AI features disabled', 'info');
    });
  },

  // ===== Hotkey Helpers =====
  _hotkeyDisplay(accelerator) {
    if (!accelerator) return '';
    return accelerator
      .replace(/CommandOrControl/g, 'Ctrl')
      .replace(/\+/g, ' + ');
  },

  _bindHotkeyInput(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // Mark as actively setting a keybind so handleKeyboard ignores keys
    el.addEventListener('focus', () => { el.style.outline = '2px solid var(--accent-green)'; this._settingKeybind = true; });
    el.addEventListener('blur', () => { el.style.outline = ''; this._settingKeybind = false; });
    el.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Escape clears the binding
      if (e.key === 'Escape') {
        el.value = '';
        el.dataset.accelerator = '';
        el.blur();
        return;
      }
      // Backspace clears the keybind
      if (e.key === 'Backspace') {
        el.value = '';
        el.dataset.accelerator = '';
        el.blur();
        return;
      }
      // Ignore lone modifier keys
      if (['Control','Shift','Alt','Meta'].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      // Map special keys
      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toUpperCase();
      else if (key === 'PrintScreen') key = 'PrintScreen';
      else if (key.startsWith('Arrow')) key = key;
      parts.push(key);
      const accelerator = parts.join('+');
      el.dataset.accelerator = accelerator;
      el.value = this._hotkeyDisplay(accelerator);
      el.blur();
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
      { label: 'QR Code', action: () => { this.activeClip = clip; this.showQrCode(); } },
      { label: 'Generate Link', action: () => { this.activeClip = clip; this.generateShareLink(); } },
      'separator',
      { label: 'Delete', danger: true, action: async () => {
        await ucb.deleteClip(clip.id); this.allClips = this.allClips.filter(c => c.id !== clip.id); this.clips = this.clips.filter(c => c.id !== clip.id);
        this.closeTab(clip.id); this.renderClipGrid(); this.renderLeftSidebar(); this.renderPinnedFolders(); this.renderLibraryTabs(); this.refreshExplorer(); this.toast('Clip moved to Recycle Bin', 'info');
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
      { label: 'Rename', action: async () => {
        const newName = prompt('Rename folder:', folder.name);
        if (newName && newName !== folder.name) {
          await ucb.updateFolder(folder.id, { name: newName });
          await this.loadData(); this.renderPinnedFolders(); this.renderQuickAccess();
          this.toast('Folder renamed', 'success');
        }
      }},
      { label: 'Change Color', action: async () => {
        const input = document.createElement('input');
        input.type = 'color'; input.value = folder.color || '#4cd964';
        input.style.cssText = 'position:fixed;top:-9999px';
        document.body.appendChild(input);
        input.addEventListener('input', async () => {
          await ucb.updateFolder(folder.id, { color: input.value });
          await this.loadData(); this.renderPinnedFolders(); this.renderQuickAccess();
        });
        input.addEventListener('change', () => input.remove());
        input.click();
      }},
      { label: 'Open in File Explorer', action: () => { ucb.openInExplorer(folder.path || this.explorerHomePath); }},
      { label: 'Browse in Sidebar', action: () => { if (folder.path) this.navigateExplorer(folder.path); }},
      { label: 'Browse in Library', action: () => { if (folder.path) this.openFolderInLibrary(folder.path, folder.name); }},
      { label: 'Copy Path', action: () => { navigator.clipboard.writeText(folder.path || ''); this.toast('Path copied', 'success'); }},
      { label: 'Delete Folder', danger: true, action: async () => {
        const confirmed = await Dialogs.confirm('Delete Folder', `Are you sure you want to delete "${folder.name}"? Clips inside will be unassigned, not deleted.`);
        if (!confirmed) return;
        await ucb.deleteFolder(folder.id); await this.loadData(); this.renderPinnedFolders(); this.renderQuickAccess(); this.refreshExplorer(); this.toast('Folder deleted', 'info');
      }}
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
    // Don't handle keys while setting keybinds
    if (this._settingKeybind) return;
    // Zoom: Ctrl+= / Ctrl+- / Ctrl+0
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      this._adjustZoom(10);
      return;
    }
    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      this._adjustZoom(-10);
      return;
    }
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      this._setZoom(100);
      return;
    }

    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
      if (this.editorOpen && this.activeClip?.type === 'image') Editor.undo();
      else { e.preventDefault(); this.performUndo(); }
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (this.editorOpen && this.activeClip?.type === 'image') Editor.redo();
      else { e.preventDefault(); this.performRedo(); }
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
      const settingsOverlay = document.getElementById('settingsOverlay');
      if (!settingsOverlay.classList.contains('hidden')) { this.closeSettings(); return; }
      if (this.editorOpen) this.closeEditor();
      else if (this.selectMode) this.toggleSelectMode();
      this.dismissContextMenu();
    }
  },

  _showTabPreview(clip, tabEl) {
    this._hideTabPreview();
    const preview = document.createElement('div');
    preview.className = 'tab-preview';
    preview.id = 'tabPreview';

    let content = '';
    if (clip.type === 'image' && clip.filePath) {
      content = `<img src="file://${clip.filePath.replace(/\\/g, '/')}" />`;
    } else {
      const text = (clip.content || clip.title || 'Empty').substring(0, 200);
      content = `<div class="tab-preview-text">${this.escapeHtml(text)}</div>`;
    }
    preview.innerHTML = `${content}<div class="tab-preview-title">${this.escapeHtml(clip.title || 'Untitled')}</div>`;

    document.body.appendChild(preview);
    const rect = tabEl.getBoundingClientRect();
    const previewH = preview.offsetHeight;
    preview.style.left = rect.left + 'px';
    preview.style.top = Math.max(0, rect.top - previewH - 6) + 'px';
  },

  _hideTabPreview() {
    const existing = document.getElementById('tabPreview');
    if (existing) existing.remove();
  },

  _adjustZoom(delta) {
    const current = this._currentZoom || 100;
    this._setZoom(Math.max(60, Math.min(150, current + delta)));
  },

  _setZoom(percent, skipSave) {
    this._currentZoom = percent;
    ucb.setZoomFactor(percent / 100);
    // Sync the settings slider if open
    const slider = document.getElementById('settUiScale');
    if (slider) {
      slider.value = percent;
      const label = document.getElementById('settUiScaleLabel');
      if (label) label.textContent = percent + '%';
    }
    if (!skipSave) ucb.saveSettings({ uiScale: String(percent) }).catch(() => {});
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

  toastWithUndo(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.style.cssText = 'display:flex;align-items:center;gap:8px';
    toast.innerHTML = `<span style="flex:1">${this.escapeHtml(message)}</span><button style="background:rgba(255,255,255,0.2);border:none;color:inherit;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600">Undo</button>`;
    toast.querySelector('button').addEventListener('click', () => {
      this.performUndo();
      toast.remove();
    });
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => toast.remove(), 300); }, 5000);
  },

  escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; },

  midTruncate(str, maxLen = 28) {
    if (!str || str.length <= maxLen) return str;
    const endLen = Math.max(8, Math.floor(maxLen * 0.35));
    const startLen = maxLen - endLen - 1;
    return str.substring(0, startLen) + '…' + str.substring(str.length - endLen);
  },

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
  },

  async _checkOllamaStatus() {
    const badge = document.getElementById('ollamaStatusBadge');
    const actions = document.getElementById('ollamaSetupActions');
    if (!badge || !actions) return;

    badge.textContent = 'Checking...';
    badge.style.background = 'var(--bg-hover)';
    badge.style.color = 'var(--text-muted)';
    actions.innerHTML = '';

    try {
      const status = await ucb.ollamaStatus();

      if (!status.installed) {
        badge.textContent = 'Not Installed';
        badge.style.background = 'rgba(255,69,58,0.15)';
        badge.style.color = 'var(--accent-red)';
        actions.innerHTML = `
          <p style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">Ollama is required for local AI features. Click below to download and install it automatically.</p>
          <p style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Download size: ~300 MB</p>
          <button class="btn btn-primary" id="ollamaInstallBtn" style="font-size:11px">Download &amp; Install Ollama</button>
        `;
        document.getElementById('ollamaInstallBtn').addEventListener('click', () => this._installOllama());
      } else if (!status.running) {
        badge.textContent = 'Installed (Not Running)';
        badge.style.background = 'rgba(255,159,10,0.15)';
        badge.style.color = 'var(--accent-orange)';
        actions.innerHTML = `
          <p style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">Ollama is installed but not running.</p>
          <button class="btn btn-primary" id="ollamaStartBtn" style="font-size:11px">Start Ollama</button>
        `;
        document.getElementById('ollamaStartBtn').addEventListener('click', async () => {
          this.toast('Starting Ollama...', 'info');
          const ok = await ucb.ollamaStart();
          if (ok) { this.toast('Ollama started', 'success'); this._checkOllamaStatus(); }
          else this.toast('Failed to start Ollama', 'error');
        });
      } else {
        const modelList = status.models.length > 0 ? status.models.join(', ') : 'None';
        badge.textContent = 'Running';
        badge.style.background = 'rgba(52,199,89,0.15)';
        badge.style.color = 'var(--accent-green)';
        actions.innerHTML = `
          <p style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Models: ${modelList}</p>
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
            <input type="text" class="form-input" id="ollamaPullModelInput" placeholder="e.g. llava, llama3" style="font-size:11px;padding:4px 8px;flex:1" />
            <button class="btn btn-secondary" id="ollamaPullBtn" style="font-size:11px">Pull Model</button>
          </div>
          <p style="font-size:9px;color:var(--text-muted);margin-top:6px">Typical model sizes: llava ~4.7 GB · llama3 ~4.7 GB · mistral ~4.1 GB · phi3 ~2.2 GB · gemma ~5.0 GB</p>
        `;
        document.getElementById('ollamaPullBtn').addEventListener('click', async () => {
          const model = document.getElementById('ollamaPullModelInput').value.trim();
          if (!model) return;
          this._showOllamaProgress(`Pulling ${model}...`, 0);
          ucb.onOllamaPullProgress((p) => {
            const text = p.status || '';
            const pct = p.completed && p.total ? Math.round((p.completed / p.total) * 100) : 0;
            this._showOllamaProgress(text, pct);
          });
          try {
            await ucb.ollamaPullModel(model);
            this._hideOllamaProgress();
            this.toast(`Model "${model}" pulled successfully`, 'success');
            this._checkOllamaStatus();
          } catch (e) {
            this._hideOllamaProgress();
            this.toast(`Failed to pull model: ${e.message}`, 'error');
          }
        });
      }
    } catch (e) {
      badge.textContent = 'Error';
      badge.style.background = 'rgba(255,69,58,0.15)';
      badge.style.color = 'var(--accent-red)';
      actions.innerHTML = `<p style="font-size:11px;color:var(--accent-red)">Failed to check Ollama status: ${e.message}</p>`;
    }
  },

  async _installOllama() {
    this._showOllamaProgress('Downloading Ollama...', 0);
    ucb.onOllamaDownloadProgress((p) => {
      this._showOllamaProgress(`Downloading... ${p.percent}%`, p.percent);
    });
    try {
      await ucb.ollamaDownload();
      this._showOllamaProgress('Installing Ollama...', 100);
      await ucb.ollamaInstall();
      this._hideOllamaProgress();
      this.toast('Ollama installed successfully!', 'success');
      // Auto-start after install
      await ucb.ollamaStart();
      this._checkOllamaStatus();
    } catch (e) {
      this._hideOllamaProgress();
      this.toast(`Ollama install failed: ${e.message}`, 'error');
      this._checkOllamaStatus();
    }
  },

  _showOllamaProgress(text, percent) {
    const prog = document.getElementById('ollamaProgress');
    const bar = document.getElementById('ollamaProgressBar');
    const txt = document.getElementById('ollamaProgressText');
    if (!prog) return;
    prog.style.display = 'block';
    if (bar) bar.style.width = percent + '%';
    if (txt) txt.textContent = text;
  },

  _hideOllamaProgress() {
    const prog = document.getElementById('ollamaProgress');
    if (prog) prog.style.display = 'none';
  },

  _getDateLabel(timestamp) {
    if (!timestamp) return 'Unknown';
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / 86400000);
    const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (isSameDay(date, now)) return 'Today';
    if (isSameDay(date, yesterday)) return 'Yesterday';
    if (diffDays < 7) return 'This Week';
    if (diffDays < 14) return 'Last Week';
    if (diffDays < 30) return 'This Month';
    if (diffDays < 60) return 'Last Month';
    if (diffDays < 180) return '2–6 Months Ago';
    if (diffDays < 365) return '6–12 Months Ago';
    return 'Over a Year Ago';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
