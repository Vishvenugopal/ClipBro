// ===== Universal Clipboard - Image Editor =====

const Editor = {
  canvas: null,
  ctx: null,
  currentClip: null,
  originalImage: null,
  tool: 'select',
  color: '#ff3b30',
  lineWidth: 3,
  isDrawing: false,
  drawHistory: [],
  historyIndex: -1,
  startX: 0,
  startY: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  cropMode: false,
  cropRect: null,
  textOverlay: null,

  init() {
    this.canvas = document.getElementById('editorCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.bindToolbar();
    this.bindCanvas();
  },

  bindToolbar() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'undo') { this.undo(); return; }
        if (tool === 'redo') { this.redo(); return; }
        this.setTool(tool);
      });
    });

    document.getElementById('toolColor').addEventListener('input', (e) => {
      this.color = e.target.value;
    });

    document.getElementById('toolSize').addEventListener('input', (e) => {
      this.lineWidth = parseInt(e.target.value);
    });
  },

  bindCanvas() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => { this.isDrawing = false; });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.scale = Math.max(0.1, Math.min(5, this.scale * delta));
      this.redraw();
    });
  },

  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (tool === 'crop') {
      this.startCropMode();
    } else {
      this.endCropMode();
    }

    // Set cursor
    const cursors = {
      select: 'default',
      crop: 'crosshair',
      pen: 'crosshair',
      highlighter: 'crosshair',
      arrow: 'crosshair',
      rectangle: 'crosshair',
      text: 'text',
      blur: 'crosshair',
      eraser: 'crosshair'
    };
    this.canvas.style.cursor = cursors[tool] || 'crosshair';
  },

  loadImage(clip) {
    if (!this.canvas) this.init();
    this.currentClip = clip;
    this.drawHistory = [];
    this.historyIndex = -1;
    this.scale = 1;
    this.cropMode = false;

    const img = new Image();
    img.onload = () => {
      this.originalImage = img;

      // Fit image to canvas area
      const wrapper = this.canvas.parentElement;
      const maxW = wrapper.clientWidth - 40;
      const maxH = wrapper.clientHeight - 40;
      const ratio = Math.min(maxW / img.width, maxH / img.height, 1);

      this.canvas.width = img.width;
      this.canvas.height = img.height;
      this.canvas.style.width = Math.floor(img.width * ratio) + 'px';
      this.canvas.style.height = Math.floor(img.height * ratio) + 'px';
      this.scale = ratio;

      this.ctx.drawImage(img, 0, 0);
      this.saveToHistory();
      this.setTool('select');
    };
    img.onerror = () => {
      console.error('Failed to load image:', clip.filePath);
    };
    img.src = `file://${clip.filePath.replace(/\\/g, '/')}`;
  },

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  },

  onMouseDown(e) {
    if (this.tool === 'select') return;
    if (this.cropMode && this.tool === 'crop') {
      this.cropStartDrag(e);
      return;
    }

    const pos = this.getCanvasCoords(e);
    this.isDrawing = true;
    this.startX = pos.x;
    this.startY = pos.y;

    if (this.tool === 'pen' || this.tool === 'highlighter' || this.tool === 'eraser') {
      this.ctx.beginPath();
      this.ctx.moveTo(pos.x, pos.y);
    }

    if (this.tool === 'text') {
      this.showTextInput(e.clientX, e.clientY, pos.x, pos.y);
      this.isDrawing = false;
    }
  },

  onMouseMove(e) {
    if (!this.isDrawing) return;

    if (this.cropMode && this.tool === 'crop') {
      this.cropDragMove(e);
      return;
    }

    const pos = this.getCanvasCoords(e);

    if (this.tool === 'pen') {
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    } else if (this.tool === 'highlighter') {
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.lineWidth * 4;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalAlpha = 0.3;
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    } else if (this.tool === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.lineWidth = this.lineWidth * 3;
      this.ctx.lineCap = 'round';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      this.ctx.globalCompositeOperation = 'source-over';
    } else if (this.tool === 'arrow' || this.tool === 'rectangle' || this.tool === 'blur') {
      // Preview: redraw from history then draw shape
      this.restoreFromHistory();
      this.drawShape(this.startX, this.startY, pos.x, pos.y);
    }
  },

  onMouseUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.cropMode && this.tool === 'crop') {
      this.cropDragEnd(e);
      return;
    }

    const pos = this.getCanvasCoords(e);

    if (this.tool === 'arrow' || this.tool === 'rectangle' || this.tool === 'blur') {
      this.restoreFromHistory();
      this.drawShape(this.startX, this.startY, pos.x, pos.y);
    }

    if (this.tool !== 'select') {
      this.saveToHistory();
    }

    this.ctx.beginPath();
  },

  drawShape(x1, y1, x2, y2) {
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';

    if (this.tool === 'arrow') {
      // Line
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 15;
      this.ctx.beginPath();
      this.ctx.moveTo(x2, y2);
      this.ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      this.ctx.moveTo(x2, y2);
      this.ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      this.ctx.stroke();
    } else if (this.tool === 'rectangle') {
      this.ctx.beginPath();
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (this.tool === 'blur') {
      // Pixelate region
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      if (rw > 0 && rh > 0) {
        const pixelSize = 10;
        const imageData = this.ctx.getImageData(rx, ry, rw, rh);
        const data = imageData.data;
        for (let py = 0; py < rh; py += pixelSize) {
          for (let px = 0; px < rw; px += pixelSize) {
            const i = (py * rw + px) * 4;
            const r = data[i], g = data[i+1], b = data[i+2];
            for (let dy = 0; dy < pixelSize && py+dy < rh; dy++) {
              for (let dx = 0; dx < pixelSize && px+dx < rw; dx++) {
                const j = ((py+dy) * rw + (px+dx)) * 4;
                data[j] = r; data[j+1] = g; data[j+2] = b;
              }
            }
          }
        }
        this.ctx.putImageData(imageData, rx, ry);
      }
    }
  },

  // ===== Text Tool =====
  showTextInput(screenX, screenY, canvasX, canvasY) {
    this.removeTextInput();
    const wrapper = this.canvas.parentElement;
    const rect = this.canvas.getBoundingClientRect();

    const div = document.createElement('div');
    div.className = 'text-input-overlay';
    div.style.left = (screenX - rect.left + wrapper.offsetLeft) + 'px';
    div.style.top = (screenY - rect.top + wrapper.offsetTop) + 'px';

    const textarea = document.createElement('textarea');
    textarea.style.color = this.color;
    textarea.style.fontSize = (this.lineWidth * 5) + 'px';
    textarea.placeholder = 'Type text...';
    div.appendChild(textarea);

    wrapper.appendChild(div);
    textarea.focus();
    this.textOverlay = div;

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = textarea.value.trim();
        if (text) {
          this.ctx.font = `${this.lineWidth * 5}px sans-serif`;
          this.ctx.fillStyle = this.color;
          this.ctx.fillText(text, canvasX, canvasY + this.lineWidth * 5);
          this.saveToHistory();
        }
        this.removeTextInput();
      }
      if (e.key === 'Escape') {
        this.removeTextInput();
      }
    });
  },

  removeTextInput() {
    if (this.textOverlay) {
      this.textOverlay.remove();
      this.textOverlay = null;
    }
  },

  // ===== Crop Mode =====
  startCropMode() {
    this.cropMode = true;
    this.cropRect = {
      x: this.canvas.width * 0.1,
      y: this.canvas.height * 0.1,
      w: this.canvas.width * 0.8,
      h: this.canvas.height * 0.8
    };
    this.drawCropOverlay();
    this.showCropActions();
  },

  endCropMode() {
    this.cropMode = false;
    this.cropRect = null;
    const existing = document.querySelector('.crop-actions-bar');
    if (existing) existing.remove();
    this.redraw();
  },

  drawCropOverlay() {
    this.redraw();
    const { x, y, w, h } = this.cropRect;

    // Darken outside
    this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
    this.ctx.fillRect(0, 0, this.canvas.width, y);
    this.ctx.fillRect(0, y + h, this.canvas.width, this.canvas.height - y - h);
    this.ctx.fillRect(0, y, x, h);
    this.ctx.fillRect(x + w, y, this.canvas.width - x - w, h);

    // Border
    this.ctx.strokeStyle = '#4cd964';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(x, y, w, h);

    // Corner handles
    const hs = 8;
    this.ctx.fillStyle = '#4cd964';
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([cx, cy]) => {
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, hs, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // Grid lines (rule of thirds)
    this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    this.ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(x + w * i / 3, y);
      this.ctx.lineTo(x + w * i / 3, y + h);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + h * i / 3);
      this.ctx.lineTo(x + w, y + h * i / 3);
      this.ctx.stroke();
    }
  },

  showCropActions() {
    const existing = document.querySelector('.crop-actions-bar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.className = 'crop-actions-bar';
    bar.style.cssText = 'position:absolute;bottom:70px;left:50%;transform:translateX(-50%);z-index:20;display:flex;gap:8px;';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = 'Apply Crop';
    applyBtn.addEventListener('click', () => this.applyCrop());

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { this.setTool('select'); });

    bar.appendChild(applyBtn);
    bar.appendChild(cancelBtn);
    this.canvas.parentElement.appendChild(bar);
  },

  cropStartDrag(e) {
    this.cropDragging = true;
    const pos = this.getCanvasCoords(e);
    this.cropDragStart = { x: pos.x, y: pos.y };
    this.cropRectStart = { ...this.cropRect };
  },

  cropDragMove(e) {
    if (!this.cropDragging) return;
    const pos = this.getCanvasCoords(e);
    const dx = pos.x - this.cropDragStart.x;
    const dy = pos.y - this.cropDragStart.y;
    this.cropRect.x = Math.max(0, Math.min(this.canvas.width - this.cropRect.w, this.cropRectStart.x + dx));
    this.cropRect.y = Math.max(0, Math.min(this.canvas.height - this.cropRect.h, this.cropRectStart.y + dy));
    this.drawCropOverlay();
  },

  cropDragEnd() {
    this.cropDragging = false;
  },

  applyCrop() {
    if (!this.cropRect) return;
    const { x, y, w, h } = this.cropRect;
    const imageData = this.ctx.getImageData(x, y, w, h);

    this.canvas.width = w;
    this.canvas.height = h;

    const wrapper = this.canvas.parentElement;
    const maxW = wrapper.clientWidth - 40;
    const maxH = wrapper.clientHeight - 40;
    const ratio = Math.min(maxW / w, maxH / h, 1);
    this.canvas.style.width = Math.floor(w * ratio) + 'px';
    this.canvas.style.height = Math.floor(h * ratio) + 'px';

    this.ctx.putImageData(imageData, 0, 0);
    this.saveToHistory();
    this.setTool('select');
  },

  // ===== History (Undo/Redo) =====
  saveToHistory() {
    const data = this.canvas.toDataURL('image/png');
    this.drawHistory = this.drawHistory.slice(0, this.historyIndex + 1);
    this.drawHistory.push(data);
    this.historyIndex = this.drawHistory.length - 1;
    // Limit history
    if (this.drawHistory.length > 50) {
      this.drawHistory.shift();
      this.historyIndex--;
    }
  },

  restoreFromHistory() {
    if (this.historyIndex < 0) return;
    const img = new Image();
    img.onload = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(img, 0, 0);
    };
    img.src = this.drawHistory[this.historyIndex];
  },

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    const img = new Image();
    img.onload = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(img, 0, 0);
    };
    img.src = this.drawHistory[this.historyIndex];
  },

  redo() {
    if (this.historyIndex >= this.drawHistory.length - 1) return;
    this.historyIndex++;
    const img = new Image();
    img.onload = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(img, 0, 0);
    };
    img.src = this.drawHistory[this.historyIndex];
  },

  redraw() {
    if (this.historyIndex >= 0 && this.drawHistory[this.historyIndex]) {
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(img, 0, 0);
      };
      img.src = this.drawHistory[this.historyIndex];
    } else if (this.originalImage) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.originalImage, 0, 0);
    }
  },

  // ===== Save =====
  async saveEdits() {
    if (!this.currentClip) return;
    const dataUrl = this.canvas.toDataURL('image/png');
    await ucb.saveEditedClip(this.currentClip.id, dataUrl);
    App.toast('Edits saved', 'success');
  }
};
