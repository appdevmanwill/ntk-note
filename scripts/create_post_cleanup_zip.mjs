import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const rootDir = process.cwd();
const zipFileName = 'NTK-note-v2.3-post-cleanup-pre-upgrade-verified.zip';
const zipFilePath = path.join(rootDir, zipFileName);

const FORBIDDEN_PATTERNS = [
  /^node_modules[\\/]/,
  /^[\\/]node_modules/,
  /[\\/]node_modules[\\/]/,
  /^\.git[\\/]/,
  /^\.wrangler[\\/]/,
  /[\\/]\.wrangler[\\/]/,
  /^\.firebase[\\/]/,
  /^backups[\\/]/,
  /^dist[\\/]/,
  /^dist-ssr[\\/]/,
  /^logs[\\/]/,
  /\.log$/i,
  /\.zip$/i,
  /^\.system_generated[\\/]/,
  /^\.dev\.vars/i,
  /active_oauth_url\.txt$/i,
  /active_callback_url\.txt$/i,
  /current_oauth_url\.txt$/i,
  /oauth_url\.txt$/i,
];

const REQUIRED_PATHS = [
  'src',
  'public',
  'cloudflare/ntk-gateway',
  'tests',
  'scripts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'firebase.json',
  '.firebaserc',
  'firestore.rules',
  'firestore.indexes.json',
  '.env.example',
  'ANTIGRAVITY_CONTINUATION_STATE.md',
  'NTK_BASELINE_RECONCILIATION_REPORT.md',
  'NTK_INFRASTRUCTURE_DUPLICATE_INVENTORY.md',
  'NTK_NOTE_PRE_UPGRADE_BASELINE_REPORT.md',
  'NTK_LIVE_IDENTITY_AND_DUPLICATE_CLEANUP_REPORT.md',
  'NTK_SOURCE_DUPLICATE_AUDIT.md'
];

function isExcluded(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  if (norm.startsWith('.env') && norm !== '.env.example') return true;
  return FORBIDDEN_PATTERNS.some(pat => pat.test(norm));
}

async function collectFiles(dir, base = '') {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relPath = path.join(base, entry.name).replace(/\\/g, '/');
    if (isExcluded(relPath)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, relPath)));
    } else if (entry.isFile()) {
      files.push({ relPath, fullPath });
    }
  }
  return files;
}

async function main() {
  console.log('Collecting files for sanitized post-cleanup ZIP...');
  const files = await collectFiles(rootDir);
  console.log(`Found ${files.length} eligible files.`);

  const zip = new JSZip();

  for (const file of files) {
    const content = await fs.promises.readFile(file.fullPath);
    zip.file(file.relPath, content);
  }

  console.log('Generating ZIP buffer...');
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  await fs.promises.writeFile(zipFilePath, zipBuffer);
  const stats = await fs.promises.stat(zipFilePath);
  console.log(`Saved ${zipFileName} (${stats.size.toLocaleString()} bytes)`);

  // Programmatic verification of the generated ZIP
  console.log('Verifying generated archive...');
  const readZip = await JSZip.loadAsync(zipBuffer);
  const entryNames = Object.keys(readZip.files);

  const missing = [];
  for (const req of REQUIRED_PATHS) {
    const found = entryNames.some(name => name === req || name.startsWith(req + '/'));
    if (!found) missing.push(req);
  }

  if (missing.length > 0) {
    console.error('VERIFICATION ERROR: Missing required paths:', missing);
    process.exit(1);
  }

  const forbiddenFound = [];
  for (const name of entryNames) {
    if (isExcluded(name)) {
      forbiddenFound.push(name);
    }
  }

  if (forbiddenFound.length > 0) {
    console.error('VERIFICATION ERROR: Forbidden files found in ZIP:', forbiddenFound);
    process.exit(1);
  }

  console.log('Archive verification PASSED:');
  console.log(`- Total archived entries: ${entryNames.length}`);
  console.log('- All required files and reports present: YES');
  console.log('- All forbidden files and secrets excluded: YES');
  console.log(`- Output path: ${zipFilePath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
