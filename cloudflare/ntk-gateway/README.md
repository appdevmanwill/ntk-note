# NTK Note Gateway — owner setup

This Cloudflare Worker is the secure boundary for shared **NTK AI** credentials and external-storage credentials. API keys and storage secrets are never placed in the React app, Firebase documents, or browser localStorage.

## One-time Cloudflare setup

1. Create/sign in to the Cloudflare account that will host NTK Note's gateway.
2. In this folder run `npm ci`.
3. Run `npx wrangler login` and complete Cloudflare's normal browser authorization.
4. Create the configuration namespace:
   - `npx wrangler kv namespace create NTK_CONFIG`
   - replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with the returned namespace ID.
5. Put the NTK Note owner's Firebase UID in `OWNER_UIDS` (preferred) or email in `OWNER_EMAILS`.
6. Generate a random 32-byte encryption key, for example `openssl rand -base64 32`.
7. Save it only as a Worker secret with `npx wrangler secret put CONFIG_ENCRYPTION_KEY`.
8. Confirm `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGINS`.
9. Run `npm run typecheck`.
10. Deploy with `npm run deploy`.
11. Record the actual `https://...workers.dev` URL.
12. Put that non-secret URL in the frontend's `VITE_NTK_GATEWAY_URL`, rebuild NTK Note, then deploy Firebase Hosting.
13. Sign in as the configured owner and manage connections from **Settings → NTK AI → Owner connections**.

Do not claim NTK AI is deployed until `/v1/status` responds from the real Worker URL while using a valid Firebase ID token and at least one real AI connection has passed **Save & check**.

## Dynamic connection architecture

NTK Note no longer has one fixed key slot per provider.

The owner can create any practical number of **named connection records**, for example:

- `Main Gemini`
- `Backup Gemini`
- `Office Gemini`
- `OpenRouter Main`
- `Fast Groq`

Connections can be renamed, enabled/disabled, moved into optional groups, assigned a preference, checked individually, or checked together. Secrets are encrypted in KV and are never returned to the browser after saving.

### AI groups

Groups are optional organizational folders such as:

- Everyday AI
- Backup AI
- Testing

**Automatic routing remains the default.** Group membership does not force a strict route sequence unless the owner explicitly enables **Respect group order**. This keeps capability/health-aware routing as the normal behavior while preserving future manual control.

### Duplicate-key protection

A one-way fingerprint is stored with each secret so the gateway can warn when the same provider key is accidentally saved twice under different names. The raw secret is not exposed for this check.

## AI routing

The gateway chooses among healthy, verified connection records rather than hardcoded key slots.

- OpenRouter Automatic uses `openrouter/free` so OpenRouter can choose a currently available compatible route.
- Gemini, Groq, Mistral, Cerebras, and other OpenAI-compatible connections can discover their current model catalogs when Automatic is selected.
- Cloudflare AI can be enabled through a Worker AI binding.
- Cooldowns are tracked **per connection**, so one exhausted Gemini connection can rest while another legitimate Gemini connection or another provider is tried.
- A provider/account-wide failure does not leave the user staring at an endless spinner: the route has per-attempt and total time budgets.
- If useful output already started and the stream fails, the gateway stops instead of silently splicing a different model into the same response.

The supported provider adapters are application capabilities, but **connection count, connection names, keys, groups, priorities, enabled state, routing mode, model mode, custom compatible endpoints, limits, and user-facing status messages are configuration** rather than fixed source-code slots.

## Storage connections and purposes

Storage uses the same dynamic pattern as AI:

- unlimited practical named connection records;
- optional groups;
- enable/disable;
- connection checks;
- encrypted credentials;
- automatic or purpose-specific routing.

The storage purposes are established now so the data model will not need restructuring later:

1. **Profile photos**
2. **Attachments**
3. **Backups**
4. **Exports**

Each storage connection can be allowed for one or more purposes. Each purpose defaults to **Automatic — Recommended**, or the owner can pin it to a particular named storage connection.

The current round establishes secure connection/purpose routing. It does **not** silently migrate existing inline note data or existing backups. Data migration must be an explicit later operation with browser tests and rollback protection.

## Optional Cloudflare bindings

### Cloudflare AI

Add the AI binding in `wrangler.toml` and set a model through the connection or deployment setting when you want Cloudflare AI available as another route.

### Cloudflare R2

Bind an R2 bucket as `NTK_FILES` when desired. A storage connection can then choose **Use Worker R2 bucket**, avoiding S3 credentials in that connection. Additional R2/B2/S3-compatible connections can use their own encrypted S3 credentials.

## Security and privacy

- Every gateway request requires a valid Firebase ID token.
- Guest AI defaults to Off and is enforced by the Worker.
- Owner operations require the configured owner Firebase UID/email.
- AI/storage secrets are AES-GCM encrypted in KV using `CONFIG_ENCRYPTION_KEY`.
- Saved secrets are never returned in `/v1/status`.
- Invalid/rate-limited connections are skipped until healthy again.
- Do not enable prompt/response payload collection if Cloudflare AI Gateway is placed in front of this Worker. Operational metadata is enough for health diagnostics.
- Keep `.env.local`, Cloudflare credentials, Wrangler auth data, private keys, and tokens out of release ZIPs.
