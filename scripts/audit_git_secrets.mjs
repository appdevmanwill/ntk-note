import { execFileSync, spawnSync } from 'node:child_process';

// Scan the exact branch ancestry being backed up. Print locations and categories,
// never matched credential values. Private ignored configuration is not uploaded.
const patterns = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{60,}/],
  ['provider key', /sk-or-v1-[a-f0-9]{64}|gsk_[A-Za-z0-9]{48,}/],
  ['AWS key', /(?:AKIA|ASIA)[0-9A-Z]{16}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['JWT', /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/],
];
const objects = execFileSync('git', ['rev-list', '--objects', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
const ids = objects.map(line => line.split(' ')[0]);
const result = spawnSync('git', ['cat-file', '--batch'], {
  input: ids.join('\n') + '\n', maxBuffer: 200 * 1024 * 1024,
});
if (result.status !== 0) throw new Error('Unable to read Git objects for secret scan.');
const data = result.stdout;
let offset = 0;
let scanned = 0;
let findings = 0;
for (const object of objects) {
  const end = data.indexOf(10, offset);
  const [, type, length] = data.subarray(offset, end).toString().split(' ');
  offset = end + 1;
  const content = data.subarray(offset, offset + Number(length));
  offset += Number(length) + 1;
  if (type !== 'blob' || content.includes(0)) continue;
  scanned++;
  for (const [name, pattern] of patterns) {
    if (pattern.test(content.toString('utf8'))) {
      // Reviewed historical client configuration already present in origin/main.
      // Firebase web API keys identify a project; they are not service-account
      // credentials. Keep this exception pinned to this exact immutable blob.
      if (name === 'Google API key' && object.split(' ')[0] === '4c2338902e5f4e81131a52156a778d2e7aa508ab' &&
          object.slice(41) === 'src/utils/firebase.ts' &&
          content.toString().includes('projectId: "ntk-note"')) {
        console.log(`Reviewed public Firebase client configuration: ${object.slice(0, 12)}.`);
        continue;
      }
      findings++;
      console.error(`FINDING: ${object.slice(41)} (${object.slice(0, 12)}): ${name}`);
    }
  }
}
console.log(`Git ancestry: ${scanned} text blobs scanned; ${findings} findings.`);
process.exitCode = findings ? 1 : 0;
