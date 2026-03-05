// ===== Universal Clipboard - Image Editor =====

const Editor = {
  canvas: null,
  ctx: null,
  currentClip: null,
  originalImage: null,
  tool: 'hand',
  color: '#ff3b30',
  lineWidth: 3,
  opacity: 1,
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
  _historyImageCache: null,

  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  displayScale: 1,

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
        if (tool === 'zoom-in') { this.zoomView(1.2); return; }
        if (tool === 'zoom-out') { this.zoomView(0.8); return; }
        this.setTool(tool);
      });
    });

    // Color palette
    this._initColorPalette();

    document.getElementById('toolSize').addEventListener('input', (e) => {
      this.lineWidth = parseInt(e.target.value);
    });

    const opacitySlider = document.getElementById('toolOpacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        this.opacity = parseInt(e.target.value) / 100;
      });
    }
  },

  _initColorPalette() {
    const COLORS = [
      '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#ffffff',
      '#ff0000','#ff4444','#ff6600','#ff9900','#ffcc00','#ffff00','#ccff00','#66ff00',
      '#00ff00','#00ff66','#00ffcc','#00ffff','#00ccff','#0099ff','#0066ff','#0000ff',
      '#6600ff','#9900ff','#cc00ff','#ff00ff','#ff0099','#ff0066','#ff3366','#ff6699',
      '#990000','#994400','#996600','#999900','#669900','#009900','#009966','#006699',
      '#003399','#000099','#330099','#660099','#990066','#993366','#663333','#996633'
    ];
    const palette = document.getElementById('colorPalette');
    const swatch = document.getElementById('activeColorSwatch');
    if (!palette || !swatch) return;

    COLORS.forEach(c => {
      const el = document.createElement('div');
      el.className = 'cp-swatch';
      el.style.background = c;
      if (c === this.color) el.classList.add('active');
      el.addEventListener('click', () => {
        this.color = c;
        swatch.style.background = c;
        palette.querySelectorAll('.cp-swatch').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
        palette.classList.remove('open');
      });
      palette.appendChild(el);
    });

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      palette.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!palette.contains(e.target) && e.target !== swatch) {
        palette.classList.remove('open');
      }
    });
  },

  bindCanvas() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => { this.isDrawing = false; this.isPanning = false; });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Pinch-to-zoom (trackpad) or Ctrl+scroll — reduced sensitivity
        const factor = e.deltaY > 0 ? 0.95 : 1.05;
        this.zoomView(factor);
      } else {
        // Two-finger pan (trackpad) or regular scroll
        this.offsetX -= e.deltaX;
        this.offsetY -= e.deltaY;
        this._applyViewTransform();
      }
    }, { passive: false });
  },

  zoomView(factor) {
    this.displayScale = Math.max(0.1, Math.min(5, this.displayScale * factor));
    this._applyViewTransform();
  },

  _applyViewTransform() {
    const w = Math.floor(this.canvas.width * this.displayScale);
    const h = Math.floor(this.canvas.height * this.displayScale);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px)`;
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
      crop: 'crosshair',
      pen: 'crosshair',
      highlighter: 'crosshair',
      arrow: 'crosshair',
      rectangle: 'crosshair',
      text: 'text',
      blur: 'crosshair',
      eraser: 'crosshair',
      hand: 'grab'
    };
    this.canvas.style.cursor = cursors[tool] || 'crosshair';
  },

  loadImage(clip) {
    if (!this.canvas) this.init();
    this.currentClip = clip;
    this.drawHistory = [];
    this.historyIndex = -1;
    this.scale = 1;
    this.displayScale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.cropMode = false;
    this.canvas.style.transform = '';

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
      this.displayScale = ratio;
      this.canvas.style.width = Math.floor(img.width * ratio) + 'px';
      this.canvas.style.height = Math.floor(img.height * ratio) + 'px';

      this.ctx.drawImage(img, 0, 0);
      this.saveToHistory();
      this.setTool('hand');
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
    if (this.tool === 'hand') {
      this.isPanning = true;
      this.panStartX = e.clientX - this.offsetX;
      this.panStartY = e.clientY - this.offsetY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
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
    if (this.isPanning && this.tool === 'hand') {
      this.offsetX = e.clientX - this.panStartX;
      this.offsetY = e.clientY - this.panStartY;
      this._applyViewTransform();
      return;
    }
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
      this.ctx.globalAlpha = Math.min(this.opacity, 0.4);
      this.ctx.globalCompositeOperation = 'multiply';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
    } else if (this.tool === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.lineWidth = this.lineWidth * 3;
      this.ctx.lineCap = 'round';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      this.ctx.globalCompositeOperation = 'source-over';
    } else if (this.tool === 'arrow' || this.tool === 'rectangle' || this.tool === 'blur') {
      // Preview: redraw from history cache then draw shape
      this.restoreFromHistorySync();
      this.drawShape(this.startX, this.startY, pos.x, pos.y);
    }
  },

  onMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      if (this.tool === 'hand') this.canvas.style.cursor = 'grab';
      return;
    }
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.cropMode && this.tool === 'crop') {
      this.cropDragEnd(e);
      return;
    }

    const pos = this.getCanvasCoords(e);

    if (this.tool === 'arrow' || this.tool === 'rectangle' || this.tool === 'blur') {
      this.restoreFromHistorySync();
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
      // Pixelate region - clamp to canvas bounds
      let rx = Math.max(0, Math.floor(Math.min(x1, x2)));
      let ry = Math.max(0, Math.floor(Math.min(y1, y2)));
      let rw = Math.floor(Math.abs(x2 - x1));
      let rh = Math.floor(Math.abs(y2 - y1));
      // Clamp to canvas dimensions
      if (rx + rw > this.canvas.width) rw = this.canvas.width - rx;
      if (ry + rh > this.canvas.height) rh = this.canvas.height - ry;
      if (rw > 2 && rh > 2) {
        const pixelSize = Math.max(6, Math.floor(Math.min(rw, rh) / 12));
        const imageData = this.ctx.getImageData(rx, ry, rw, rh);
        const data = imageData.data;
        for (let py = 0; py < rh; py += pixelSize) {
          for (let px = 0; px < rw; px += pixelSize) {
            // Average the block instead of using single pixel
            let totalR = 0, totalG = 0, totalB = 0, count = 0;
            for (let dy = 0; dy < pixelSize && py+dy < rh; dy++) {
              for (let dx = 0; dx < pixelSize && px+dx < rw; dx++) {
                const i = ((py+dy) * rw + (px+dx)) * 4;
                totalR += data[i]; totalG += data[i+1]; totalB += data[i+2];
                count++;
              }
            }
            const avgR = Math.round(totalR / count);
            const avgG = Math.round(totalG / count);
            const avgB = Math.round(totalB / count);
            for (let dy = 0; dy < pixelSize && py+dy < rh; dy++) {
              for (let dx = 0; dx < pixelSize && px+dx < rw; dx++) {
                const j = ((py+dy) * rw + (px+dx)) * 4;
                data[j] = avgR; data[j+1] = avgG; data[j+2] = avgB;
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

    // Clamp text placement to within canvas bounds
    canvasX = Math.max(0, Math.min(this.canvas.width - 10, canvasX));
    canvasY = Math.max(0, Math.min(this.canvas.height - 10, canvasY));

    // Clamp overlay position within canvas visual bounds
    let overlayLeft = screenX - rect.left + wrapper.offsetLeft;
    let overlayTop = screenY - rect.top + wrapper.offsetTop;
    overlayLeft = Math.max(0, Math.min(rect.width - 40, overlayLeft));
    overlayTop = Math.max(0, Math.min(rect.height - 20, overlayTop));

    const div = document.createElement('div');
    div.className = 'text-input-overlay';
    div.style.left = overlayLeft + 'px';
    div.style.top = overlayTop + 'px';

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
          const fontSize = this.lineWidth * 5;
          this.ctx.font = `${fontSize}px sans-serif`;
          this.ctx.fillStyle = this.color;
          // Clamp so text doesn't go outside canvas
          const metrics = this.ctx.measureText(text);
          const drawX = Math.min(canvasX, this.canvas.width - metrics.width);
          const drawY = Math.max(fontSize, Math.min(canvasY + fontSize, this.canvas.height));
          this.ctx.fillText(text, Math.max(0, drawX), drawY);
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
    // Use sync restore so overlay draws on top of the image immediately
    this.restoreFromHistorySync();
    if (!this.cropRect) return;
    const { x, y, w, h } = this.cropRect;

    // Darken outside crop area
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.ctx.fillRect(0, 0, this.canvas.width, y);
    this.ctx.fillRect(0, y + h, this.canvas.width, this.canvas.height - y - h);
    this.ctx.fillRect(0, y, x, h);
    this.ctx.fillRect(x + w, y, this.canvas.width - x - w, h);

    // Border
    this.ctx.strokeStyle = '#4cd964';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(x, y, w, h);

    // iPhone-style corner brackets
    const hs = 20;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 4;
    this.ctx.lineCap = 'round';
    // top-left
    this.ctx.beginPath(); this.ctx.moveTo(x, y + hs); this.ctx.lineTo(x, y); this.ctx.lineTo(x + hs, y); this.ctx.stroke();
    // top-right
    this.ctx.beginPath(); this.ctx.moveTo(x + w - hs, y); this.ctx.lineTo(x + w, y); this.ctx.lineTo(x + w, y + hs); this.ctx.stroke();
    // bottom-left
    this.ctx.beginPath(); this.ctx.moveTo(x, y + h - hs); this.ctx.lineTo(x, y + h); this.ctx.lineTo(x + hs, y + h); this.ctx.stroke();
    // bottom-right
    this.ctx.beginPath(); this.ctx.moveTo(x + w - hs, y + h); this.ctx.lineTo(x + w, y + h); this.ctx.lineTo(x + w, y + h - hs); this.ctx.stroke();
    // Edge midpoint handles (small bars)
    this.ctx.lineWidth = 3;
    const mw = 16;
    // top
    this.ctx.beginPath(); this.ctx.moveTo(x + w/2 - mw, y); this.ctx.lineTo(x + w/2 + mw, y); this.ctx.stroke();
    // bottom
    this.ctx.beginPath(); this.ctx.moveTo(x + w/2 - mw, y + h); this.ctx.lineTo(x + w/2 + mw, y + h); this.ctx.stroke();
    // left
    this.ctx.beginPath(); this.ctx.moveTo(x, y + h/2 - mw); this.ctx.lineTo(x, y + h/2 + mw); this.ctx.stroke();
    // right
    this.ctx.beginPath(); this.ctx.moveTo(x + w, y + h/2 - mw); this.ctx.lineTo(x + w, y + h/2 + mw); this.ctx.stroke();

    // Grid lines (rule of thirds)
    this.ctx.strokeStyle = 'rgba(255,255,255,0.25)';
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
    cancelBtn.addEventListener('click', () => { this.setTool('hand'); });

    bar.appendChild(applyBtn);
    bar.appendChild(cancelBtn);
    this.canvas.parentElement.appendChild(bar);
  },

  // Detect which part of the crop rect the user is clicking
  _getCropHandle(pos) {
    const { x, y, w, h } = this.cropRect;
    const grip = 18; // pixel tolerance for grabbing handles
    const corners = [
      { name: 'tl', cx: x, cy: y },
      { name: 'tr', cx: x + w, cy: y },
      { name: 'bl', cx: x, cy: y + h },
      { name: 'br', cx: x + w, cy: y + h }
    ];
    for (const c of corners) {
      if (Math.abs(pos.x - c.cx) < grip && Math.abs(pos.y - c.cy) < grip) return c.name;
    }
    // Edges
    if (Math.abs(pos.y - y) < grip && pos.x > x && pos.x < x + w) return 'top';
    if (Math.abs(pos.y - (y + h)) < grip && pos.x > x && pos.x < x + w) return 'bottom';
    if (Math.abs(pos.x - x) < grip && pos.y > y && pos.y < y + h) return 'left';
    if (Math.abs(pos.x - (x + w)) < grip && pos.y > y && pos.y < y + h) return 'right';
    // Inside = move
    if (pos.x > x && pos.x < x + w && pos.y > y && pos.y < y + h) return 'move';
    return null;
  },

  cropStartDrag(e) {
    const pos = this.getCanvasCoords(e);
    this.cropHandle = this._getCropHandle(pos);
    if (!this.cropHandle) return;
    this.cropDragging = true;
    this.cropDragStart = { x: pos.x, y: pos.y };
    this.cropRectStart = { ...this.cropRect };
  },

  cropDragMove(e) {
    if (!this.cropDragging || !this.cropHandle) return;
    const pos = this.getCanvasCoords(e);
    const dx = pos.x - this.cropDragStart.x;
    const dy = pos.y - this.cropDragStart.y;
    const s = this.cropRectStart;
    const cw = this.canvas.width, ch = this.canvas.height;
    const minSize = 20;

    let { x, y, w, h } = { ...s };

    switch (this.cropHandle) {
      case 'move':
        x = Math.max(0, Math.min(cw - w, s.x + dx));
        y = Math.max(0, Math.min(ch - h, s.y + dy));
        break;
      case 'tl':
        x = Math.max(0, Math.min(s.x + s.w - minSize, s.x + dx));
        y = Math.max(0, Math.min(s.y + s.h - minSize, s.y + dy));
        w = s.x + s.w - x;
        h = s.y + s.h - y;
        break;
      case 'tr':
        w = Math.max(minSize, Math.min(cw - s.x, s.w + dx));
        y = Math.max(0, Math.min(s.y + s.h - minSize, s.y + dy));
        h = s.y + s.h - y;
        break;
      case 'bl':
        x = Math.max(0, Math.min(s.x + s.w - minSize, s.x + dx));
        w = s.x + s.w - x;
        h = Math.max(minSize, Math.min(ch - s.y, s.h + dy));
        break;
      case 'br':
        w = Math.max(minSize, Math.min(cw - s.x, s.w + dx));
        h = Math.max(minSize, Math.min(ch - s.y, s.h + dy));
        break;
      case 'top':
        y = Math.max(0, Math.min(s.y + s.h - minSize, s.y + dy));
        h = s.y + s.h - y;
        break;
      case 'bottom':
        h = Math.max(minSize, Math.min(ch - s.y, s.h + dy));
        break;
      case 'left':
        x = Math.max(0, Math.min(s.x + s.w - minSize, s.x + dx));
        w = s.x + s.w - x;
        break;
      case 'right':
        w = Math.max(minSize, Math.min(cw - s.x, s.w + dx));
        break;
    }

    this.cropRect = { x, y, w, h };
    this.drawCropOverlay();
  },

  cropDragEnd() {
    this.cropDragging = false;
    this.cropHandle = null;
  },

  applyCrop() {
    if (!this.cropRect) return;
    const { x, y, w, h } = this.cropRect;

    // Restore clean image (without crop overlay) before extracting
    this.restoreFromHistorySync();

    const imageData = this.ctx.getImageData(
      Math.round(x), Math.round(y), Math.round(w), Math.round(h)
    );

    this.canvas.width = Math.round(w);
    this.canvas.height = Math.round(h);

    const wrapper = this.canvas.parentElement;
    const maxW = wrapper.clientWidth - 40;
    const maxH = wrapper.clientHeight - 40;
    const ratio = Math.min(maxW / w, maxH / h, 1);
    this.displayScale = ratio;
    this.canvas.style.width = Math.floor(w * ratio) + 'px';
    this.canvas.style.height = Math.floor(h * ratio) + 'px';

    this.ctx.putImageData(imageData, 0, 0);
    this.saveToHistory();
    this.setTool('hand');
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
    // Cache image for sync restore
    this._updateHistoryCache();
  },

  _updateHistoryCache() {
    if (this.historyIndex < 0) { this._historyImageCache = null; return; }
    const img = new Image();
    img.onload = () => { this._historyImageCache = img; };
    img.src = this.drawHistory[this.historyIndex];
  },

  restoreFromHistorySync() {
    if (this._historyImageCache) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this._historyImageCache, 0, 0);
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
    // Save version before overwriting (for edit history)
    try {
      await ucb.saveClipVersion(this.currentClip.id, this.currentClip.content || null, this.currentClip.filePath ? this.currentClip.filePath.split('?')[0] : null);
    } catch (e) { console.warn('Failed to save clip version:', e); }
    const dataUrl = this.canvas.toDataURL('image/png');
    const newPath = await ucb.saveEditedClip(this.currentClip.id, dataUrl);
    if (newPath) {
      // Append cache-bust param so thumbnails reload the updated image
      const bustPath = newPath + '?t=' + Date.now();
      this.currentClip.filePath = bustPath;
      const clipInAll = App.allClips.find(c => c.id === this.currentClip.id);
      if (clipInAll) clipInAll.filePath = bustPath;
      const clipInView = App.clips.find(c => c.id === this.currentClip.id);
      if (clipInView) clipInView.filePath = bustPath;
      App.renderClipGrid();
      App.renderLeftSidebar();
      App.renderPinnedFolders();
    }
    App.toast('Edits saved', 'success');
  }
};
