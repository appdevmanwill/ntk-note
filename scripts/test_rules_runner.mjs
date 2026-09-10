import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

async function waitForEmulator(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/`, (res) => resolve(res.statusCode));
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return false;
}
async function main() {
  const emulatorsDir = path.join(os.homedir(), '.cache', 'firebase', 'emulators');
  let jarPath = '';
  if (fs.existsSync(emulatorsDir)) {
    const files = fs.readdirSync(emulatorsDir);
    const jarFile = files.find(f => f.startsWith('cloud-firestore-emulator') && f.endsWith('.jar'));
    if (jarFile) jarPath = path.join(emulatorsDir, jarFile);
  }
  if (!jarPath || !fs.existsSync(jarPath)) {
    console.error(`Firestore emulator JAR not found in ${emulatorsDir}`);
    process.exit(1);
  }

  const port = process.env.FIRESTORE_EMULATOR_PORT || '8088';
  console.log(`Starting Firestore Emulator via Java: ${jarPath}...`);
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const emulatorProcess = spawn('java', ['-jar', jarPath, '--host', '127.0.0.1', '--port', port, '--rules', rulesPath], {
    stdio: 'pipe'
  });

  emulatorProcess.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log(`[Emulator] ${text}`);
  });
  emulatorProcess.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.error(`[Emulator Error] ${text}`);
  });

  const ready = await waitForEmulator(Number(port));
  if (!ready) {
    console.error(`Firestore emulator failed to respond on 127.0.0.1:${port}.`);
    emulatorProcess.kill();
    process.exit(1);
  }

  console.log(`Firestore emulator is ready on 127.0.0.1:${port}! Executing Firestore security rules test suite...`);
  const isWindows = process.platform === 'win32';
  const testProcess = spawn(
    isWindows ? 'cmd.exe' : 'npx',
    isWindows ? ['/c', 'npx', 'tsx', '--test', 'tests/firestore-rules.test.ts'] : ['tsx', '--test', 'tests/firestore-rules.test.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_PORT: port,
        FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`
      }
    }
  );

  testProcess.on('exit', (code) => {
    console.log(`\nFirestore rules test suite finished with exit code ${code}`);
    emulatorProcess.kill();
    process.exit(code || 0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
