import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, getDoc, doc, setDoc, deleteDoc, disableNetwork, enableNetwork } from 'firebase/firestore';
import { app, auth, db } from '../../src/utils/firebase';
import { useStore } from '../../src/store';

function assertEmulator() {
  if (app.options.projectId !== 'demo-ntk-note' || !import.meta.env.DEV) throw new Error('Test fixtures are emulator-only.');
}
export async function signIn(email: string) {
  assertEmulator();
  // Prepare a verified emulator identity before the app's auth listener fires,
  // matching the verified Google identities supported by the actual product.
  const endpoint = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/';
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
  const created = await fetch(endpoint + 'accounts:signUp', {
    method: 'POST', headers, body: JSON.stringify({ email, password: 'Emulator-Test-Only-2026', returnSecureToken: true }),
  });
  const account = await created.json();
  if (created.ok) {
    const verified = await fetch(endpoint + 'accounts:update', {
      method: 'POST', headers, body: JSON.stringify({ localId: account.localId, emailVerified: true }),
    });
    if (!verified.ok) throw new Error('Unable to verify disposable emulator identity.');
  } else if (account.error?.message !== 'EMAIL_EXISTS') {
    throw new Error('Unable to create disposable emulator identity.');
  }
  await signInWithEmailAndPassword(auth, email, 'Emulator-Test-Only-2026');
  await getDoc(doc(db, `users/${auth.currentUser!.uid}/notes`, 'readiness-check'));
  return auth.currentUser!.uid;
}
export function ready() {
  const state = useStore.getState();
  return Boolean(auth.currentUser && state.uid === auth.currentUser.uid && state.isOnboarded);
}
export function state() {
  assertEmulator();
  const s = useStore.getState();
  return { notes: s.notes, notebooks: s.notebooks, conflicts: s.syncConflicts,
    queue: s.syncQueue, selectedNotebookId: s.selectedNotebookId, currentView: s.currentView };
}
export async function seed() {
  assertEmulator();
  const s = useStore.getState();
  s.updateSettings({ hasSeenTour: true, autoSave: true });
  const nb = s.createNotebook('QA Projects', null, '💼');
  const other = s.createNotebook('QA Personal', null, '🏠');
  const note = await s.createNote({ title: 'Project draft', content: 'Original text', notebookId: nb.id });
  await s.createNote({ title: 'Other notebook note', content: 'Personal content', notebookId: other.id });
  await useStore.getState().manualSync();
  return { noteId: note.id, notebookId: nb.id, otherId: other.id };
}
export function view(view: any, notebookId?: string, noteId?: string) {
  assertEmulator();
  const s = useStore.getState();
  s.setCurrentView(view);
  if (notebookId) s.selectNotebook(notebookId);
  if (noteId) s.selectNote(noteId);
}
export async function edit(noteId: string, content: string) {
  assertEmulator();
  await useStore.getState().updateNote(noteId, { content });
}
export async function offline(value: boolean) {
  assertEmulator();
  if (value) { useStore.getState().setOnlineStatus(false); await disableNetwork(db); }
  else { await enableNetwork(db); useStore.getState().setOnlineStatus(true); }
}
export function pauseSync(value: boolean) {
  assertEmulator();
  useStore.getState().setOnlineStatus(!value);
}
export async function cloud(noteId: string, content?: string) {
  assertEmulator();
  const ref = doc(db, `users/${auth.currentUser!.uid}/notes`, noteId);
  if (content === undefined) return (await getDoc(ref)).data();
  const current = (await getDoc(ref)).data();
  await setDoc(ref, { ...current, content, updatedAt: new Date().toISOString() });
}
export async function removeCloud(noteId: string) {
  assertEmulator();
  await deleteDoc(doc(db, `users/${auth.currentUser!.uid}/notes`, noteId));
}
export async function cloudCount() {
  assertEmulator();
  return (await getDocs(collection(db, `users/${auth.currentUser!.uid}/notes`))).size;
}
export async function sync() { assertEmulator(); return useStore.getState().manualSync(); }
export async function resolve(strategy: any) {
  assertEmulator();
  const conflict = useStore.getState().syncConflicts[0];
  if (conflict) await useStore.getState().resolveSyncConflict(conflict.id, strategy);
}
