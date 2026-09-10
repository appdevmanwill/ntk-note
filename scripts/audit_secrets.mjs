import fs from 'node:fs';
import path from 'node:path';

const SECRET_PATTERNS = [
  { name: 'OpenRouter API Key', regex: /sk-or-v1-[a-f0-9]{64}/ },
  { name: 'Groq API Key', regex: /gsk_[A-Za-z0-9]{48,}/ },
  { name: 'Private Key Block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS Access Key ID', regex: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/ },
  { name: 'JWT Pattern', regex: /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/ },
  { name: 'OAuth Authorization Code Pattern', regex: /(?:oauth2\/auth\?[^\s]*code=[A-Za-z0-9_\-\.]{12,}|oauth\/callback\?code=[A-Za-z0-9_\-\.]{12,})/ },
  { name: 'GitHub Personal Access Token', regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{60,}/ },
  { name: 'Google API Key Pattern', regex: /AIza[0-9A-Za-z\-_]{35}/ },
];

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.firebase',
  'backups',
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  'firestore-debug.log',
  'active_oauth_url.txt',
  '.env.local',
  '.env',
]);

function scanDir(dir, fileList = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (IGNORED_DIRS.has(item)) continue;
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, fileList);
    } else if (stat.isFile()) {
      if (!IGNORED_FILES.has(item) && !item.endsWith('.zip') && !item.endsWith('.png') && !item.endsWith('.jpg')) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

function main() {
  const root = process.cwd();
  const files = scanDir(root);
  console.log(`Scanning ${files.length} repository files for generic secret shapes...`);

  let findings = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(content)) {
        console.error(`[FINDING] File: ${path.relative(root, file)} matches pattern: ${pat.name}`);
        findings++;
      }
    }
  }

  console.log(`\nScan complete. Total files scanned: ${files.length}. Findings: ${findings}`);
  if (findings > 0) {
    process.exit(1);
  }
}

main();
