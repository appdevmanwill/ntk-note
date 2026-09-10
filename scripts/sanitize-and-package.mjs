import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT_DIR = process.cwd();
const OUTPUT_ZIP = path.resolve(ROOT_DIR, 'NTK-note-antigravity-round3-live-verified.zip');

const EXCLUDED_PATTERNS = [
  /^node_modules(?:\/|$)/,
  /^\.git(?:\/|$)/,
  /^\.firebase(?:\/|$)/,
  /^dist(?:\/|$)/,
  /^\.env(?:\.|$)/,
  /^\.tempmediaStorage(?:\/|$)/,
  /\.zip$/,
  /\.tar\.gz$/,
  /\.DS_Store$/,
  /Thumbs\.db$/,
  /\.log$/,
];

function isExcluded(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(normalized));
}

function addFilesRecursively(zip, dir, baseDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (isExcluded(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      addFilesRecursively(zip, fullPath, baseDir);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath);
      zip.file(relPath.replace(/\\/g, '/'), content);
    }
  }
}

async function main() {
  console.log('[Sanitize & Package] Preparing clean production release ZIP (Round 3)...');
  const zip = new JSZip();

  addFilesRecursively(zip, ROOT_DIR, ROOT_DIR);

  const packagedFiles = Object.keys(zip.files);
  console.log(`[Sanitize & Package] Packaged ${packagedFiles.length} clean sanitized files.`);

  // ── Post-packaging automated validation assertions ──
  const requiredFiles = [
    '.firebaserc',
    'firebase.json',
    'firestore.rules',
    'firestore.indexes.json',
    'package.json',
    'ANTIGRAVITY_ROUND3_IMPLEMENTATION_REPORT.md',
    'ANTIGRAVITY_ROUND3_CHANGELOG.md',
    'ANTIGRAVITY_ROUND3_DEPLOYMENT_REPORT.md',
  ];

  const missingRequired = requiredFiles.filter(req => !packagedFiles.includes(req));
  if (missingRequired.length > 0) {
    console.warn(`[Sanitize & Package] Note: Missing required files for release: ${missingRequired.join(', ')}`);
  }

  const forbiddenFound = packagedFiles.filter(f =>
    f.startsWith('.firebase/') || f.endsWith('.log') || f.endsWith('.zip') || f.includes('.env')
  );
  if (forbiddenFound.length > 0) {
    throw new Error(`[Sanitize & Package] Validation Error: Forbidden files found in package: ${forbiddenFound.join(', ')}`);
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(OUTPUT_ZIP, buffer);
  const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
  console.log(`[Sanitize & Package] Successfully generated: ${OUTPUT_ZIP} (${sizeMb} MB)`);
}

main().catch(err => {
  console.error('[Sanitize & Package] Failed:', err);
  process.exit(1);
});
