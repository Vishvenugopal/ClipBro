# Universal Clipboard

A screenshot & clipboard manager for Windows, built with Electron. Automatically captures copied text, images, and links. Edit images, organize clips into folders, and share via QR codes or temporary links.

## Features

### Capture
- **Full-screen screenshot** — `PrintScreen`
- **Selection screenshot** — `Ctrl+Shift+S`
- **Clipboard monitoring** — auto-captures copied text, images, links
- **Import files** — drag-and-drop or file picker

### Image Editing
- **Draw/Pen** — freehand drawing with color & size controls
- **Highlighter** — semi-transparent marker
- **Arrow / Rectangle** — annotation shapes
- **Text** — add text overlays
- **Blur** — pixelate sensitive regions
- **Crop** — iPhone-style crop with drag handles
- **Eraser** — remove annotations
- **Undo/Redo** — full history stack

### Text Editing
- **Rich text toolbar** — bold, italic, underline, strikethrough, headings, lists, code, links
- **Auto-save** — edits saved on blur

### Organization
- **Folders** — color-coded, pinnable to top bar, drag clips to organize
- **Groups** — auto-groups by date (Today/Yesterday/This Week/Older) and type (Images/Text/Links/Code/Favorites)
- **All Clips** — view with sorting (newest, oldest, A–Z, size)
- **Search** — full-text with filters: `type:image`, `date:today`, `from:2024-01-01`, `is:fav`
- **Hidden folder** — passcode-protected with email recovery
- **Tabs** — open multiple clips, right-click for tab actions
- **File explorer** — built-in sidebar with quick access to Desktop, Documents, Downloads, Pictures

### Sharing
- **QR Code** — temporary QR codes for phone-to-PC transfer
- **Temporary links** — expiring LAN links (30min default)
- **Email** — open default mail client with share link

### AI
- **Ask AI** — works on images and text clips
- **Extract Text (OCR)** — Tesseract.js with partial selection & copy
- **QR detection** — decode QR codes in images
- **Providers** — OpenAI, Ollama (local), or custom OpenAI-compatible endpoints

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `PrintScreen` | Full-screen screenshot |
| `Ctrl+Shift+S` | Selection screenshot |
| `Ctrl+Shift+V` | Show/hide app |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save edits |
| `Ctrl+A` | Select all (in select mode) |
| `Delete` | Delete selected clip(s) |
| `Escape` | Close editor / exit select mode |

## Setup

```bash
npm install       # Install dependencies
npm run dev       # Development (with DevTools)
npm start         # Production-like run
npm run build     # Build Windows installer
```

## Tech Stack

- **Electron 28** — desktop framework
- **sql.js** — in-process SQLite (pure JS, no native builds)
- **Tesseract.js** — OCR text extraction
- **Jimp** — image processing
- **jsQR / qrcode** — QR detection & generation
- **Express** — local share server
- **uuid** — clip ID generation

## Architecture

```
electron/
  main.js              — Main process, window management, IPC handlers
  preload.js           — Context bridge API (ucb.*)
  database.js          — sql.js database (clips, folders, settings)
  clipboard-monitor.js — Polls clipboard for changes
  screenshot-capture.js — Screen capture with selection overlay
  share-server.js      — Express server for temporary share links
  ai-engine.js         — AI provider integrations
  file-manager.js      — File import/export
src/
  renderer/
    app.js             — Main UI logic, rendering, actions
    editor.js          — Canvas-based image editor
    dialogs.js         — Modal dialogs (share, AI, folders, passcode)
  styles/
    main.css           — Core layout and theme
    editor.css         — Editor toolbar and tools
    dialogs.css        — Modal and form styles
    animations.css     — Keyframes and transitions
index.html             — Single-page app shell
```
