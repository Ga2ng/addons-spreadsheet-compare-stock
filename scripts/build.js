const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-clasp');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const foldersToCopy = ['00-manifest', '01-code-backend', '02-sidebar-ui'];

let copiedCount = 0;

for (const folder of foldersToCopy) {
  const dirPath = path.join(rootDir, folder);
  if (!fs.existsSync(dirPath)) continue;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    if (file.endsWith('.gs') || file.endsWith('.html') || file === 'appsscript.json') {
      const srcFile = path.join(dirPath, file);
      const destFile = path.join(distDir, file);
      fs.copyFileSync(srcFile, destFile);
      copiedCount++;
    }
  }
}

console.log(`[build] Berhasil menyalin ${copiedCount} file ke dist-clasp/`);
