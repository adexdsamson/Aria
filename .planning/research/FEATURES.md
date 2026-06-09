# Feature Research

**Domain:** WhatsApp personal-account group-tracking + digest for a local-first desktop AI executive assistant (Aria v2.1)
**Researched:** 2026-06-09
**Confidence:** HIGH (linking/session mechanics, Baileys API behavior verified via Context7 + official sources); MEDIUM (digest UX patterns, competitor analysis via web research)

> **Scope note.** This milestone adds ONE new integration modality — WhatsApp Web via Baileys QR — and ONE new briefing output — a per-group daily digest produced LOCAL-ONLY by Ollama. It does NOT extend the approval-action pipeline (action-item extraction, meeting-proposal detection, RAG capture are explicitly deferred). Everything below distinguishes MVP (foundation + digest) from deferred (extraction consumers).

> **Dependency vocabulary.** Every feature names the existing Aria surface it integrates with: `provider_account` registry, `AddAccountModal`, `WhatsAppSessionManager`, `sweep-cron`, `briefing assembler`, `assertApproved` chokepoint, `migrate 138` DB schema.

---

## Behavioral Reality: How WhatsApp Web Multi-Device Actually Works

These are ground-truth constraints that override any assumption. Every UX decision below is grounded in this.

### QR Linking Mechanics (HIGH confidence — Baileys Context7 + official WhatsApp FAQ)

- Baileys generates a `qr` string on the `connection.update` event. The QR is a one-time-use code; it expires and is replaced every **~20–30 seconds** if not scanned. The UI must render a countdown or visual refresh indicator so the user doesn't scan a stale code.
- Two pairing paths exist in Baileys: **QR scan** (default; recommended) and **pairing code** (phone-number entry → 8-digit code displayed in Settings > Linked Devices on mobile). Pairing code avoids QR rendering complexity and is better for a desktop app UI. Both are supported; QR is the more universal expectation.
- After scanning, WhatsApp forcibly disconnects the socket once, then reconnects presenting credentials. This is normal — the UI must not treat the momentary `connection === 'close'` as a failure during the link flow.
- Credentials must be persisted immediately on every `creds.update` event. In Aria's case this means writing to `whatsapp_auth_state` in the SQLCipher DB. If creds are not saved before a crash, the user must re-scan.
- Disconnect reason `401 (loggedOut)` means the session was revoked on mobile (Settings > Linked Devices > Log out). This is the only non-reconnectable state; all other close reasons should trigger a reconnect attempt.

### History Backfill (HIGH confidence — Baileys Context7 + WhatsApp engineering blog)

