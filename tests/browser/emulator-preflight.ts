/** Warm the local rules/REST server before the browser opens its parallel listeners. */
export default async function emulatorPreflight() {
  const url = 'http://127.0.0.1:8089/v1/projects/demo-ntk-note/databases/(default)/documents/qa-readiness/probe';
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer owner' },
    signal: AbortSignal.timeout(60_000),
  });
  if (![200, 404].includes(response.status)) {
    throw new Error(`Local Firestore emulator preflight failed: HTTP ${response.status}`);
  }
  await response.text();
  const denied = await fetch('http://127.0.0.1:8089/v1/projects/demo-ntk-note/databases/(default)/documents/users/readiness/notes/probe', {
    signal: AbortSignal.timeout(60_000),
  });
  if (denied.status !== 403) throw new Error('Emulator rules must deny unauthenticated private-note access.');
  await denied.text();
}
