import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Cloud, FolderPlus, HardDrive, KeyRound,
  Loader2, PlugZap, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, TriangleAlert, Volume2,
} from 'lucide-react';
import { useStore } from '@/store';
import {
  createAiConnection, createAiGroup, createStorageConnection, createStorageGroup, deleteAiConnection,
  deleteAiGroup, deleteStorageConnection, deleteStorageGroup, getAiGatewayStatus, getGatewayUrl,
  setGatewayUrlOverride, testAiConnection, testAllAiConnections, testAllStorageConnections,
  testStorageConnection, updateAiConnection, updateAiGroup, updateGatewayPolicy, updateStorageConnection,
  updateStorageGroup, updateStorageRoutes, updateListenEnginePolicy, type AiConnectionStatus, type AiGatewayStatus,
  type AiProviderKind, type ConnectionGroupStatus, type StorageConnectionStatus, type StoragePurpose,
  type StorageProviderKind, type ListenEngineConfig,
} from '@/utils/ntkAi';

const statusTone = {
  ready: 'text-emerald-600 bg-emerald-500/10',
  limited: 'text-amber-600 bg-amber-500/10',
  attention: 'text-rose-600 bg-rose-500/10',
  off: 'text-theme-tertiary theme-muted-surface',
} as const;
const statusLabel = { ready: 'Ready', limited: 'Taking a break', attention: 'Needs attention', off: 'Off' } as const;
const PURPOSES: Array<{ id: StoragePurpose; label: string; description: string }> = [
  { id: 'profilePhotos', label: 'Profile photos', description: 'Avatars and personal profile images.' },
  { id: 'images', label: 'Images', description: 'Photos and illustrations embedded in notes.' },
  { id: 'voiceNotes', label: 'Voice notes', description: 'Audio recordings and voice memos.' },
  { id: 'attachments', label: 'Attachments', description: 'Documents, images and files added to notes.' },
  { id: 'backups', label: 'Backups', description: 'Safety copies of your NTK Note data.' },
  { id: 'exports', label: 'Exports', description: 'Files created when you export notes or notebooks.' },
];
const STORAGE_PROVIDER_LABELS: Record<StorageProviderKind, string> = {
  r2: 'Cloudflare R2', backblaze: 'Backblaze B2', supabase: 'Supabase Storage', s3: 'Other compatible storage',
};

const emptyAiForm = {
  id: '', name: '', provider: 'gemini' as AiProviderKind, groupId: '', apiKey: '', modelMode: 'automatic' as 'automatic'|'manual',
  model: '', baseUrl: '', priority: 50, notes: '', enabled: true,
};
const emptyStorageForm = {
  id: '', name: '', provider: 'r2' as StorageProviderKind, groupId: '', endpoint: '', bucket: '', region: 'auto',
  accessKeyId: '', secretAccessKey: '', publicBaseUrl: '', useWorkerBinding: false,
  allowedPurposes: ['profilePhotos', 'images', 'voiceNotes', 'attachments', 'backups', 'exports'] as StoragePurpose[], priority: 50, notes: '', enabled: true,
};

