import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const rootDir = process.cwd();
const tempZipPath = path.join(rootDir, 'v24_temp.zip');
const newZipPath = path.join(rootDir, 'NTK-note-v2.4-audio-ux-live-verified-sanitized.zip');

const GENERIC_SECRET_DETECTORS = [
  { name: 'OpenRouter Key', regex: /sk-or-v1-[a-f0-9]{64}/i },
  { name: 'Groq Key', regex: /gsk_[A-Za-z0-9]{48,}/ },
  { name: 'Generic Bearer Token', regex: /bearer\s+[a-zA-Z0-9_\-\.]{30,}/i },
  { name: 'JWT Pattern', regex: /eyJ[a-zA-Z0-9_-]{16,}\.eyJ[a-zA-Z0-9_-]{16,}\.[a-zA-Z0-9_-]{16,}/ },
  { name: 'Private Key Header', regex: /-----BEGIN\s+(?:RSA|EC|OPENSSH|PRIVATE)\s+KEY-----/ },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|aws_session_token)\s*=\s*['"][A-Za-z0-9/+=]{30,}['"]/i }
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css',
  '.py', '.txt', '.rules', '.toml', '.env.example', '.webmanifest'
]);

const cleanLegacyPythonBlock = `FORBIDDEN_PATTERNS = [
    # Generic secret shape detectors (no literal secret values)
    r"sk-or-v1-[a-f0-9]{64}",
    r"gsk_[A-Za-z0-9]{48,}",
    r"bearer\\s+[a-zA-Z0-9_\\-\\.]{25,}",
    r"eyJ[a-zA-Z0-9_-]{10,}\\.eyJ[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}",
    r"-----BEGIN\\s+(?:RSA|EC|OPENSSH|PRIVATE)\\s+KEY-----",
    r"(?:aws_secret_access_key|aws_session_token)\\s*=\\s*['\"][A-Za-z0-9/+=]{30,}['\"]",
    r"(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\\s*[:=]\\s*['\"][a-zA-Z0-9_\\-]{20,}['\"]"
]`;

async function main() {
  console.log(`Loading v2.4 git archive: ${tempZipPath}...`);
  const oldZipBuffer = await fs.promises.readFile(tempZipPath);
  const zip = await JSZip.loadAsync(oldZipBuffer);

  const newZip = new JSZip();

  for (const [relPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    let content = await entry.async('nodebuffer');

    if (relPath.includes('package_final_live_zip.py')) {
      let str = content.toString('utf-8');
      if (/FORBIDDEN_PATTERNS\s*=\s*\[[\s\S]*?\n\]/m.test(str)) {
        str = str.replace(/FORBIDDEN_PATTERNS\s*=\s*\[[\s\S]*?\n\]/m, cleanLegacyPythonBlock);
        content = Buffer.from(str, 'utf-8');
        console.log(`Sanitized legacy pattern block in ${relPath}`);
      }
    }

    newZip.file(relPath, content);
  }

  console.log('Generating sanitized v2.4 rollback ZIP...');
  const newZipBuffer = await newZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  await fs.promises.writeFile(newZipPath, newZipBuffer);
  console.log(`Saved sanitized v2.4 rollback: ${newZipPath} (${newZipBuffer.length} bytes)`);

  // Verify sanitized v2.4 ZIP
  console.log('Auditing sanitized v2.4 rollback archive for secrets...');
  const verifyZip = await JSZip.loadAsync(newZipBuffer);
  let findings = 0;
  let textFiles = 0;

  for (const [name, entry] of Object.entries(verifyZip.files)) {
    if (entry.dir) continue;
    const ext = path.extname(name);
    if (TEXT_EXTENSIONS.has(ext)) {
      textFiles++;
      const text = await entry.async('string');
      for (const d of GENERIC_SECRET_DETECTORS) {
        if (d.regex.test(text)) {
          findings++;
          console.error(`[VIOLATION] ${d.name} found in ${name}`);
        }
      }
    }
  }

  console.log(`v2.4 Sanitized Audit: ${textFiles} text files scanned. Secret findings: ${findings}`);
  if (findings > 0) {
    console.error('Audit failed: secret patterns found in sanitized v2.4 archive!');
    process.exit(1);
  }

  console.log('\n==================================================');
  console.log('v2.4 SANITIZED ROLLBACK VERIFICATION PASSED');
  console.log('==================================================');
  console.log(`- File: ${newZipPath}`);
  console.log(`- Text files content-scanned: ${textFiles}`);
  console.log(`- Secret findings: ${findings} (REQUIRED: 0)`);
  console.log('==================================================\n');
  
  // Clean up temp zip
  await fs.promises.unlink(tempZipPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
