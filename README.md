
# ![Logo](assets/clipbro-icons/Green%20Guy.png) ClipBro

A powerful screenshot & clipboard manager for Windows, with easy file sharing to phones!

ClipBro automatically detects screenshots, copied text, images, and links. Edit images with a full annotation toolkit, organize clips into folders, and share via QR codes or temporary links.

## Features

### Capture
- **Windows screenshot detection** — Screenshot as you normally would, ClipBro can detect it from the tray
- **ClipBro's Selection screenshot** — `Ctrl+Shift+S`
- **Clipboard monitoring** — auto-captures copied text, images, links
- **Import files** — drag-and-drop files from outside the app, or use file picker

### Sharing
- **QR Code** — generate QR codes for phone-to-PC transfer of screenshots/text (same Wi-Fi required)
- **Temporary links** — expiring LAN links with copy button (same Wi-Fi required)

### Organization
- **Tabs** — open multiple clips, shift-click to multi-select, right-click for tab actions (Close Selected, Close All, Close to Right)
- **Groups** — auto-groups by date (Today/Yesterday/This Week/Older) and type (Favorites/Images/Text/Links/Code/Other)
- **Search** — full-text with filters: `type:image`, `date:today`, `from:2024-01-01`, `is:fav`
- **In-App File explorer** — built-in sidebar with quick access to Desktop, Documents, Downloads, Pictures

### Image and Text Editing
- **Image Editing Tools:** — Draw, Highlighter, Arrow, Rectangle, Text, blur, Crop, Eraser
- **Text Editing Tools:** — Rich Text: bold, italic, underline, strikethrough, headings, lists, code, links
- **Edit History:** — View edit versions to files with version snapshots and undo/redo between them

### Text Extraction and AI
- **Ask AI** — works on images and text clips
- **Extract Text (OCR)** — Tesseract.js with partial selection & copy
- **QR detection** — decode QR codes in images
- **Providers** — Ollama (local), OpenAI, or custom OpenAI-compatible endpoints

## How to Install
Download the latest release (Windows only) from the right side of the screen in the Releases section.

## Keyboard Shortcuts

Global shortcuts are **configurable in Settings → Keyboard Shortcuts**. Defaults:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+V` | Show/hide app |
| `Ctrl+Shift+S` | Built-in selection screenshot |
| `Ctrl+Z` | Undo (editor) |
| `Ctrl+Shift+Z` | Undo (editor) |
| `Ctrl+Y` | Redo (editor) |
| `Ctrl+S` | Save edits |
| `Ctrl+A` | Select all (in select mode) |
| `Delete` | Delete selected clip(s) |
| `Escape` | Close editor / exit select mode / clear hotkey field |

## Setup

```bash
npm install       # Install dependencies
npm run dev       # Development (with DevTools)
npm start         # Production-like run
npm run build     # Build Windows installer
```

> **Note:** Chromium cache warnings on startup (e.g. `cache_util_win.cc`) are harmless and can be ignored.

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
