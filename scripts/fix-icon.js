const path = require('path');
const { rcedit } = require('rcedit');

const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'ClipBro.exe');
const ico = path.join(__dirname, '..', 'assets', 'clipbro-icons', 'icon.ico');

rcedit(exe, { icon: ico })
  .then(() => console.log('  • icon patched into ClipBro.exe'))
  .catch(e => { console.error('Icon patch failed:', e); process.exit(1); });
