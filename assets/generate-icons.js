// Run this script to generate app icons
// node assets/generate-icons.js

const fs = require('fs');
const path = require('path');

// Create a simple SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0a0a1a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4cd964"/>
      <stop offset="100%" stop-color="#5ac8fa"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="48" fill="url(#bg)"/>
  <rect x="48" y="48" width="160" height="160" rx="24" stroke="url(#accent)" stroke-width="8" fill="none"/>
  <line x1="96" y1="128" x2="160" y2="128" stroke="url(#accent)" stroke-width="8" stroke-linecap="round"/>
  <line x1="128" y1="96" x2="128" y2="160" stroke="url(#accent)" stroke-width="8" stroke-linecap="round"/>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'icon.svg'), svg);
console.log('SVG icon created at assets/icon.svg');

// Create a simple PNG using raw buffer (16x16 for tray)
const size = 16;
const buf = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dist = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
    if (dist < 6) {
      buf[i] = 76;
      buf[i + 1] = 217;
      buf[i + 2] = 100;
      buf[i + 3] = 255;
    }
  }
}

console.log('Icon generation complete. For production, convert icon.svg to icon.ico and icon.png using an image tool.');
