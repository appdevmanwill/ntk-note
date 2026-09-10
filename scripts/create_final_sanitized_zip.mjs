import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import JSZip from 'jszip';

const rootDir = process.cwd();
const targetZipArg = process.argv[2];
const zipFileName = targetZipArg || 'NTK-note-v2.8.2-final-production-live-verified-sanitized.zip';
const zipFilePath = path.join(rootDir, zipFileName);

const FORBIDDEN_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.firebase',
  '.wrangler',
  'backups',
  'dist',
  'dist-ssr',
  'logs',
  'scratch',
  '.system_generated',
]);

const FORBIDDEN_FILE_PATTERNS = [
  /\.log$/i,
  /\.zip$/i,
  /^\.dev\.vars/i,
  /^\.env\.local$/i,
  /^\.env$/i,
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
  'RELEASE_MANIFEST.json',
  'ANTIGRAVITY_CONTINUATION_STATE.md',
  'NTK_NOTE_V2_8_RELIABILITY_SYNC_OFFLINE_PERFORMANCE_REPORT.md',
  'NTK_NOTE_V2_8_1_FINAL_PRODUCTION_RELEASE_REPORT.md',
  'NTK_NOTE_V2_8_2_FINAL_PRODUCTION_RELEASE_REPORT.md',
  'NTK_NOTE_FINAL_PRODUCTION_RUNBOOK.md',
  'NTK_SOURCE_DUPLICATE_AUDIT.md'
];

const GENERIC_SECRET_DETECTORS = [
  { name: 'OpenRouter Key', regex: /sk-or-v1-[a-f0-9]{64}/i },
  { name: 'Groq Key', regex: /gsk_[A-Za-z0-9]{48,}/ },
  { name: 'Generic Bearer Token', regex: /bearer\s+[a-zA-Z0-9_\-\.]{30,}/i },
  { name: 'JWT Pattern', regex: /eyJ[a-zA-Z0-9_-]{16,}\.eyJ[a-zA-Z0-9_-]{16,}\.[a-zA-Z0-9_-]{16,}/ },
  { name: 'Private Key Header', regex: /-----BEGIN\s+(?:RSA|EC|OPENSSH|PRIVATE)\s+KEY-----/ },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|aws_session_token)\s*=\s*['"][A-Za-z0-9/+=]{30,}['"]/i },
  { name: 'OAuth Authorization Code Pattern', regex: /(?:oauth2\/auth\?[^\s]*code=[A-Za-z0-9_\-\.]{12,}|oauth\/callback\?code=[A-Za-z0-9_\-\.]{12,})/ },
  { name: 'GitHub Personal Access Token', regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{60,}/ },
  { name: 'Google API Key Pattern', regex: /AIza[0-9A-Za-z\-_]{35}/ }
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css',
  '.py', '.txt', '.rules', '.toml', '.env.example', '.webmanifest'
]);

function isExcluded(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  const segments = norm.split('/');

  // Exclude if any path segment matches a forbidden directory at ANY depth
  for (const seg of segments) {
    if (FORBIDDEN_DIR_SEGMENTS.has(seg)) return true;
  }

  if (norm.startsWith('.env') && norm !== '.env.example') return true;
  return FORBIDDEN_FILE_PATTERNS.some(pat => pat.test(norm));
}

