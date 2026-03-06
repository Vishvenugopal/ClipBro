const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class FileManager {
  constructor(db, clipsDir) {
    this.db = db;
    this.clipsDir = clipsDir;
  }

  importFiles(filePaths) {
    const clips = [];
    for (const filePath of filePaths) {
      try {
        const ext = path.extname(filePath).toLowerCase();
        const stat = fs.statSync(filePath);
        const id = uuidv4();

        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico'];
        const textExts = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.py'];

        let type = 'file';
        if (imageExts.includes(ext)) type = 'image';
        else if (textExts.includes(ext)) type = 'text';

        // Copy file to clips directory
        if (!fs.existsSync(this.clipsDir)) fs.mkdirSync(this.clipsDir, { recursive: true });
        const destPath = path.join(this.clipsDir, `${id}${ext}`);
        fs.copyFileSync(filePath, destPath);

        const clipData = {
          id,
          type,
          title: path.basename(filePath),
          filePath: destPath,
          fileSize: stat.size,
          source: 'import',
          createdAt: Date.now()
        };

        // Read text content if text file
        if (type === 'text') {
          try {
            clipData.content = fs.readFileSync(filePath, 'utf-8');
          } catch {}
        }

        const clip = this.db.saveClip(clipData);
        clips.push(clip);
      } catch (err) {
        console.error(`Failed to import ${filePath}:`, err);
      }
    }

    this.db.autoGroupClips();
    return clips;
  }

  exportClip(clipId, destPath) {
    const clip = this.db.getClip(clipId);
    if (!clip) return null;

    if (clip.filePath && fs.existsSync(clip.filePath)) {
      fs.copyFileSync(clip.filePath, destPath);
      return destPath;
    } else if (clip.content) {
      fs.writeFileSync(destPath, clip.content, 'utf-8');
      return destPath;
    }
    return null;
  }
}

module.exports = FileManager;
