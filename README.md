# Universal Clipboard

A powerful screenshot & clipboard manager for Windows inspired by iPhone's screenshot workflow, built as an Electron desktop app. Automatically detects screenshots/copied text and imports them into the app. Easily share screenshots/copied text to your phone with QR codes.

## Features

### Screenshot & Capture
- **Full-screen screenshot** via `PrintScreen`
- **Selection screenshot** via `Ctrl+Shift+S`
- **Clipboard monitoring** — automatically captures copied text, images, links
- **Import files** — drag-and-drop or file picker
- **Paste into app** via `Ctrl+V`

### Image Editing (Photoshop-lite)
- **Draw/Pen** — freehand drawing with adjustable color and size
- **Highlighter** — semi-transparent marker
- **Arrow** — draw arrows for annotations
- **Rectangle** — draw rectangles/boxes
- **Text** — add text annotations
- **Blur** — pixelate sensitive regions
- **Crop** — iPhone-style quick crop with rule-of-thirds grid
- **Eraser** — remove annotations
- **Undo/Redo** — full history stack

### Organization
- **Folders** — create color-coded folders, pin to sidebar, drag clips to organize
- **Auto-grouping** — clips automatically sorted by type and date
- **Favorites** — star important clips
- **Search** — full-text search across clip titles, content, and extracted text
- **Hidden folder** — passcode-protected folder with email recovery option
- **Tabs** — open multiple clips simultaneously, drag tab to folders

### Sharing
- **QR Code** — generate temporary QR codes for phone-to-PC sharing
- **Temporary links** — create expiring LAN-accessible links (30min default)
- **Email** — open default mail client with share link

### AI Features
- **Ask AI about images** — supports OpenAI, Ollama (local), or custom endpoints
- **OCR** — extract text from screenshots using Tesseract.js
- **QR detection** — detect and decode QR codes in images
- **Web search** — reverse image search via Google Lens

### Text & Links
- **Built-in text editor** — edit text clips inline
- **Link detection** — auto-categorizes URLs
- **Code detection** — recognizes code snippets
- **Highlight-to-search** — select text and search Google

### Additional Features
- **System tray** — runs in background, double-click tray icon to open
- **Global shortcuts** — `Ctrl+Shift+V` to show app from anywhere
- **Context menus** — right-click clips for quick actions
- **Drag & drop** — drag clips out of the app or between folders
- **Dark theme** — Figma-inspired dark UI with subtle blur/glow effects
- **Clip glow** — YouTube theater-mode style ambient glow around clips

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `PrintScreen` | Full-screen screenshot |
| `Ctrl+Shift+S` | Selection screenshot |
| `Ctrl+Shift+V` | Show/focus app |
| `Ctrl+V` | Paste from clipboard into app |
| `Ctrl+Z` | Undo (in editor) |
| `Ctrl+Y` | Redo (in editor) |
| `Ctrl+S` | Save edits |
| `Delete` | Delete active clip |
| `Escape` | Close detail view |

## Setup

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for Windows
npm run build
```

## AI Configuration

Go to **Settings > AI Provider** to configure:
- **OpenAI** — enter your API key, uses GPT-4o-mini for vision
- **Ollama** — local AI, install Ollama and pull a vision model like `llava`
- **Custom** — any OpenAI-compatible API endpoint

## Tech Stack

- **Electron** — desktop framework
- **better-sqlite3** — local database for clip metadata
- **Tesseract.js** — OCR text extraction
- **jsQR** — QR code detection
- **qrcode** — QR code generation
- **Express** — local share server
- **Sharp/Jimp** — image processing

## Architecture

```
electron/
  main.js            — Main process, window management, IPC
  preload.js         — Context bridge API
  database.js        — SQLite database for clips, folders, groups, settings
  clipboard-monitor.js — Polls clipboard for changes
  screenshot-capture.js — Screen capture with selection overlay
  share-server.js    — Express server for temporary share links
  ai-engine.js       — AI provider integrations
  file-manager.js    — File import/export
src/
  renderer/
    app.js           — Main UI logic, views, tabs, actions
    editor.js        — Canvas-based image editor
    dialogs.js       — Modal dialogs (share, AI, folders, passcode)
  styles/
    main.css         — Core layout and theme
    editor.css       — Editor toolbar and tools
    dialogs.css      — Modal and form styles
    animations.css   — Transitions and keyframes
```