function scanContentForSecrets(content, filePath) {
  const findings = [];
  for (const detector of GENERIC_SECRET_DETECTORS) {
    if (detector.regex.test(content)) {
      findings.push({ file: filePath, detector: detector.name });
    }
  }
  return findings;
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
  console.log(`Starting real content-scanned packaging for: ${zipFileName}...`);
  const files = await collectFiles(rootDir);
  console.log(`Found ${files.length} candidate files.`);

  let preScanSecretFindings = 0;
  let preScannedTextFiles = 0;

  for (const file of files) {
    const ext = path.extname(file.relPath);
    if (TEXT_EXTENSIONS.has(ext) || file.relPath === '.env.example') {
      preScannedTextFiles++;
      const content = await fs.promises.readFile(file.fullPath, 'utf-8');
      const findings = scanContentForSecrets(content, file.relPath);
      if (findings.length > 0) {
        preScanSecretFindings += findings.length;
        for (const f of findings) {
          console.error(`[SECRET VIOLATION] ${f.detector} detected in ${f.file}`);
        }
      }
    }
  }

  console.log(`Pre-packaging content scan: ${preScannedTextFiles} text files scanned. Findings: ${preScanSecretFindings}`);
  if (preScanSecretFindings > 0) {
    console.error(`PACKAGING REJECTED: Found ${preScanSecretFindings} suspicious secret patterns in source files!`);
    process.exit(1);
  }

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
  console.log('Performing deep content audit of generated archive...');
  const readZip = await JSZip.loadAsync(zipBuffer);
  const entryNames = Object.keys(readZip.files);

  const missing = [];
  for (const req of REQUIRED_PATHS) {
    const found = entryNames.some(name => name === req || name.startsWith(req + '/'));
    if (!found) missing.push(req);
  }

  if (missing.length > 0) {
    console.error('VERIFICATION ERROR: Missing required paths in archive:', missing);
    process.exit(1);
  }

  const forbiddenFound = [];
  let postScanSecretFindings = 0;
  let postScannedTextFiles = 0;

  for (const name of entryNames) {
    if (isExcluded(name)) {
      forbiddenFound.push(name);
    }
    const ext = path.extname(name);
    if (TEXT_EXTENSIONS.has(ext) || name === '.env.example') {
      postScannedTextFiles++;
      const fileData = readZip.file(name);
      if (fileData) {
        const textContent = await fileData.async('string');
        const findings = scanContentForSecrets(textContent, name);
        if (findings.length > 0) {
          postScanSecretFindings += findings.length;
          for (const f of findings) {
            console.error(`[ZIP CONTENT AUDIT ERROR] ${f.detector} detected inside ${name}`);
          }
        }
      }
    }
  }

  if (forbiddenFound.length > 0) {
    console.error('VERIFICATION ERROR: Forbidden paths found in ZIP:', forbiddenFound);
    process.exit(1);
  }

  // Explicit Section 32 assertion: cloudflare/ntk-gateway/dist/ must be absent
  const hasGatewayDist = entryNames.some(name => name.includes('cloudflare/ntk-gateway/dist') || name.includes('ntk-gateway/dist'));
  if (hasGatewayDist) {
    console.error('VERIFICATION ERROR: cloudflare/ntk-gateway/dist/ found in archive!');
    process.exit(1);
  }

  // Explicit assertion: zero forbidden directory segments at any depth
  for (const name of entryNames) {
    const segments = name.split('/');
    for (const seg of segments) {
      if (FORBIDDEN_DIR_SEGMENTS.has(seg)) {
        console.error(`VERIFICATION ERROR: Forbidden directory segment "${seg}" found in ${name}`);
        process.exit(1);
      }
    }
  }

  if (postScanSecretFindings > 0) {
    console.error(`VERIFICATION ERROR: Post-scan found ${postScanSecretFindings} secret patterns inside ZIP!`);
    process.exit(1);
  }

  // Release manifest validation (Section 54 & 55)
  if (entryNames.includes('RELEASE_MANIFEST.json')) {
    const manifestFile = readZip.file('RELEASE_MANIFEST.json');
    if (manifestFile) {
      const manifestStr = await manifestFile.async('string');
      const manifest = JSON.parse(manifestStr);
      const currentGitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      if (manifest.gitSHA !== currentGitSha) {
        console.error(`VERIFICATION ERROR: Manifest gitSHA (${manifest.gitSHA}) does not match HEAD (${currentGitSha})!`);
        process.exit(1);
      }
      if (!manifest.workerVersionId || typeof manifest.workerVersionId !== 'string') {
        console.error('VERIFICATION ERROR: Manifest workerVersionId missing or invalid!');
        process.exit(1);
      }
      console.log(`- Release Manifest validated: Git SHA ${manifest.gitSHA.slice(0, 10)}... matches HEAD`);
      console.log(`- Release Manifest Worker Version ID: ${manifest.workerVersionId}`);
    }
  }

  console.log('\n==================================================');
  console.log('REAL CONTENT SCAN & ARCHIVE VERIFICATION PASSED');
  console.log('==================================================');
  console.log(`- Total archived entries: ${entryNames.length}`);
  console.log(`- Text files content-scanned: ${postScannedTextFiles}`);
  console.log(`- Secret-pattern findings count: 0 (REQUIRED: 0)`);
  console.log('- All required files present: YES');
  console.log('- All forbidden files excluded: YES');
  console.log(`- Canonical Output: ${zipFilePath}`);
  console.log('==================================================\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