- When a companion device is linked, WhatsApp transfers a history bundle from the primary phone. This arrives via the `messaging-history.set` event and includes chats, contacts, and messages.
- **The key constraint:** Baileys exposes `syncFullHistory: boolean` config. When **false** (the default), only a short recent window is synced — typically the last few dozen messages per chat. When **true**, Baileys requests an extended history sync from the phone, but the depth is controlled by the phone's local storage and WhatsApp's own limits (not reliably configurable by Aria).
- **Practical consequence for MVP:** Do NOT promise the user that historical messages before the link date are available. The digest for Day 1 after linking may have thin or empty context. Set the user's expectation at link time: "Aria will start building your digest from today's messages."
- `fetchMessageHistory` exists as an on-demand API to paginate older messages from a given cursor, but it is unreliable (GitHub issue #2452 confirms the on-demand request succeeds but response is often empty). Do not depend on it for MVP.
- **On session re-link after expiry:** if the session is manually revoked on mobile and the user re-scans, history sync restarts. Aria should NOT attempt to deduplicate existing stored messages against the re-synced history set; it should skip already-stored message IDs (idempotent insert by `message_id`).

### Linked Devices Limit (MEDIUM confidence — WhatsApp official FAQ)

- WhatsApp allows **up to 4 companion devices** (plus the primary phone = 5 total). Aria occupies one slot. If the user already has 4 other linked devices (web, desktop, Portal, etc.), linking Aria will fail — the UI should surface a clear error ("Your WhatsApp already has 4 linked devices. Remove one in Settings > Linked Devices first.").

### Ban Risk Profile (MEDIUM confidence — web research across multiple sources)

- Baileys is an unofficial WebSocket protocol implementation (ToS violation). WhatsApp's ban enforcement is **behavior-based, not connection-method-based**: accounts get banned for bulk sending, contacting non-opted-in strangers, or velocity spikes — not for passively reading group messages.
- **Aria's behavior profile is low-risk**: read-only group ingestion, no sends, no broadcast, no number enumeration, no connection churn. The high-risk pattern (15–30% ban rate) is proactive outbound to unknown contacts; passive read-only consumers historically see <2% ban rate.
- **Still requires an explicit consent gate at link time.** The user is using their personal number; losing it has personal consequences. A secondary/dedicated number is the safest path and should be the recommended suggestion at link time (not mandatory, but surfaced).

### Message Structure in Baileys (HIGH confidence — Context7 + Baileys source)

- Group messages arrive via `messages.upsert` with `type === 'notify'`.
- Group JIDs end in `@g.us`; individual JIDs end in `@s.whatsapp.net`. This is the authoritative filter for excluding 1:1 DMs.
- In a group message: `msg.key.remoteJid` = group JID; `msg.key.participant` = sender's JID (phone@s.whatsapp.net). `msg.pushName` = sender's display name as set on their own phone (the "notify" name) — this is the best available display identity for group members whose contact you don't have saved.
- `getContactName(contact)` resolves: saved contact name > `pushName` > phone JID. For most exec group participants, pushName is the only available name.
- Text content: `msg.message?.conversation` (plain text) or `msg.message?.extendedTextMessage?.text` (text with quote/link metadata).
- Quoted/reply context: `msg.message?.extendedTextMessage?.contextInfo?.quotedMessage` — contains the original message object. Useful for digest coherence ("Alice replied to Bob's question about the budget").
- Edited messages: arrive as a new `messages.upsert` with `msg.message?.editedMessage` containing the new text and the original message key. The DB should upsert (update) the original row rather than insert a duplicate.
- Deleted messages ("Delete for everyone"): arrive as a `messages.upsert` with `msg.message?.protocolMessage?.type === REVOKE` and the key of the deleted message. The DB should mark the row as deleted (soft-delete or null body) rather than removing it — the digest LLM can skip or note "[message deleted]".
- System messages (joins, leaves, group-created, etc.): `msg.messageStubType` is non-null (e.g., `GROUP_CREATE`, `GROUP_PARTICIPANT_ADD`, `GROUP_PARTICIPANT_REMOVE`). These are NOT `conversation` messages. Filter them out of digest input; optionally store as metadata for the "new member joined" notification pattern.
- Media messages (image, video, audio, document, sticker): `msg.message` will have `imageMessage`, `videoMessage`, `audioMessage`, `documentMessage`, or `stickerMessage` keys. In text-only MVP: persist `caption` if present, log a `[media: image]` placeholder, and skip the blob entirely. Do NOT download or store media.
- Reactions (`reactMessage`): emoji reactions to messages. Noisy for digest. Skip unless user explicitly wants reaction counts surfaced.

### Group Discovery (HIGH confidence — Context7)

- `sock.groupFetchAllParticipating()` returns metadata for all groups the linked account is currently in. Call this once on `connection === 'open'` to populate `whatsapp_group` table.
- `sock.ev.on('groups.upsert', ...)` fires when the user is added to a new group or group metadata changes. Use this to detect new group joins and prompt the user to decide whether to track.
- `sock.groupMetadata(jid)` fetches full metadata (subject, description, participants list) for a specific group on demand.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that make the WhatsApp integration feel complete and trustworthy. Missing any of these = integration feels broken or unsafe.

| Feature | Why Expected | Complexity | MVP or Deferred | Aria dependency / notes |
|---------|--------------|------------|-----------------|-------------------------|
| **QR / Pairing-code link flow with explicit ban-risk consent gate** | Any WhatsApp Web-style integration starts with a one-time scan. Users know this UX from WhatsApp Web itself. The consent gate is non-optional given ToS risk. | MEDIUM | **MVP** | New BrowserWindow-free modal in `AddAccountModal`; renders QR data-URL or pairing code; polls `connection.update`; persists `provider_account` row + `whatsapp_auth_state` on success. |
| **QR refresh / countdown indicator** | The QR expires every ~20–30 s. If the UI shows a stale code with no feedback, the user assumes something is broken. | LOW | **MVP** | `connection.update` re-emits `qr` on each refresh; UI just re-renders. A countdown ring (CSS animation) over the QR image sets expectations. |
| **Linked / connected status display** | After linking, user expects to see "Connected as +1-555-0100" (or their number) in the Integrations panel — the same pattern as Gmail / Outlook / Todoist rows. | LOW | **MVP** | Reuse `AccountRow` pattern. Show phone number (from `creds.me.id`) + connection badge (connected / reconnecting / disconnected). |
| **Group discovery list with track/untrack toggle** | The user must choose which groups Aria monitors. This is the primary privacy control — untracked group content is never persisted. Without it the integration is either all-or-nothing. | MEDIUM | **MVP** | New `WhatsAppGroupsScreen` or modal. Populated from `whatsapp_group` table after `groupFetchAllParticipating()`. Toggle writes `is_tracked` to DB. Requires at least a name and participant count per group. |
| **Exclusion of 1:1 DMs** | Users do not want private direct messages ingested by a tool, even a local one. Group intelligence is for group content only. | LOW | **MVP** | Filter at ingestion time: `remoteJid.endsWith('@g.us')` only. Non-group messages are never written to `whatsapp_message`. |
| **Exclusion of untracked-group messages** | Tracking toggle must be a hard gate, not a soft preference. | LOW | **MVP** | `messages.upsert` handler checks `whatsapp_group.is_tracked` before any write. |
| **Per-group daily digest in the briefing** | The core value delivery: what happened in the groups that matter, summarized by Aria every morning. Expected by anyone who's seen WhatsApp summarization tools (Meta AI, GistGem, n8n templates). | HIGH | **MVP** | New `WhatsAppDigestSection` in the briefing assembler. Runs local Ollama (Llama 3.1 8B) — never frontier — per the local-only PII posture decision. Stored in `whatsapp_group_digest`. |
| **"No history before link" disclosure** | Users coming from WhatsApp Web expect some backfill. The actual Baileys behavior is: recent window only, depth unreliable. Setting the wrong expectation = support request. | LOW | **MVP** | One-sentence copy in the link success state: "Aria will start building digests from messages received today." |
| **Disconnect / unlink with data purge** | Users expect to be able to revoke the integration and delete all ingested data. Same pattern as Gmail/Outlook unlink. | MEDIUM | **MVP** | Extend existing `provider_account` disconnect cascade: call `sock.logout()`, delete `whatsapp_auth_state` + `whatsapp_message` + `whatsapp_group` rows for this account. Show confirmation modal ("This will delete all stored WhatsApp messages from Aria's database."). |
| **30-day rolling retention + sweep** | Group message history has no business sitting on disk indefinitely. 30-day rolling window matches Aria's stated retention policy. | LOW | **MVP** | Extend existing `sweep-cron` to `DELETE FROM whatsapp_message WHERE created_at < now - 30d`. No new infrastructure. |
| **Session re-authentication prompt on 401** | When the user revokes Aria from their phone's Linked Devices, Aria must detect this gracefully and prompt re-scan rather than silently reconnecting or crashing. | MEDIUM | **MVP** | `lastDisconnect.error.output.statusCode === 401` → set `provider_account.status = 'unlinked'` → surface re-link prompt in `AccountRow`. |

### Differentiators (Competitive Advantage)

Features that make Aria's WhatsApp digest better than generic summarizers, grounded in the exec persona.

| Feature | Value Proposition | Complexity | MVP or Deferred | Aria dependency / notes |
|---------|-------------------|------------|-----------------|-------------------------|
| **Exec-framed digest structure** (Decisions · Who's waiting on whom · Open questions · @Mentions of the user) | Generic summarizers produce a flat summary. An exec needs to act: who did they commit to something? What's stalled waiting for them? What was decided? This framing matches how a chief-of-staff briefs the boss. | MEDIUM | **MVP** | LLM prompt engineering for the local Ollama digest. Sections: (1) Key decisions made, (2) Open questions / unresolved items, (3) Messages @mentioning the user's number/name, (4) Who is waiting on a response. |
| **"Unread since yesterday" framing** | Execs check WhatsApp once in the morning. The digest should cover the since-last-briefing window, not a sliding 24h window that might overlap previous digests. | LOW | **MVP** | `whatsapp_group_digest.window_start` = timestamp of previous digest; `window_end` = now. Query `whatsapp_message WHERE created_at > window_start`. |
| **Noise suppression built-in** (stickers/reactions/media-only/system messages filtered before LLM) | A naive summarizer includes "👍", "Thanks!", join/leave notifications, and "[image]" as substantive input — wasting tokens and degrading digest quality. | LOW | **MVP** | Pre-filter at digest build time: skip rows with `message_type IN ('sticker','reaction','system')`, skip empty captions. LLM sees clean text only. |
| **Per-group digest, not cross-group mush** | Each group has its own context and decision space. A merged multi-group summary loses attribution and coherence. Per-group digests let the exec triage by group importance. | LOW | **MVP** | One digest per `is_tracked=true` group per day. Briefing renders each group as a named section with participant count and message count as context. |
| **Sender display name resolution** (pushName > contact name > phone) | An exec needs to know that "Alex said we're delaying the launch" — not "447700900461 said we're delaying". | LOW | **MVP** | `getContactName()` order built into the message ingestion + displayed in the digest. Store `sender_display_name` on `whatsapp_message` at ingest time. |
| **Reply/quote threading context preserved in digest** | "Alice said yes" is meaningless without knowing what she said yes to. Quoted messages give the LLM the context to produce coherent summaries of threaded discussions. | MEDIUM | **MVP** | Store `quoted_message_id` and `quoted_text` on `whatsapp_message`. Digest query JOINs the quoted row so the LLM sees "Bob asked X → Alice replied Y". |
| **New group join notification** | Exec joins a new group → Aria should surface "You joined 'Q3 Planning'. Would you like to track it?" rather than silently missing it. | LOW | **MVP** | `groups.upsert` event → if new group, create `whatsapp_group` row with `is_tracked=false` + push a tray notification / briefing flag. |
| **Edited/deleted message handling without confusion** | If a message is edited or deleted, a naive digest may cite the original text that the sender already retracted. | LOW | **MVP** | Soft-delete/update the `whatsapp_message` row on receipt of edit/delete events. Digest query uses the current (post-edit) body. Show "[deleted]" in place of the body for deletes so the LLM can note it if relevant ("Bob's message was deleted"). |
| **Local-only PII posture clearly communicated** | The exec knows their group chats contain sensitive business information. "Local-only" is the trust signal that differentiates Aria from cloud summarizers. | LOW | **MVP** | Explicit copy in the link flow and in the group-selection screen: "Group messages are summarized on your machine using a local AI model. They are never sent to cloud services." |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Ingest 1:1 direct messages** | "I have important DMs too." | Deeply personal content. The user has not explicitly consented on behalf of their contacts. Expands scope enormously. DM parties have no idea they're being ingested. | Group-only in MVP. 1:1 is a deliberate future decision requiring explicit per-conversation opt-in from the user. |
| **Send messages on the user's behalf via Baileys** | "Reply to the group from Aria." | This is the highest ban-risk action. Outbound sends from unofficial APIs are what triggers WhatsApp enforcement. Also requires approval-gating infrastructure not scoped here. | Deferred indefinitely. MVP is strictly read-only. Any future send capability needs deep integration with `assertApproved` and a prominent ban-risk warning at the point of send. |
| **Download and store media (images, audio, video, documents)** | "I want to be able to search the file that was shared in that group." | Media blobs are large (GB-scale for active groups), create privacy surface area beyond text, and require a separate media-indexing pipeline. Baileys does not auto-download. | Text + captions only in MVP. Filename + MIME type can be stored as metadata without the blob. Future phase can add on-demand media indexing behind an explicit user opt-in. |
| **Backfill historical messages before link date** | "I want the digest to include last week's conversation." | Baileys backfill is unreliable (`fetchMessageHistory` on-demand is confirmed flaky per issue #2452). Overpromising leads to support tickets and broken trust. | Set expectation clearly: "Digests start from today." If reliable backfill becomes feasible in a future Baileys version, add it then. |
| **Cross-group aggregated digest** ("all groups in one summary") | "Just give me one morning rollup." | Collapses group-specific context, makes attribution impossible, hides important per-group dynamics. An exec needs to know *which group* had a problem or decision. | Keep per-group digests. The briefing section orders groups by most-recent-activity or user-defined priority. A future "top-level WhatsApp summary" section (e.g., "3 groups had activity today") can be a nav affordance, not a content aggregation. |
| **Always-on connection / keep-alive polling** | "I want real-time notifications." | Baileys is a persistent WebSocket — it is already push-based. "Polling" is not the pattern. But an always-open Baileys socket does keep a network connection live, consumes memory, and increases detectable "automated client" behavior. | Connect on app launch; reconnect on network resume (Electron powerMonitor). Do not add artificial keep-alive pings. Let WhatsApp's own heartbeat maintain the session. |
| **Auto-track all groups by default** | "Less setup." | Privacy boundary: the user must explicitly choose what Aria ingests. Defaulting to all-tracked means content the user didn't consciously invite into Aria gets stored and summarized. Particularly risky for personal/family groups. | Default is `is_tracked=false` for all groups. User must explicitly enable tracking per group. Make it easy (one-click in the groups list), but never automatic. |
| **Ban-risk warning suppressed or minimized** | "It's unlikely to happen, why scare users?" | If the user's personal number gets banned and Aria didn't clearly warn them, Aria is responsible. The consent gate must be impossible to miss, not buried in settings. | Prominent, non-dismissable first-time consent modal with explicit "I understand" checkbox before any QR is shown. Reference WhatsApp's ToS. Recommend a secondary number. |
| **Action-item extraction → Todoist in MVP** | "While you're ingesting messages, extract tasks." | This is a deferred scope item (explicitly called out in PROJECT.md). Adding it to the MVP phase couples two delivery surfaces, increases phase scope beyond one-session size, and risks shipping neither cleanly. | Foundation + digest ships first. Action extraction is a separate, subsequent phase that layers on top of the stored `whatsapp_message` rows. The schema is designed for it already (no additional migration needed). |

---

## Feature Dependencies

```
[WhatsApp link flow (QR / pairing code)]
    └──produces──> [provider_account row + whatsapp_auth_state]
                       └──enables──> [WhatsAppSessionManager socket lifecycle]
                                         └──enables──> [messages.upsert ingestion]
                                         │                └──requires──> [whatsapp_group.is_tracked gate]
                                         │                └──writes──> [whatsapp_message table]
                                         │                                └──enables──> [daily digest builder]
                                         │                                                   └──requires──> [Ollama local LLM]
                                         │                                                   └──writes──> [whatsapp_group_digest]
                                         │                                                   └──feeds──> [briefing assembler] (EXISTING)
                                         └──enables──> [group-participants.update + groups.upsert]
                                                            └──enables──> [group discovery list + new-group notification]

[disconnect cascade]
    └──requires──> [provider_account + whatsapp_auth_state + whatsapp_message + whatsapp_group delete]
    └──requires──> [sock.logout()]

[sweep-cron] (EXISTING)
    └──extended by──> [30-day whatsapp_message purge]

[assertApproved chokepoint] (EXISTING)
    └──NOT required for MVP (read-only ingestion, no sends)
    └──WILL be required for deferred action-item extraction → task_batch
    └──WILL be required for deferred meeting-proposal → calendar_change
```

### Dependency Notes

- **Group tracking toggle is the privacy chokepoint.** It must be enforced at the `messages.upsert` handler level, not just the UI. A bug that stores an untracked group's messages is a privacy violation.
- **Ollama local LLM is a hard dependency for digest.** If Ollama is not running or the model is not pulled, the digest must degrade gracefully (skip the WhatsApp section in the briefing, surface a status badge "Local AI unavailable") rather than error or fall back to a frontier API (which would violate the local-only PII posture decision).
- **Digest builder depends on `whatsapp_group_digest.window_start`** for the since-last-briefing framing. The first digest after linking has no prior window_start → use the link timestamp as window_start for Day 1.
- **Briefing assembler integration is low-friction.** The existing briefing assembler already accepts pluggable sections. WhatsApp digest is a new section type that returns the same `BriefingSection` shape.
- **No dependency on `assertApproved` for MVP** because MVP is strictly read-only. This is intentional and should be called out in the implementation plan as a gate: if any send capability is ever added, it MUST route through `assertApproved` before any other work proceeds.

---

## MVP Definition

### Launch With (v2.1 foundation + digest phase)

Minimum viable WhatsApp integration: link → pick groups → ingest → morning digest.

- [ ] **QR / pairing-code link flow with ban-risk consent gate** — gate before any code is shown; on success creates `provider_account` + `whatsapp_auth_state` rows.
- [ ] **Connection status display in AccountRow** — shows phone number, connected/reconnecting/disconnected badge, re-link prompt on 401.
- [ ] **Group discovery list with track/untrack toggle** — populated after `groupFetchAllParticipating()`; default all untracked; user enables per group.
- [ ] **Message ingestion pipeline** — `messages.upsert` handler; group-only (`@g.us`); is_tracked gate; text + captions only; edits/deletes handled; system messages skipped; sender display name resolved (pushName chain).
- [ ] **New-group join notification** — `groups.upsert` event → prompt user to track/ignore.
- [ ] **Per-group daily digest** — local Ollama only; exec framing (decisions / open questions / @mentions / who's waiting); unread-since-last-briefing window; pre-filtered for noise (reactions, stickers, system).
- [ ] **WhatsApp digest section in the briefing assembler** — one named sub-section per tracked group; degrades gracefully if Ollama is unavailable.
- [ ] **30-day message sweep** — extend existing sweep-cron.
- [ ] **Disconnect / unlink with full data purge** — extend provider_account disconnect cascade; confirmation modal.
- [ ] **"No history before link" copy** — at link-success time; sets expectation, prevents support request.

### Add After Validation (v2.1.x — deferred extraction consumers)

These three reuse the already-stored `whatsapp_message` rows. No new ingestion infrastructure needed.

- [ ] **Action-item extraction → `task_batch` approval** — parse extracted actions from group messages; route through `assertApproved`; push to Todoist. Trigger: same Ollama digest run, additional extraction pass. Gated by user reviewing extracted tasks in the existing approval queue.
- [ ] **Meeting-proposal detection → `calendar_change` approval** — detect "let's meet Tuesday at 3pm" patterns; generate `calendar_change` staging; route through `assertApproved`. Gated by user reviewing in the existing approval queue.
- [ ] **Project-feedback RAG capture** — chunk group messages from tracked groups into the RAG vector store (sqlite-vec + nomic-embed-text); enables `/ask` queries over WhatsApp context.

### Future Consideration (v2.2+)

- [ ] **Send messages via Baileys** — requires deep `assertApproved` integration, full ban-risk UX, and a separate design decision. Not in v2.1 scope at all.
- [ ] **1:1 DM ingestion with explicit per-contact opt-in** — requires a new privacy consent design; not group-tracking at that point.
- [ ] **Media blob indexing** — image/document search; major new pipeline; defer until digest value is proven.
- [ ] **Cross-group aggregated digest section** — nav affordance showing which groups had activity; not content aggregation.
- [ ] **Reliable historical backfill** — only if Baileys `fetchMessageHistory` becomes stable; blocked on upstream issue.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| QR/pairing link + ban-risk consent gate | HIGH | MEDIUM | P1 |
| Connection status in AccountRow | HIGH | LOW | P1 |
| Group discovery + track/untrack toggle | HIGH | MEDIUM | P1 |
| Message ingestion (text, edits, deletes, filter) | HIGH | MEDIUM | P1 |
| Sender display name resolution | HIGH | LOW | P1 |
| Per-group daily digest (local Ollama, exec framing) | HIGH | MEDIUM | P1 |
| Digest section in briefing assembler | HIGH | LOW | P1 |
| Noise suppression (reactions/stickers/system filter) | MEDIUM | LOW | P1 |
| 30-day message sweep via sweep-cron | MEDIUM | LOW | P1 |
| Disconnect/unlink with data purge | HIGH | MEDIUM | P1 |
| Reply/quote threading context in digest | MEDIUM | MEDIUM | P1 |
| New-group join notification | MEDIUM | LOW | P1 |
| "No history before link" disclosure copy | MEDIUM | LOW | P1 |
| Graceful Ollama-unavailable degradation | HIGH | LOW | P1 |
| Action-item extraction → task_batch | HIGH | MEDIUM | P2 |
| Meeting-proposal detection → calendar_change | MEDIUM | MEDIUM | P2 |
| Project-feedback RAG capture | MEDIUM | MEDIUM | P2 |
| Outbound message send via Baileys | LOW (v2.1) | HIGH + ban risk | P3 |
| 1:1 DM ingestion | LOW (v2.1) | HIGH + privacy design | P3 |
| Media blob indexing | LOW (v2.1) | HIGH | P3 |

**Priority key:** P1 = must have for v2.1 foundation+digest · P2 = extraction consumers (subsequent phase) · P3 = future milestone.

---

## Competitor / Comparator Feature Analysis

| Feature | Meta AI (in-app) | GistGem (Chrome ext) | n8n WhatsApp workflow | Aria's Approach |
|---------|------------------|----------------------|------------------------|-----------------|
| Where data is processed | Cloud (Meta servers) | Cloud (user's API key) | Cloud (GPT-4.1) | **Local-only via Ollama** — group content never leaves the machine |
| Summary structure | Flat "catch-up" paragraph | Bullet points (customizable) | Business-insight bullets | **Exec framing: decisions / waiting-on / open questions / @mentions** |
| Group selection control | All groups (Meta AI) | Browser session only | Configured per workflow | **Explicit per-group opt-in toggle; all-untracked by default** |
| History window | Unread in current session | Active browser window | Configurable (daily cron) | **Since-last-briefing window; disclosed no-backfill at link time** |
| Integration with task/calendar | None | None | Google Sheets only | **Deferred v2.1.x: → Todoist via assertApproved; → calendar_change via assertApproved** |
| Send capability | Yes (native) | No | Configurable | **No sends in MVP; if ever added, must route through assertApproved** |
| Privacy model | Meta/cloud | Third-party cloud | User-provided cloud key | **On-device only; no third-party** |
| Desktop app integration | WhatsApp Web only | Chrome-only | n8n server | **Native Electron integration alongside email/calendar/tasks briefing** |

---

## Sources

- Baileys documentation via Context7 (`/whiskeysockets/baileys`): `connection.update` event, `groupFetchAllParticipating`, `groupMetadata`, `group-participants.update`, `groups.upsert`, `messages.upsert`, `getContactName`, `fetchMessageHistory`, `messaging-history.set`, message types (conversation, extendedTextMessage, protocolMessage, stubs). (HIGH confidence)
- [About message history on linked devices — WhatsApp Help Center](https://faq.whatsapp.com/653480766448040) — companion device history transfer at link time. (HIGH confidence)
- [How WhatsApp enables multi-device capability — Engineering at Meta](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/) — history bundle encryption, device-local storage after link. (HIGH confidence)
- [WhatsApp Unofficial API Ban Risk — Wapisimo Blog](https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk) and [WhatsApp Automation Ban Risk — Kraya AI](https://blog.kraya-ai.com/whatsapp-automation-ban-risk) — behavior-based (not connection-method) enforcement; <2% passive-read ban rate. (MEDIUM confidence)
- Baileys GitHub issue #2452 ([fetchMessageHistory on-demand history sync unreliable](https://github.com/WhiskeySockets/Baileys/issues/2452)) — confirms not to depend on backfill. (HIGH confidence — first-party issue tracker)
- [Automated daily AI summaries from WhatsApp groups — n8n](https://n8n.io/workflows/8442-automated-daily-ai-summaries-from-whatsapp-groups/) — competitor feature analysis; GPT-4.1, business-insight focus, multi-fragment delivery. (MEDIUM confidence)
- [Managing 10+ WhatsApp Groups — GistGem Blog](https://www.gistgem.com/blog/manage-multiple-whatsapp-groups-ai) — competitor feature patterns; per-group vs cross-group; exec-relevant extraction targets. (MEDIUM confidence)
- QR code expiry timing: multiple web sources converge on 20–30 seconds; cross-validated with Baileys `connection.update` refresh behavior. (MEDIUM confidence)
- Aria `PROJECT.md` (v2.1 milestone decisions, architecture decisions, deferred scope declaration) and `CLAUDE.md` (existing `assertApproved` chokepoint, Ollama local LLM, sweep-cron, migration 138 schema, provider_account pattern). (HIGH confidence — internal)

---
*Feature research for: WhatsApp group-tracking + digest (Aria v2.1)*
*Researched: 2026-06-09*
