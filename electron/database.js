const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class ClipDatabase {
  constructor(dataDir) {
    this.dbPath = path.join(dataDir, 'clips.db');
    this.db = null;
    this.ready = false;
    this._initPromise = this._init();
  }

  async _init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const buf = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }
    this._createSchema();
    this.ready = true;
  }

  async waitReady() {
    if (!this.ready) await this._initPromise;
  }

  _save() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (e) {
      console.error('DB save error:', e);
    }
  }

  // Helper: run query, return array of row objects
  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  // Helper: run query, return first row object or undefined
  _get(sql, params = []) {
    const rows = this._all(sql, params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  // Helper: run a write statement
  _run(sql, params = []) {
    this.db.run(sql, params);
    this._save();
  }

  _createSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'image',
        title TEXT,
        content TEXT,
        filePath TEXT,
        thumbnailPath TEXT,
        extractedText TEXT,
        folderId TEXT,
        groupId TEXT,
        tags TEXT DEFAULT '[]',
        favorite INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0,
        width INTEGER,
        height INTEGER,
        fileSize INTEGER,
        source TEXT DEFAULT 'clipboard',
        createdAt INTEGER NOT NULL,
        editedAt INTEGER,
        accessedAt INTEGER,
        metadata TEXT DEFAULT '{}'
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#4cd964',
        icon TEXT DEFAULT 'folder',
        pinned INTEGER DEFAULT 0,
        sortOrder INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        autoRule TEXT,
        color TEXT DEFAULT '#5ac8fa',
        createdAt INTEGER NOT NULL
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS share_links (
        id TEXT PRIMARY KEY,
        clipId TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      );
    `);

    // Default settings
    const defaults = {
      'passcode': '', 'passcodeEmail': '', 'theme': 'dark',
      'clipboardMonitoring': 'true', 'autoGroup': 'true',
      'screenshotFormat': 'png', 'maxClipAge': '0',
      'highlightSearchEnabled': 'false', 'shareServerPort': '19847',
      'aiProvider': 'none', 'aiApiKey': '', 'aiModel': '', 'aiEndpoint': ''
    };
    for (const [key, value] of Object.entries(defaults)) {
      this.db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }

    // Default folders
    const fc = this._get('SELECT COUNT(*) as count FROM folders');
    if (!fc || fc.count === 0) {
      const now = Date.now();
      const folders = [
        [uuidv4(), 'Screenshots', '#ff3b30', 'camera', 1, 0, now],
        [uuidv4(), 'Text Clips', '#5ac8fa', 'type', 1, 1, now],
        [uuidv4(), 'Links', '#ff9500', 'link', 1, 2, now],
        [uuidv4(), 'Files', '#4cd964', 'file', 1, 3, now],
      ];
      for (const f of folders) {
        this.db.run('INSERT INTO folders (id, name, color, icon, pinned, sortOrder, createdAt) VALUES (?,?,?,?,?,?,?)', f);
      }
    }

    // Default groups
    const gc = this._get('SELECT COUNT(*) as count FROM groups');
    if (!gc || gc.count === 0) {
      const now = Date.now();
      const groups = [
        [uuidv4(), 'Today', 'date:today', '#4cd964', now],
        [uuidv4(), 'This Week', 'date:week', '#5ac8fa', now],
        [uuidv4(), 'Images', 'type:image', '#ff9500', now],
        [uuidv4(), 'Text', 'type:text', '#ff3b30', now],
        [uuidv4(), 'Links', 'type:link', '#af52de', now],
      ];
      for (const g of groups) {
        this.db.run('INSERT INTO groups (id, name, autoRule, color, createdAt) VALUES (?,?,?,?,?)', g);
      }
    }

    this._save();
  }

  // ===== Clips =====
  getClips(filters = {}) {
    let query = 'SELECT * FROM clips WHERE hidden = 0';
    const params = [];

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters.folderId) {
      query += ' AND folderId = ?';
      params.push(filters.folderId);
    }
    if (filters.groupId) {
      const group = this._get('SELECT * FROM groups WHERE id = ?', [filters.groupId]);
      if (group && group.autoRule) {
        const rule = group.autoRule;
        if (rule === 'date:today') {
          const d = new Date(); d.setHours(0,0,0,0);
          query += ' AND createdAt >= ?'; params.push(d.getTime());
        } else if (rule === 'date:week') {
          const d = new Date(); d.setDate(d.getDate() - 7);
          query += ' AND createdAt >= ?'; params.push(d.getTime());
        } else if (rule.startsWith('type:')) {
          query += ' AND type = ?'; params.push(rule.split(':')[1]);
        }
      }
    }
    if (filters.favorite) query += ' AND favorite = 1';
    query += ' ORDER BY createdAt DESC';
    if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit); }

    return this._all(query, params);
  }

  getClip(id) {
    return this._get('SELECT * FROM clips WHERE id = ?', [id]);
  }

  saveClip(clipData) {
    const id = clipData.id || uuidv4();
    const now = Date.now();
    this._run(`INSERT OR REPLACE INTO clips (id, type, title, content, filePath, thumbnailPath, extractedText, folderId, groupId, tags, favorite, hidden, width, height, fileSize, source, createdAt, editedAt, accessedAt, metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, clipData.type || 'image', clipData.title || null, clipData.content || null,
       clipData.filePath || null, clipData.thumbnailPath || null, clipData.extractedText || null,
       clipData.folderId || null, clipData.groupId || null, JSON.stringify(clipData.tags || []),
       clipData.favorite ? 1 : 0, clipData.hidden ? 1 : 0, clipData.width || null,
       clipData.height || null, clipData.fileSize || null, clipData.source || 'clipboard',
       clipData.createdAt || now, clipData.editedAt || null, now, JSON.stringify(clipData.metadata || {})]
    );
    return this.getClip(id);
  }

  deleteClip(id) { this._run('DELETE FROM clips WHERE id = ?', [id]); return true; }

  updateClip(id, updates) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    this._run(`UPDATE clips SET ${setClause} WHERE id = ?`, [...values, id]);
    return this.getClip(id);
  }

  searchClips(query) {
    const q = `%${query}%`;
    return this._all('SELECT * FROM clips WHERE hidden = 0 AND (title LIKE ? OR content LIKE ? OR extractedText LIKE ? OR tags LIKE ?) ORDER BY createdAt DESC', [q, q, q, q]);
  }

  // ===== Folders =====
  getFolders() {
    return this._all('SELECT * FROM folders ORDER BY pinned DESC, sortOrder ASC, createdAt ASC');
  }

  createFolder(data) {
    const id = uuidv4();
    this._run('INSERT INTO folders (id, name, color, icon, pinned, sortOrder, createdAt) VALUES (?,?,?,?,?,?,?)',
      [id, data.name, data.color || '#4cd964', data.icon || 'folder', data.pinned ? 1 : 0, data.sortOrder || 0, Date.now()]);
    return this._get('SELECT * FROM folders WHERE id = ?', [id]);
  }

  moveClipToFolder(clipId, folderId) { this._run('UPDATE clips SET folderId = ? WHERE id = ?', [folderId, clipId]); return true; }
  pinFolder(folderId, pinned) { this._run('UPDATE folders SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, folderId]); return true; }

  deleteFolder(folderId) {
    this._run('UPDATE clips SET folderId = NULL WHERE folderId = ?', [folderId]);
    this._run('DELETE FROM folders WHERE id = ?', [folderId]);
    return true;
  }

  // ===== Groups =====
  getGroups() { return this._all('SELECT * FROM groups ORDER BY createdAt ASC'); }

  autoGroupClips() {
    const clips = this._all('SELECT * FROM clips WHERE hidden = 0 AND groupId IS NULL ORDER BY createdAt DESC LIMIT 100');
    const groups = this.getGroups();
    for (const clip of clips) {
      for (const group of groups) {
        if (!group.autoRule) continue;
        const rule = group.autoRule;
        let matches = false;
        if (rule === 'date:today') {
          const d = new Date(); d.setHours(0,0,0,0);
          matches = clip.createdAt >= d.getTime();
        } else if (rule === 'date:week') {
          const d = new Date(); d.setDate(d.getDate() - 7);
          matches = clip.createdAt >= d.getTime();
        } else if (rule.startsWith('type:')) {
          matches = clip.type === rule.split(':')[1];
        }
        if (matches) {
          this.db.run('UPDATE clips SET groupId = ? WHERE id = ?', [group.id, clip.id]);
          break;
        }
      }
    }
    this._save();
    return true;
  }

  // ===== Hidden Folder =====
  verifyPasscode(passcode) {
    const stored = this._get("SELECT value FROM settings WHERE key = 'passcode'");
    if (!stored || !stored.value) return false;
    const hash = crypto.createHash('sha256').update(passcode).digest('hex');
    return hash === stored.value;
  }

  setPasscode(passcode, email) {
    const hash = crypto.createHash('sha256').update(passcode).digest('hex');
    this._run("INSERT OR REPLACE INTO settings (key, value) VALUES ('passcode', ?)", [hash]);
    if (email) this._run("INSERT OR REPLACE INTO settings (key, value) VALUES ('passcodeEmail', ?)", [email]);
    return true;
  }

  getHiddenClips() { return this._all('SELECT * FROM clips WHERE hidden = 1 ORDER BY createdAt DESC'); }
  moveToHidden(clipId) { this._run('UPDATE clips SET hidden = 1 WHERE id = ?', [clipId]); return true; }

  // ===== Share Links =====
  createShareLink(clipId, token, expiresAt) {
    const id = uuidv4();
    this._run('INSERT INTO share_links (id, clipId, token, expiresAt, createdAt) VALUES (?,?,?,?,?)', [id, clipId, token, expiresAt, Date.now()]);
    return { id, token, expiresAt };
  }

  getShareLink(token) {
    const link = this._get('SELECT * FROM share_links WHERE token = ?', [token]);
    if (link && link.expiresAt > Date.now()) return link;
    this.db.run('DELETE FROM share_links WHERE expiresAt <= ?', [Date.now()]); this._save();
    return null;
  }

  // ===== Settings =====
  getSettings() {
    const rows = this._all('SELECT * FROM settings');
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return settings;
  }

  getSetting(key) {
    const row = this._get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  saveSettings(settings) {
    for (const [key, value] of Object.entries(settings)) {
      this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
    this._save();
    return true;
  }

  close() {
    if (this.db) { this._save(); this.db.close(); }
  }
}

module.exports = ClipDatabase;
