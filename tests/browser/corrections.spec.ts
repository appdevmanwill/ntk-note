import { test, expect, type Page } from '@playwright/test';

// Fixtures import the actual store and Firebase SDK through Vite. All writes
// go to demo-ntk-note on localhost; external requests are blocked per context.
async function fixture(page: Page, action: string, args: unknown[] = []) {
  return page.evaluate(async ({ action, args }) => {
    const module = await import('/tests/browser/fixture.ts');
    return module[action](...args);
  }, { action, args });
}
async function open(page: Page, email: string) {
  // Local Firestore streaming requests must bypass request interception.
  // All external production APIs use HTTPS and are blocked here.
  await page.context().route('https://**/*', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await fixture(page, 'signIn', [email]);
  await expect.poll(() => fixture(page, 'ready')).toBe(true);
  const guide = page.getByRole('button', { name: 'Close welcome guide' });
  if (await guide.isVisible()) {
    // Another device's settings snapshot may dismiss the tour between these
    // two actions. A disappeared tour already satisfies setup's desired state.
    await guide.click({ timeout: 3000 }).catch(async error => {
      if (await guide.isVisible()) throw error;
    });
  }
}
test('top-right profile menu stays within desktop/mobile viewport and works by keyboard', async ({ page }, info) => {
  await open(page, `menu-${info.project.name}-${Date.now()}@example.test`);
  await page.getByRole('button', { name: 'Account and profile menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  for (const name of ['View Profile', 'Settings', 'Help & Shortcuts', 'Sync & Offline Status']) {
    await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: `test-evidence/fix-v290/${info.project.name}-account.png` });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
test('recent notebook navigation filters notes; create/edit nested icons survive reload and cloud sync', async ({ page }, info) => {
  await open(page, `notebooks-${info.project.name}-${Date.now()}@example.test`);
  const ids = await fixture(page, 'seed');
  await fixture(page, 'view', ['home']);
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent Notebooks' }) })
    .getByRole('button').filter({ hasText: 'QA Projects' }).click();
  await expect.poll(async () => (await fixture(page, 'state')).selectedNotebookId).toBe(ids.notebookId);
  expect((await fixture(page, 'state')).currentView).toBe('notebooks');
  await expect(page.getByText('Other notebook note', { exact: true })).toBeHidden();
  await fixture(page, 'view', ['folders']);
  await page.getByRole('button', { name: 'Add sub-notebook under QA Projects' }).click();
  await page.getByPlaceholder('e.g. Work, Ideas, Meeting Notes').fill('QA Child');
  await page.getByRole('button', { name: 'Keys icon', exact: true }).click();
  await page.getByRole('button', { name: 'Create Notebook', exact: true }).click();
  const child = (await fixture(page, 'state')).notebooks.find((n: any) => n.name === 'QA Child');
  expect(child.parentId).toBe(ids.notebookId);
  expect(child.icon).toBe('🔑');
  await fixture(page, 'sync');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => fixture(page, 'ready')).toBe(true);
  await expect.poll(async () => (await fixture(page, 'state')).notebooks.find((n: any) => n.id === child.id)?.icon).toBe('🔑');
  await fixture(page, 'view', ['folders']);
  await page.getByRole('button', { name: 'Expand QA Projects' }).click();
  await page.getByRole('button', { name: 'Edit QA Child icon and name' }).click();
  await page.getByRole('button', { name: 'Cloud icon', exact: true }).click();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await fixture(page, 'sync');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => fixture(page, 'ready')).toBe(true);
  await expect.poll(async () => (await fixture(page, 'state')).notebooks.find((n: any) => n.id === child.id)?.icon).toBe('☁️');
  await page.screenshot({ path: `test-evidence/fix-v290/${info.project.name}-notebook.png` });
});
test('normal editing, offline/reconnect and reload keep the same note ID without copies', async ({ page }, info) => {
  await open(page, `editing-${info.project.name}-${Date.now()}@example.test`);
  const ids = await fixture(page, 'seed');
  await fixture(page, 'view', ['notebooks', ids.notebookId, ids.noteId]);
  const editor = page.getByPlaceholder('Start writing...');
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await fixture(page, 'state')).notes.find((n: any) => n.id === ids.noteId)?.content).toBe('Original text');
  await editor.fill('First normal edit');
  await fixture(page, 'sync');
  await expect.poll(async () => (await fixture(page, 'cloud', [ids.noteId])).content).toBe('First normal edit');
  await fixture(page, 'offline', [true]);
  await editor.fill('Offline edit kept at original ID');
  await fixture(page, 'offline', [false]);
  await fixture(page, 'sync');
  await expect.poll(async () => (await fixture(page, 'cloud', [ids.noteId])).content).toBe('Offline edit kept at original ID');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => fixture(page, 'ready')).toBe(true);
  await expect.poll(async () => (await fixture(page, 'state')).notes.find((n: any) => n.id === ids.noteId)?.content).toBe('Offline edit kept at original ID');
  expect(await fixture(page, 'cloudCount')).toBe(2);
  expect((await fixture(page, 'state')).conflicts).toHaveLength(0);
});
test('two isolated device sessions compare conflicts, preserve later edits, and keep one ID', async ({ page, browser }, info) => {
  const email = `devices-${info.project.name}-${Date.now()}@example.test`;
  await open(page, email);
  const ids = await fixture(page, 'seed');
  const secondContext = await browser.newContext({ serviceWorkers: 'block' });
  const second = await secondContext.newPage();
  try {
    await open(second, email);
    await expect.poll(async () => (await fixture(second, 'state')).notes.length).toBe(2);
    await fixture(page, 'offline', [true]);
    await fixture(page, 'edit', [ids.noteId, 'Local device edits']);
    await fixture(second, 'cloud', [ids.noteId, 'Other device cloud edits']);
    await fixture(page, 'offline', [false]);
    await expect(page.getByRole('button', { name: 'Compare and choose' })).toBeVisible();
    await page.getByRole('button', { name: 'Compare and choose' }).click();
    await expect(page.getByText('Local device edits', { exact: true })).toBeVisible();
    await expect(page.getByText('Other device cloud edits', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review later' }).click();
    await fixture(page, 'edit', [ids.noteId, 'Latest draft while deciding']);
    await page.getByRole('button', { name: 'Compare and choose' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Keep my current edits' }).click();
    await expect.poll(async () => (await fixture(second, 'cloud', [ids.noteId])).content).toBe('Latest draft while deciding');
    expect(await fixture(second, 'cloudCount')).toBe(2);
    expect((await fixture(page, 'state')).conflicts).toHaveLength(0);
    await page.screenshot({ path: `test-evidence/fix-v290/${info.project.name}-resolved.png` });
  } finally { await secondContext.close(); }
});
test('same-context tabs preserve pending conflicts across reload; Keep Cloud cancels editor drafts', async ({ page, context }, info) => {
  await open(page, `tabs-${info.project.name}-${Date.now()}@example.test`);
  const ids = await fixture(page, 'seed');
  const tab = await context.newPage();
  await tab.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => fixture(tab, 'ready')).toBe(true);
  await fixture(page, 'pauseSync', [true]);
  await fixture(page, 'edit', [ids.noteId, 'Local tab unsynced']);
  await fixture(tab, 'cloud', [ids.noteId, 'Cloud tab version']);
  await fixture(page, 'pauseSync', [false]);
  await expect.poll(async () => (await fixture(page, 'state')).conflicts.length).toBe(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => fixture(page, 'ready')).toBe(true);
  await expect.poll(async () => (await fixture(page, 'state')).conflicts.length).toBe(1);
  await fixture(page, 'view', ['notebooks', ids.notebookId, ids.noteId]);
  await page.getByPlaceholder('Start writing...').fill('Draft immediately before discard');
  await page.getByRole('button', { name: 'Compare and choose' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Keep cloud version' }).click();
  await expect(page.getByPlaceholder('Start writing...')).toHaveValue('Cloud tab version');
  await fixture(page, 'sync');
  await expect.poll(async () => (await fixture(tab, 'cloud', [ids.noteId])).content).toBe('Cloud tab version');
  expect(await fixture(tab, 'cloudCount')).toBe(2);
  await tab.close();
});
test('remote deletion waits for review and explicit restore reuses the original ID', async ({ page, browser }, info) => {
  const email = `deletion-${info.project.name}-${Date.now()}@example.test`;
  await open(page, email);
  const ids = await fixture(page, 'seed');
  const otherContext = await browser.newContext({ serviceWorkers: 'block' });
  const other = await otherContext.newPage();
  try {
    await open(other, email);
    await fixture(page, 'offline', [true]);
    await fixture(page, 'edit', [ids.noteId, 'Draft after remote deletion']);
    await fixture(other, 'removeCloud', [ids.noteId]);
    await fixture(page, 'offline', [false]);
    await page.getByRole('button', { name: 'Compare and choose' }).click();
    await expect(page.getByRole('heading', { name: 'Cloud copy deleted' })).toBeVisible();
    expect(await fixture(other, 'cloudCount')).toBe(1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Restore my draft' }).click();
    await expect.poll(async () => (await fixture(other, 'cloud', [ids.noteId]))?.content).toBe('Draft after remote deletion');
    expect(await fixture(other, 'cloudCount')).toBe(2);
  } finally { await otherContext.close(); }
});