export default function AiSettingsPanel() {
  const { settings, updateSettings } = useStore();
  const [status, setStatus] = useState<AiGatewayStatus | null>(null);
  const [statusText, setStatusText] = useState('Checking NTK AI…');
  const [gatewayInput, setGatewayInput] = useState(getGatewayUrl());
  const [showOwnerTools, setShowOwnerTools] = useState(false);
  const [busy, setBusy] = useState('');
  const [guestEnabled, setGuestEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(25);
  const [costProtection, setCostProtection] = useState(true);
  const [responseLength, setResponseLength] = useState(2048);
  const [messages, setMessages] = useState({
    preparing: 'Getting your answer ready…', rerouting: 'Finding another available AI…',
    finalAttempt: 'This is taking longer than usual. Trying one last route…',
    unavailable: "NTK AI is unavailable right now, so I stopped trying rather than keep you waiting. Your note is unchanged. Please try again later.",
  });
  const [newAiGroupName, setNewAiGroupName] = useState('');
  const [newStorageGroupName, setNewStorageGroupName] = useState('');
  const [editingAi, setEditingAi] = useState(false);
  const [aiForm, setAiForm] = useState({ ...emptyAiForm });
  const [editingStorage, setEditingStorage] = useState(false);
  const [storageForm, setStorageForm] = useState({ ...emptyStorageForm });
  const [listenMode, setListenMode] = useState<'automatic' | 'cloudflare' | 'google' | 'custom'>('automatic');
  const [cloudflareEnabled, setCloudflareEnabled] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(true);

  const refresh = async () => {
    setStatusText('Checking NTK AI…');
    try {
      const next = await getAiGatewayStatus();
      setStatus(next);
      setGuestEnabled(next.guestAIEnabled);
      setDailyLimit(next.dailyUserLimit || 25);
      setCostProtection(next.costProtection !== false);
      setResponseLength(next.maxOutputTokens || 2048);
      setMessages(current => ({ ...current, ...(next.messages || {}) }));
      if (next.listenEngine) {
        setListenMode(next.listenEngine.mode || 'automatic');
        setCloudflareEnabled(next.listenEngine.cloudflareEnabled !== false);
        setGoogleEnabled(next.listenEngine.googleEnabled !== false);
      }
      setStatusText(next.aiAvailable ? 'NTK AI is ready.' : next.connected ? 'NTK AI is connected, but no AI connection is ready yet.' : 'NTK AI gateway is not connected yet.');
    } catch (error) {
      setStatus(null);
      setStatusText(error instanceof Error ? error.message : 'NTK AI connection could not be checked.');
    }
  };
  useEffect(() => { void refresh(); }, []);

  const saveListenEngine = async (updates: Partial<ListenEngineConfig>) => {
    setBusy('listen-policy');
    try {
      await updateListenEnginePolicy(updates);
      await refresh();
      setStatusText('Listen engine settings saved.');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Could not update listen engine.');
    } finally {
      setBusy('');
    }
  };

  const providerCatalog = status?.providerCatalog?.length ? status.providerCatalog : [
    { id: 'freellmapi' as AiProviderKind, label: 'FreeLLMAPI / OpenAI-compatible router' },
    { id: 'openrouter' as AiProviderKind, label: 'OpenRouter' }, { id: 'gemini' as AiProviderKind, label: 'Google Gemini' },
    { id: 'groq' as AiProviderKind, label: 'Groq' }, { id: 'workers-ai' as AiProviderKind, label: 'Cloudflare AI' },
    { id: 'mistral' as AiProviderKind, label: 'Mistral' }, { id: 'cerebras' as AiProviderKind, label: 'Cerebras' },
    { id: 'custom' as AiProviderKind, label: 'Other compatible AI' },
  ];
  const aiConnectionsByGroup = useMemo(() => groupConnections(status?.aiConnections || [], status?.aiGroups || []), [status]);
  const storageConnectionsByGroup = useMemo(() => groupConnections(status?.storageConnections || [], status?.storageGroups || []), [status]);

  const saveGateway = async () => {
    setGatewayUrlOverride(gatewayInput);
    await refresh();
  };
  const savePolicy = async (updates: Record<string, unknown>) => {
    setBusy('policy');
    try { await updateGatewayPolicy(updates); await refresh(); }
    catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not save this setting.'); }
    finally { setBusy(''); }
  };

  const openNewAi = (groupId = '') => { setAiForm({ ...emptyAiForm, groupId }); setEditingAi(true); };
  const openEditAi = (item: AiConnectionStatus) => {
    setAiForm({ id: item.id, name: item.name, provider: item.provider, groupId: item.groupId || '', apiKey: '', modelMode: item.modelMode || 'automatic', model: item.model || '', baseUrl: '', priority: item.priority || 50, notes: item.notes || '', enabled: item.enabled });
    setEditingAi(true);
  };
  const saveAi = async () => {
    if (!aiForm.name.trim()) { setStatusText('Give this AI connection a name you will recognize.'); return; }
    setBusy('ai-save');
    try {
      const payload = { ...aiForm, apiKey: aiForm.apiKey || undefined, groupId: aiForm.groupId || null, model: aiForm.modelMode === 'manual' ? aiForm.model.trim() : '', baseUrl: aiForm.baseUrl || undefined };
      const result = aiForm.id ? await updateAiConnection(aiForm.id, payload) : await createAiConnection(payload);
      setEditingAi(false); setAiForm({ ...emptyAiForm }); await refresh();
      setStatusText(result.testOk === false ? String(result.message || 'Connection saved, but it needs attention.') : 'AI connection saved and checked.');
    } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not save this AI connection.'); }
    finally { setBusy(''); }
  };

  const openNewStorage = (groupId = '') => { setStorageForm({ ...emptyStorageForm, groupId }); setEditingStorage(true); };
  const openEditStorage = (item: StorageConnectionStatus) => {
    setStorageForm({ id: item.id, name: item.name, provider: item.provider, groupId: item.groupId || '', endpoint: '', bucket: '', region: 'auto', accessKeyId: '', secretAccessKey: '', publicBaseUrl: '', useWorkerBinding: !!item.useWorkerBinding, allowedPurposes: item.allowedPurposes, priority: item.priority || 50, notes: item.notes || '', enabled: item.enabled });
    setEditingStorage(true);
  };
  const saveStorage = async () => {
    if (!storageForm.name.trim()) { setStatusText('Give this storage connection a name you will recognize.'); return; }
    setBusy('storage-save');
    try {
      const payload = { ...storageForm, groupId: storageForm.groupId || null, endpoint: storageForm.endpoint || undefined, bucket: storageForm.bucket || undefined, accessKeyId: storageForm.accessKeyId || undefined, secretAccessKey: storageForm.secretAccessKey || undefined, publicBaseUrl: storageForm.publicBaseUrl || undefined };
      const result = storageForm.id ? await updateStorageConnection(storageForm.id, payload) : await createStorageConnection(payload);
      setEditingStorage(false); setStorageForm({ ...emptyStorageForm }); await refresh();
      setStatusText(result.testOk === false ? String(result.message || 'Storage saved, but it needs attention.') : 'Storage connection saved and checked.');
    } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not save this storage connection.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border theme-border theme-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ai-orb text-white"><Sparkles className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-bold text-theme-primary">NTK AI</h3><p className="mt-1 text-xs leading-5 text-theme-tertiary">Keep AI simple. NTK Note chooses an available connection for you and never changes a note until you approve the suggestion.</p></div>
              <button type="button" onClick={() => void refresh()} className="rounded-xl p-2 theme-hover text-theme-tertiary" aria-label="Refresh NTK AI status"><RefreshCw className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border theme-border px-3 py-2.5 theme-soft-panel">
              {status?.aiAvailable ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />}
              <p className="text-xs font-medium text-theme-secondary">{statusText}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl border theme-border px-3 py-3"><span><span className="block text-sm font-semibold text-theme-primary">Use NTK AI</span><span className="mt-0.5 block text-xs text-theme-tertiary">Show AI help throughout your notes.</span></span><input type="checkbox" checked={settings.aiEnabled} onChange={event => updateSettings({ aiEnabled: event.target.checked })} className="h-5 w-5 accent-range" /></label>
          <label className="rounded-xl border theme-border px-3 py-3"><span className="block text-sm font-semibold text-theme-primary">Writing style</span><select value={settings.aiWritingStyle} onChange={event => updateSettings({ aiWritingStyle: event.target.value as typeof settings.aiWritingStyle })} className="mt-2 w-full rounded-lg border theme-input px-2.5 py-2 text-xs"><option value="natural">Natural</option><option value="professional">Professional</option><option value="simple">Simple</option><option value="detailed">Detailed</option></select></label>
          <label className="rounded-xl border theme-border px-3 py-3 sm:col-span-2"><span className="block text-sm font-semibold text-theme-primary">Default note privacy</span><select value={settings.aiDefaultScope} onChange={event => updateSettings({ aiDefaultScope: event.target.value as typeof settings.aiDefaultScope })} className="mt-2 w-full rounded-lg border theme-input px-2.5 py-2 text-xs sm:max-w-sm"><option value="selection">Use selected text first — Recommended</option><option value="note">Use the whole note when I ask</option></select><p className="mt-2 text-xs text-theme-tertiary">NTK AI only sends text when you deliberately ask it to help.</p></label>
          <label className="flex items-center justify-between gap-3 rounded-xl border theme-border px-3 py-3 sm:col-span-2"><span><span className="block text-sm font-semibold text-theme-primary">Ask before using a whole note</span><span className="mt-0.5 block text-xs text-theme-tertiary">Recommended. You will see a clear confirmation before a full note is sent to NTK AI.</span></span><input type="checkbox" checked={settings.aiConfirmWholeNote} onChange={event => updateSettings({ aiConfirmWholeNote: event.target.checked })} className="h-5 w-5 accent-range" /></label>
        </div>
      </section>

      {!status?.connected && (
        <section className="rounded-2xl border theme-border theme-card p-4 sm:p-5">
          <div className="flex items-start gap-3"><PlugZap className="mt-0.5 h-5 w-5 accent-text" /><div className="flex-1"><h3 className="font-bold text-theme-primary">NTK AI is waiting for the owner to finish setup</h3><p className="mt-1 text-xs leading-5 text-theme-tertiary">Notes keep working normally. AI becomes available after the secure NTK connection is ready.</p><details className="mt-3 rounded-xl border theme-border p-3"><summary className="cursor-pointer text-xs font-bold text-theme-secondary">Owner setup</summary><p className="mt-2 text-xs leading-5 text-theme-tertiary">Paste the Cloudflare Worker address created for NTK Note. This is normally a one-time setup.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={gatewayInput} onChange={event => setGatewayInput(event.target.value)} placeholder="https://your-ntk-gateway.workers.dev" className="min-w-0 flex-1 rounded-xl border theme-input accent-focus px-3 py-2.5 text-sm outline-none" /><button type="button" onClick={() => void saveGateway()} className="rounded-xl accent-button px-4 py-2.5 text-sm font-bold">Connect</button></div></details></div></div>
        </section>
      )}

      {status?.isOwner && (
        <section className="rounded-2xl border theme-border theme-card p-4 sm:p-5">
          <button type="button" onClick={() => setShowOwnerTools(value => !value)} className="flex w-full items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-xl accent-soft accent-text"><ShieldCheck className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block font-bold text-theme-primary">Owner connections</span><span className="mt-0.5 block text-xs text-theme-tertiary">Manage shared AI, groups, guest access and file storage without changing source code.</span></span><ChevronDown className={`h-4 w-4 text-theme-tertiary transition-transform ${showOwnerTools ? 'rotate-180' : ''}`} /></button>

          {showOwnerTools && (
            <div className="mt-5 space-y-7 border-t theme-divider pt-5">
              <section>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-bold text-theme-primary">AI connections</h4><p className="mt-1 text-xs text-theme-tertiary">Add as many named connections as you need. Automatic routing remains the recommended default.</p></div><div className="flex gap-2"><button type="button" onClick={async () => { setBusy('test-ai'); try { const result = await testAllAiConnections() as { results?: Array<{ok:boolean}> }; await refresh(); setStatusText(result.results?.every(item => item.ok) ? 'All enabled AI connections are responding.' : 'Connection check finished. Review anything marked Needs attention.'); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not check connections.'); } finally { setBusy(''); } }} className="rounded-lg border theme-border theme-hover px-3 py-2 text-xs font-bold text-theme-secondary">{busy === 'test-ai' ? 'Checking…' : 'Check all'}</button><button type="button" onClick={() => openNewAi()} className="inline-flex items-center gap-1.5 rounded-lg accent-button px-3 py-2 text-xs font-bold"><Plus className="h-3.5 w-3.5" /> Add connection</button></div></div>

                <div className="mt-3 rounded-xl border theme-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold text-theme-primary">How should NTK AI choose?</p><p className="mt-0.5 text-[11px] text-theme-tertiary">Automatic chooses a suitable healthy connection. My order is available if you want a fixed fallback preference.</p></div><select value={status.routingMode || 'automatic'} onChange={event => void savePolicy({ routingMode: event.target.value })} className="rounded-lg border theme-input px-2.5 py-2 text-xs"><option value="automatic">Automatic — Recommended</option><option value="manual">My order</option></select></div>
                  {status.routingMode === 'manual' && <ManualOrder connections={status.aiConnections} order={status.connectionOrder || []} onChange={connectionOrder => void savePolicy({ routingMode: 'manual', connectionOrder })} />}
                  <details className="mt-3 rounded-lg theme-muted-surface p-3"><summary className="cursor-pointer text-xs font-bold text-theme-secondary">Advanced routing</summary><label className="mt-3 flex items-center justify-between gap-3"><span><span className="block text-xs font-bold text-theme-primary">Respect group order</span><span className="mt-0.5 block text-[11px] text-theme-tertiary">Off by default. When on, higher groups are preferred before connection suitability.</span></span><input type="checkbox" checked={!!status.respectGroupPriority} onChange={event => void savePolicy({ respectGroupPriority: event.target.checked })} className="h-5 w-5 accent-range" /></label></details>
                </div>

                <GroupManager title="AI groups" groups={status.aiGroups} newName={newAiGroupName} setNewName={setNewAiGroupName} onCreate={async name => { await createAiGroup(name); await refresh(); }} onUpdate={async (id, updates) => { await updateAiGroup(id, updates); await refresh(); }} onDelete={async id => { await deleteAiGroup(id); await refresh(); }} />

                <div className="mt-3 space-y-3">
                  {aiConnectionsByGroup.map(section => <ConnectionSection key={section.id} title={section.name} actionLabel="Add here" onAdd={() => openNewAi(section.id === 'ungrouped' ? '' : section.id)}>{section.items.length ? section.items.map(item => <ConnectionCard key={item.id} item={item} onEdit={() => openEditAi(item)} />) : <EmptyLine text="No AI connections in this group yet." />}</ConnectionSection>)}
                  {!status.aiConnections.length && <EmptyLine text="No AI connections yet. Add OpenRouter, Gemini, Groq or another service when you are ready." />}
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border theme-border p-3"><span><span className="block text-sm font-bold text-theme-primary">Guest AI</span><span className="mt-0.5 block text-xs text-theme-tertiary">Allow secure Firebase Guest sessions to use NTK AI.</span></span><input type="checkbox" checked={guestEnabled} onChange={event => { setGuestEnabled(event.target.checked); void savePolicy({ guestAIEnabled: event.target.checked }); }} className="h-5 w-5 accent-range" /></label>
                <label className="rounded-xl border theme-border p-3"><span className="block text-sm font-bold text-theme-primary">Daily allowance per person</span><div className="mt-2 flex gap-2"><input type="number" min={1} max={500} value={dailyLimit} onChange={event => setDailyLimit(Math.max(1, Number(event.target.value) || 1))} className="w-24 rounded-lg border theme-input px-2 py-1.5 text-sm" /><button type="button" disabled={busy === 'policy'} onClick={() => void savePolicy({ dailyUserLimit: dailyLimit })} className="rounded-lg border theme-border theme-hover px-3 py-1.5 text-xs font-bold text-theme-secondary">Save</button></div></label>
                <label className="flex items-center justify-between gap-3 rounded-xl border theme-border p-3"><span><span className="block text-sm font-bold text-theme-primary">Cost protection</span><span className="mt-0.5 block text-xs leading-5 text-theme-tertiary">Keep OpenRouter Automatic on no-cost routes while this is on.</span></span><input type="checkbox" checked={costProtection} onChange={event => { setCostProtection(event.target.checked); void savePolicy({ costProtection: event.target.checked }); }} className="h-5 w-5 accent-range" /></label>
                <label className="rounded-xl border theme-border p-3"><span className="block text-sm font-bold text-theme-primary">Typical answer length</span><select value={responseLength} onChange={event => { const value = Number(event.target.value); setResponseLength(value); void savePolicy({ maxOutputTokens: value }); }} className="mt-2 w-full rounded-lg border theme-input px-2.5 py-2 text-xs"><option value={1024}>Concise</option><option value={2048}>Balanced — Recommended</option><option value={4096}>Detailed</option></select></label>
              </section>

              <details className="rounded-xl border theme-border p-3"><summary className="cursor-pointer text-sm font-bold text-theme-primary">Friendly messages</summary><p className="mt-1 text-xs text-theme-tertiary">These keep people informed without exposing provider details.</p><div className="mt-3 space-y-2">{(['preparing','rerouting','finalAttempt','unavailable'] as const).map(key => <label key={key} className="block"><span className="mb-1 block text-[11px] font-bold capitalize text-theme-tertiary">{key.replace(/([A-Z])/g, ' $1')}</span><input value={messages[key]} onChange={event => setMessages(current => ({ ...current, [key]: event.target.value }))} className="w-full rounded-lg border theme-input px-3 py-2 text-xs" /></label>)}<button type="button" onClick={() => void savePolicy({ messages })} className="rounded-lg accent-button px-3 py-2 text-xs font-bold">Save messages</button></div></details>

              <section className="rounded-xl border theme-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-theme-primary">NTK Storage Guard — Free Plan Protection</h4>
                    <p className="mt-1 text-xs text-theme-tertiary">Helps you keep storage well within standard included free tiers without billing surprises.</p>
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-theme-secondary">Protection</span>
                    <input
                      type="checkbox"
                      checked={settings.storageGuardEnabled ?? true}
                      onChange={e => updateSettings({ storageGuardEnabled: e.target.checked })}
                      className="h-5 w-5 accent-range"
                    />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg theme-muted-surface p-3">
                    <span className="block text-xs font-bold text-theme-primary">Cloudflare R2 Safety Target</span>
                    <span className="mt-0.5 block text-[11px] text-theme-tertiary">Leaves safe headroom below the 10 GB-month included allowance.</span>
                    <div className="mt-2 text-sm font-bold accent-text">8 GB Safety Target</div>
                  </div>
                  <div className="rounded-lg theme-muted-surface p-3">
                    <span className="block text-xs font-bold text-theme-primary">Backblaze B2 Safety Target</span>
                    <span className="mt-0.5 block text-[11px] text-theme-tertiary">Ideal for independent automated backups and recovery snapshots.</span>
                    <div className="mt-2 text-sm font-bold text-emerald-600">8 GB Safety Target</div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border theme-border p-4">
                <h4 className="text-sm font-bold text-theme-primary">Voice Note Recording Settings</h4>
                <p className="mt-1 text-xs text-theme-tertiary">Configure browser audio recording format and duration limits.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold text-theme-secondary">
                    Voice note quality
                    <select
                      value={settings.voiceNoteQuality || 'standard'}
                      onChange={e => updateSettings({ voiceNoteQuality: e.target.value as 'standard' | 'high' })}
                      className="mt-1 w-full rounded-lg border theme-input px-2.5 py-2 text-xs"
                    >
                      <option value="standard">Standard (Opus WebM) — Recommended</option>
                      <option value="high">High quality</option>
                    </select>
                  </label>
                  <label className="text-xs font-bold text-theme-secondary">
                    Maximum recording duration
                    <select
                      value={settings.voiceNoteMaxDurationMinutes || 15}
                      onChange={e => updateSettings({ voiceNoteMaxDurationMinutes: Number(e.target.value) || 15 })}
                      className="mt-1 w-full rounded-lg border theme-input px-2.5 py-2 text-xs"
                    >
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes — Recommended</option>
                      <option value={30}>30 minutes</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="rounded-xl border theme-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-theme-primary flex items-center gap-1.5">
                      <Volume2 className="h-4 w-4 accent-text" />
                      Listen Engine — Speech & Voice Settings
                    </h4>
                    <p className="mt-1 text-xs text-theme-tertiary">
                      Configure speech generation for reading notes aloud. Zero-cost quota protection is automatically enforced.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-bold text-theme-secondary">
                      Listen Engine Mode
                    </label>
                    <select
                      value={listenMode}
                      onChange={e => {
                        const mode = e.target.value as 'automatic' | 'cloudflare' | 'google' | 'custom';
                        setListenMode(mode);
                        void saveListenEngine({ mode });
                      }}
                      className="mt-1 w-full rounded-lg border theme-input px-2.5 py-2 text-xs"
                    >
                      <option value="automatic">Automatic (Recommended: Cloudflare first, then Google)</option>
                      <option value="cloudflare">Cloudflare Speech Only</option>
                      <option value="google">Google Speech Fallback Only</option>
                      <option value="custom">Custom Provider Order</option>
                    </select>
                    <p className="mt-1 text-[11px] text-theme-tertiary">
                      Automatic switches seamlessly between verified free providers without interruption.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center justify-between gap-3 rounded-lg theme-muted-surface p-2.5">
                      <div>
                        <span className="block text-xs font-bold text-theme-primary">Cloudflare Workers AI Speech</span>
                        <span className="block text-[10px] text-theme-tertiary">MeloTTS · Free tier included (10,000 Neurons/day)</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={cloudflareEnabled}
                        onChange={e => {
                          setCloudflareEnabled(e.target.checked);
                          void saveListenEngine({ cloudflareEnabled: e.target.checked });
                        }}
                        className="h-4 w-4 accent-range"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg theme-muted-surface p-2.5">
                      <div>
                        <span className="block text-xs font-bold text-theme-primary">Google Speech Fallback</span>
                        <span className="block text-[10px] text-theme-tertiary">Provides Hausa native synthesis & reliable backup</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={googleEnabled}
                        onChange={e => {
                          setGoogleEnabled(e.target.checked);
                          void saveListenEngine({ googleEnabled: e.target.checked });
                        }}
                        className="h-4 w-4 accent-range"
                      />
                    </label>
                  </div>
                </div>

                {/* Provider Diagnostics & Status */}
                <div className="mt-3 rounded-lg border theme-border p-3 theme-soft-panel space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-theme-primary">Active Engine Diagnostics:</span>
                    <span className="font-mono text-[11px] accent-text font-bold">
                      {status?.speechEngine?.activeEngine || 'ntk-note-gateway'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                    <div className="rounded border theme-border p-1.5 theme-card">
                      <span className="block text-theme-tertiary text-[10px]">Cloudflare AI</span>
                      <span className="font-bold text-emerald-600">
                        {status?.speechEngine?.cloudflareAvailable ? 'Ready' : 'Standby / Cooldown'}
                      </span>
                    </div>
                    <div className="rounded border theme-border p-1.5 theme-card">
                      <span className="block text-theme-tertiary text-[10px]">Google Fallback</span>
                      <span className="font-bold text-emerald-600">
                        {status?.speechEngine?.googleAvailable ? 'Ready' : 'Off'}
                      </span>
                    </div>
                    <div className="rounded border theme-border p-1.5 theme-card">
                      <span className="block text-theme-tertiary text-[10px]">Nigerian English</span>
                      <span className="font-bold text-blue-600">Closest Match</span>
                    </div>
                    <div className="rounded border theme-border p-1.5 theme-card">
                      <span className="block text-theme-tertiary text-[10px]">Hausa Language</span>
                      <span className="font-bold text-emerald-600">Google Native</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-theme-tertiary pt-1">
                    Free allocation protection: No paid upgrades. If free limits are reached, the system pauses Cloudflare speech until 00:00 UTC and routes to Google Speech Fallback.
                  </p>
                </div>
              </section>

              <section>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-bold text-theme-primary">File storage connections</h4><p className="mt-1 text-xs text-theme-tertiary">Name and organize storage connections, then choose what each one should handle.</p></div><div className="flex gap-2"><button type="button" onClick={async () => { setBusy('test-storage'); try { const result = await testAllStorageConnections() as { results?: Array<{ok:boolean}> }; await refresh(); setStatusText(result.results?.every(item => item.ok) ? 'All enabled storage connections are responding.' : 'Storage check finished. Review anything marked Needs attention.'); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not check storage.'); } finally { setBusy(''); } }} className="rounded-lg border theme-border theme-hover px-3 py-2 text-xs font-bold text-theme-secondary">{busy === 'test-storage' ? 'Checking…' : 'Check all'}</button><button type="button" onClick={() => openNewStorage()} className="inline-flex items-center gap-1.5 rounded-lg accent-button px-3 py-2 text-xs font-bold"><Plus className="h-3.5 w-3.5" /> Add storage</button></div></div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {PURPOSES.map(purpose => <label key={purpose.id} className="rounded-xl border theme-border p-3"><span className="block text-sm font-bold text-theme-primary">{purpose.label}</span><span className="mt-0.5 block text-[11px] text-theme-tertiary">{purpose.description}</span><select value={status.storageRoutes?.[purpose.id] || 'automatic'} onChange={async event => { try { await updateStorageRoutes({ [purpose.id]: event.target.value }); await refresh(); setStatusText(`${purpose.label} storage updated.`); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not change storage destination.'); } }} className="mt-2 w-full rounded-lg border theme-input px-2.5 py-2 text-xs"><option value="automatic">Automatic — Recommended</option>{status.storageConnections.filter(item => item.allowedPurposes.includes(purpose.id)).map(item => <option key={item.id} value={item.id}>{item.name}{item.connected ? '' : ' — needs attention'}</option>)}</select></label>)}
                </div>

                <GroupManager title="Storage groups" groups={status.storageGroups} newName={newStorageGroupName} setNewName={setNewStorageGroupName} onCreate={async name => { await createStorageGroup(name); await refresh(); }} onUpdate={async (id, updates) => { await updateStorageGroup(id, updates); await refresh(); }} onDelete={async id => { await deleteStorageGroup(id); await refresh(); }} />

                <div className="mt-3 space-y-3">{storageConnectionsByGroup.map(section => <ConnectionSection key={section.id} title={section.name} actionLabel="Add here" onAdd={() => openNewStorage(section.id === 'ungrouped' ? '' : section.id)}>{section.items.length ? section.items.map(item => <StorageCard key={item.id} item={item} onEdit={() => openEditStorage(item)} />) : <EmptyLine text="No storage connections in this group yet." />}</ConnectionSection>)}{!status.storageConnections.length && <EmptyLine text="No external storage is connected yet. NTK Note can continue without it until you are ready." />}</div>
              </section>
            </div>
          )}
        </section>
      )}

      {editingAi && status?.isOwner && <AiConnectionDialog form={aiForm} setForm={setAiForm} providers={providerCatalog} groups={status.aiGroups} busy={busy === 'ai-save'} onSave={() => void saveAi()} onClose={() => setEditingAi(false)} onTest={aiForm.id ? async () => { try { await testAiConnection(aiForm.id); await refresh(); setStatusText(`${aiForm.name} is responding.`); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Connection test failed.'); } } : undefined} onDelete={aiForm.id ? async () => { if (!window.confirm(`Remove “${aiForm.name}”?`)) return; try { await deleteAiConnection(aiForm.id); setEditingAi(false); await refresh(); setStatusText('AI connection removed.'); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not remove this connection.'); } } : undefined} />}
      {editingStorage && status?.isOwner && <StorageConnectionDialog form={storageForm} setForm={setStorageForm} groups={status.storageGroups} busy={busy === 'storage-save'} onSave={() => void saveStorage()} onClose={() => setEditingStorage(false)} onTest={storageForm.id ? async () => { try { await testStorageConnection(storageForm.id); await refresh(); setStatusText(`${storageForm.name} is responding.`); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Storage test failed.'); } } : undefined} onDelete={storageForm.id ? async () => { if (!window.confirm(`Remove “${storageForm.name}”?`)) return; try { await deleteStorageConnection(storageForm.id); setEditingStorage(false); await refresh(); setStatusText('Storage connection removed.'); } catch (error) { setStatusText(error instanceof Error ? error.message : 'Could not remove storage.'); } } : undefined} />}
    </div>
  );
}

function groupConnections<T extends { groupId?: string }>(connections: T[], groups: ConnectionGroupStatus[]) {
  const sections = groups.slice().sort((a, b) => a.priority - b.priority).map(group => ({ id: group.id, name: group.name, items: connections.filter(item => item.groupId === group.id) }));
  const known = new Set(groups.map(group => group.id));
  const ungrouped = connections.filter(item => !item.groupId || !known.has(item.groupId));
  if (ungrouped.length || !sections.length) sections.unshift({ id: 'ungrouped', name: 'Ungrouped', items: ungrouped });
  return sections;
}

function EmptyLine({ text }: { text: string }) { return <div className="rounded-xl border border-dashed theme-border px-3 py-4 text-xs text-theme-tertiary">{text}</div>; }

function ConnectionSection({ title, actionLabel, onAdd, children }: { title: string; actionLabel: string; onAdd: () => void; children: ReactNode }) {
  return <div className="rounded-xl border theme-border p-3"><div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg theme-muted-surface"><Cloud className="h-3.5 w-3.5 accent-text" /></span><p className="text-xs font-bold text-theme-primary">{title}</p></div><button type="button" onClick={onAdd} aria-label={`Add ${actionLabel}`} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold accent-text theme-hover">+ {actionLabel}</button></div><div className="grid gap-2 sm:grid-cols-2">{children}</div></div>;
}

function ConnectionCard({ item, onEdit }: { item: AiConnectionStatus; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} className="flex flex-col gap-2 rounded-xl border theme-border p-3 text-left theme-hover w-full">
      <div className="flex items-center gap-3 w-full">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl theme-muted-surface"><Sparkles className="h-4 w-4 accent-text" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-theme-primary">{item.name}</span>
          <span className="block truncate text-[11px] text-theme-tertiary">{item.providerLabel} · {item.message || 'Not checked yet'}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-extrabold uppercase ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>
      </div>
      {item.capabilities && (
        <div className="flex flex-wrap gap-1.5 border-t theme-border pt-2 w-full">
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${item.capabilities.text ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-500'}`}>
            Writing — {item.capabilities.text ? 'Ready' : 'Not available'}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${item.capabilities.tts ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>
            Listen — {item.capabilities.tts ? 'Ready' : 'Not available'}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${item.capabilities.transcription ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>
            Transcribe — {item.capabilities.transcription ? 'Ready' : 'Not available'}
          </span>
        </div>
      )}
    </button>
  );
}
function StorageCard({ item, onEdit }: { item: StorageConnectionStatus; onEdit: () => void }) {
  return <button type="button" onClick={onEdit} className="flex items-center gap-3 rounded-xl border theme-border p-3 text-left theme-hover"><span className="flex h-9 w-9 items-center justify-center rounded-xl theme-muted-surface"><HardDrive className="h-4 w-4 accent-text" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-theme-primary">{item.name}</span><span className="block truncate text-[11px] text-theme-tertiary">{STORAGE_PROVIDER_LABELS[item.provider]} · {item.allowedPurposes.length} uses</span></span><span className={`rounded-full px-2 py-1 text-[9px] font-extrabold uppercase ${statusTone[item.status]}`}>{statusLabel[item.status]}</span></button>;
}

function GroupManager({ title, groups, newName, setNewName, onCreate, onUpdate, onDelete }: { title: string; groups: ConnectionGroupStatus[]; newName: string; setNewName: (value:string)=>void; onCreate:(name:string)=>Promise<void>; onUpdate:(id:string,updates:Record<string,unknown>)=>Promise<void>; onDelete:(id:string)=>Promise<void> }) {
  const [open, setOpen] = useState(false);
  const orderedGroups = [...groups].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  return <details className="mt-3 rounded-xl border theme-border p-3" open={open} onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}><summary className="cursor-pointer text-xs font-bold text-theme-primary">{title} <span className="font-normal text-theme-tertiary">({groups.length})</span></summary><p className="mt-1 text-[11px] text-theme-tertiary">Groups are optional folders for organization. Automatic routing still works across enabled groups.</p><div className="mt-3 space-y-2">{orderedGroups.map((group,index) => <div key={group.id} className="flex items-center gap-2 rounded-lg theme-muted-surface px-2.5 py-2"><input defaultValue={group.name} onBlur={event => { const name = event.target.value.trim(); if (name && name !== group.name) void onUpdate(group.id,{name}); }} className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-theme-secondary outline-none" aria-label={`Rename ${group.name}`} /><button type="button" onClick={() => void onUpdate(group.id,{enabled:!group.enabled})} className={`rounded-full px-2 py-1 text-[9px] font-bold ${group.enabled?'bg-emerald-500/10 text-emerald-600':'theme-card text-theme-tertiary'}`}>{group.enabled?'On':'Off'}</button><button type="button" disabled={index===0} onClick={() => void onUpdate(group.id,{priority:Math.max(1,(orderedGroups[index-1]?.priority||group.priority)-1)})} className="rounded p-1 theme-hover disabled:opacity-30" aria-label="Move group up"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" disabled={index===orderedGroups.length-1} onClick={() => void onUpdate(group.id,{priority:Math.min(100,(orderedGroups[index+1]?.priority||group.priority)+1)})} className="rounded p-1 theme-hover disabled:opacity-30" aria-label="Move group down"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => { if (window.confirm(`Remove group “${group.name}”? Connections will move to Ungrouped.`)) void onDelete(group.id); }} className="rounded p-1 text-rose-500 theme-hover" aria-label={`Delete ${group.name}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}<div className="flex gap-2"><input value={newName} onChange={event=>setNewName(event.target.value)} placeholder="New group name" className="min-w-0 flex-1 rounded-lg border theme-input px-2.5 py-2 text-xs" /><button type="button" onClick={async()=>{const name=newName.trim();if(!name)return;await onCreate(name);setNewName('');}} className="inline-flex items-center gap-1 rounded-lg border theme-border theme-hover px-3 py-2 text-xs font-bold"><FolderPlus className="h-3.5 w-3.5" /> Add group</button></div></div></details>;
}

function ManualOrder({ connections, order, onChange }: { connections: AiConnectionStatus[]; order: string[]; onChange:(order:string[])=>void }) {
  const list = [...order.filter(id=>connections.some(item=>item.id===id)), ...connections.map(item=>item.id).filter(id=>!order.includes(id))];
  return <div className="mt-3 space-y-1">{list.map((id,index)=>{const item=connections.find(connection=>connection.id===id)!;return <div key={id} className="flex items-center gap-2 rounded-lg theme-muted-surface px-2.5 py-2"><span className="min-w-0 flex-1 truncate text-xs font-semibold text-theme-secondary">{index+1}. {item.name}</span><button type="button" disabled={index===0} onClick={()=>{const next=[...list];[next[index-1],next[index]]=[next[index],next[index-1]];onChange(next);}} className="rounded-lg p-1.5 theme-hover disabled:opacity-30" aria-label={`Move ${item.name} up`}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" disabled={index===list.length-1} onClick={()=>{const next=[...list];[next[index+1],next[index]]=[next[index],next[index+1]];onChange(next);}} className="rounded-lg p-1.5 theme-hover disabled:opacity-30" aria-label={`Move ${item.name} down`}><ArrowDown className="h-3.5 w-3.5" /></button></div>})}</div>;
}

function AiConnectionDialog({ form, setForm, providers, groups, busy, onSave, onClose, onTest, onDelete }: { form: typeof emptyAiForm; setForm: Dispatch<SetStateAction<typeof emptyAiForm>>; providers:Array<{id:AiProviderKind;label:string}>; groups:ConnectionGroupStatus[]; busy:boolean; onSave:()=>void; onClose:()=>void; onTest?:()=>Promise<void>; onDelete?:()=>Promise<void> }) {
  const providerLabel = providers.find(item=>item.id===form.provider)?.label || 'AI';
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/35 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className="theme-menu max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border p-5 sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-theme-primary">{form.id?'Edit':'Add'} AI connection</h3><p className="mt-1 text-xs leading-5 text-theme-tertiary">Give it any name you like. The saved key stays behind the secure NTK gateway.</p></div>{form.id && <span className="rounded-full accent-soft px-2 py-1 text-[10px] font-bold accent-text">{providerLabel}</span>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-theme-secondary">Connection name<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder={form.provider==='freellmapi'?'e.g. FreeLLMAPI Router':'e.g. Main Gemini'} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary">AI service<select value={form.provider} onChange={e=>setForm(v=>({...v,provider:e.target.value as AiProviderKind}))} disabled={!!form.id} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm disabled:opacity-60">{providers.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-xs font-bold text-theme-secondary">Group — optional<select value={form.groupId} onChange={e=>setForm(v=>({...v,groupId:e.target.value}))} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm"><option value="">Ungrouped</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label className="text-xs font-bold text-theme-secondary">API key<input type="password" value={form.apiKey} onChange={e=>setForm(v=>({...v,apiKey:e.target.value}))} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" autoComplete="off" placeholder={form.id?'Leave blank to keep saved key':'Paste API key'} /></label></div><details className="mt-3 rounded-xl border theme-border p-3"><summary className="cursor-pointer text-xs font-bold text-theme-secondary">Advanced options</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-theme-secondary">Model choice<select value={form.modelMode} onChange={e=>setForm(v=>({...v,modelMode:e.target.value as 'automatic'|'manual'}))} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm"><option value="automatic">Automatic — Recommended</option><option value="manual">Choose a model</option></select></label>{form.modelMode==='manual'&&<label className="text-xs font-bold text-theme-secondary">Model ID<input value={form.model} onChange={e=>setForm(v=>({...v,model:e.target.value}))} placeholder={form.provider==='freellmapi'?'auto':''} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label>}<label className="text-xs font-bold text-theme-secondary sm:col-span-2">Custom service address — optional<input value={form.baseUrl} onChange={e=>setForm(v=>({...v,baseUrl:e.target.value}))} placeholder={form.provider==='freellmapi'?'https://freellmapi.alwaysdata.net/v1':form.provider==='custom'?'Required for compatible AI':'Leave blank for the recommended address'} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary">Preference<input type="number" min={1} max={100} value={form.priority} onChange={e=>setForm(v=>({...v,priority:Number(e.target.value)||50}))} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /><span className="mt-1 block font-normal text-theme-tertiary">Lower numbers are preferred when choices are otherwise equal.</span></label><label className="flex items-center justify-between gap-3 rounded-xl border theme-border px-3 py-2"><span className="text-xs font-bold text-theme-secondary">Enabled</span><input type="checkbox" checked={form.enabled} onChange={e=>setForm(v=>({...v,enabled:e.target.checked}))} className="h-5 w-5 accent-range" /></label><label className="text-xs font-bold text-theme-secondary sm:col-span-2">Private note — optional<textarea value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} rows={2} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" placeholder="e.g. Work account" /></label></div></details><div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={onSave} className="inline-flex items-center gap-1.5 rounded-xl accent-button px-4 py-2.5 text-sm font-bold">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<KeyRound className="h-4 w-4"/>} Save & check</button>{onTest&&<button type="button" onClick={()=>void onTest()} className="rounded-xl border theme-border theme-hover px-4 py-2.5 text-sm font-bold text-theme-secondary">Check connection</button>}{onDelete&&<button type="button" onClick={()=>void onDelete()} className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-sm font-bold text-rose-600">Remove</button>}<button type="button" onClick={onClose} className="ml-auto rounded-xl px-4 py-2.5 text-sm font-bold text-theme-tertiary theme-hover">Cancel</button></div></div></div>;
}

function StorageConnectionDialog({ form, setForm, groups, busy, onSave, onClose, onTest, onDelete }: { form: typeof emptyStorageForm; setForm: Dispatch<SetStateAction<typeof emptyStorageForm>>; groups:ConnectionGroupStatus[]; busy:boolean; onSave:()=>void; onClose:()=>void; onTest?:()=>Promise<void>; onDelete?:()=>Promise<void> }) {
  const togglePurpose=(id:StoragePurpose)=>setForm(v=>({...v,allowedPurposes:v.allowedPurposes.includes(id)?v.allowedPurposes.filter(item=>item!==id):[...v.allowedPurposes,id]}));
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/35 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className="theme-menu max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border p-5 sm:rounded-3xl"><h3 className="text-lg font-black text-theme-primary">{form.id?'Edit':'Add'} storage connection</h3><p className="mt-1 text-xs leading-5 text-theme-tertiary">Give it a friendly name and choose what NTK Note may store there.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-theme-secondary">Connection name<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder={form.provider==='backblaze'?'e.g. NTK Backup':'e.g. Main R2 Storage'} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary">Storage service<select value={form.provider} onChange={e=>setForm(v=>({...v,provider:e.target.value as StorageProviderKind}))} disabled={!!form.id} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm disabled:opacity-60">{Object.entries(STORAGE_PROVIDER_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label className="text-xs font-bold text-theme-secondary">Group — optional<select value={form.groupId} onChange={e=>setForm(v=>({...v,groupId:e.target.value}))} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm"><option value="">Ungrouped</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{form.provider==='r2'&&<label className="flex items-center justify-between gap-3 rounded-xl border theme-border px-3 py-2"><span><span className="block text-xs font-bold text-theme-secondary">Use Worker R2 bucket</span><span className="text-[10px] text-theme-tertiary">Best when the bucket is bound directly to the gateway.</span></span><input type="checkbox" checked={form.useWorkerBinding} onChange={e=>setForm(v=>({...v,useWorkerBinding:e.target.checked}))} className="h-5 w-5 accent-range" /></label>}</div>{!(form.provider==='r2'&&form.useWorkerBinding)&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-theme-secondary">Bucket name<input value={form.bucket} onChange={e=>setForm(v=>({...v,bucket:e.target.value}))} placeholder={form.provider==='backblaze'?'e.g. ntk-note-backups':''} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary">Region<input value={form.region} onChange={e=>setForm(v=>({...v,region:e.target.value}))} placeholder={form.provider==='backblaze'?'e.g. us-west-004':'auto'} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary sm:col-span-2">S3 endpoint address<input value={form.endpoint} onChange={e=>setForm(v=>({...v,endpoint:e.target.value}))} placeholder={form.provider==='backblaze'?'https://s3.us-west-004.backblazeb2.com':'https://…'} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary">Access Key ID / Key ID<input type="password" value={form.accessKeyId} onChange={e=>setForm(v=>({...v,accessKeyId:e.target.value}))} placeholder={form.id?'Leave blank to keep saved key':(form.provider==='backblaze'?'Backblaze Key ID (e.g. 005...)':'Access Key ID')} autoComplete="off" className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-theme-secondary">Secret Key / Application Key<input type="password" value={form.secretAccessKey} onChange={e=>setForm(v=>({...v,secretAccessKey:e.target.value}))} placeholder={form.id?'Leave blank to keep saved secret':(form.provider==='backblaze'?'Application Key (e.g. K005...)':'Secret Access Key')} autoComplete="off" className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label></div>}<div className="mt-3 rounded-xl border theme-border p-3"><p className="text-xs font-bold text-theme-primary">Use this storage for</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{PURPOSES.map(purpose=><label key={purpose.id} className="flex items-center gap-2 rounded-lg theme-muted-surface px-2.5 py-2"><input type="checkbox" checked={form.allowedPurposes.includes(purpose.id)} onChange={()=>togglePurpose(purpose.id)} className="h-4 w-4 accent-range" /><span className="text-xs font-semibold text-theme-secondary">{purpose.label}</span></label>)}</div><button type="button" onClick={()=>setForm(v=>({...v,allowedPurposes:[...PURPOSES.map(item=>item.id)]}))} className="mt-2 text-[11px] font-bold accent-text">Use for everything</button></div><details className="mt-3 rounded-xl border theme-border p-3"><summary className="cursor-pointer text-xs font-bold text-theme-secondary">Advanced options</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-theme-secondary">Preference<input type="number" min={1} max={100} value={form.priority} onChange={e=>setForm(v=>({...v,priority:Number(e.target.value)||50}))} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label><label className="flex items-center justify-between gap-3 rounded-xl border theme-border px-3 py-2"><span className="text-xs font-bold text-theme-secondary">Enabled</span><input type="checkbox" checked={form.enabled} onChange={e=>setForm(v=>({...v,enabled:e.target.checked}))} className="h-5 w-5 accent-range" /></label><label className="text-xs font-bold text-theme-secondary sm:col-span-2">Private note — optional<textarea value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} rows={2} className="mt-1 w-full rounded-xl border theme-input px-3 py-2.5 text-sm" /></label></div></details><div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={onSave} className="inline-flex items-center gap-1.5 rounded-xl accent-button px-4 py-2.5 text-sm font-bold">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<HardDrive className="h-4 w-4"/>} Save & check</button>{onTest&&<button type="button" onClick={()=>void onTest()} className="rounded-xl border theme-border theme-hover px-4 py-2.5 text-sm font-bold text-theme-secondary">Check storage</button>}{onDelete&&<button type="button" onClick={()=>void onDelete()} className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-sm font-bold text-rose-600">Remove</button>}<button type="button" onClick={onClose} className="ml-auto rounded-xl px-4 py-2.5 text-sm font-bold text-theme-tertiary theme-hover">Cancel</button></div></div></div>;
}
