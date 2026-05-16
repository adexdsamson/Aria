# Google CASA Security Review Intake (D-15)

**Phase:** 01-foundation
**Plan:** 03
**Status:** `deferred` — see "Submission Status" below
**Owner:** Aria solo dev (adexdsamson@gmail.com)
**Filed:** 2026-05-16

> CASA (Cloud Application Security Assessment) Tier 2 review is required by
> Google for any application using **restricted** Gmail / Calendar scopes
> (notably `https://www.googleapis.com/auth/gmail.send`, needed by Phase 3).
>
> This intake document starts the multi-week clock in Phase 1 so Phase 3 is
> not blocked when it goes to wire `gmail.send`. Fields below that depend on
> live GCP Console state or commercial-lab quotes are marked `<TODO: …>` and
> must be filled in by the user before submission.

---

## 1. GCP Project

| Field | Value |
|---|---|
| GCP project ID | `<TODO: create GCP project named "aria-personal-assistant" (or chosen ID); record final project ID here>` |
| Project owner email | adexdsamson@gmail.com |
| Project creation date | `<TODO: fill on creation>` |
| Production OAuth client ID | `<TODO: create OAuth client (Desktop app, loopback redirect) and record client ID; client secret stays in 1Password / safeStorage>` |

## 2. Contact

| Field | Value |
|---|---|
| Primary technical contact | Aria solo dev — adexdsamson@gmail.com |
| Secondary technical contact | `<TODO: optional — add a backup contact if/when team grows>` |
| Legal / privacy contact | `<TODO: same as primary unless dedicated legal contact is engaged>` |
| Incident response contact | `<TODO: same as primary for v1; revisit when distributing binaries>` |

## 3. Requested Scopes

| Scope | Phase Needed | Tier | Notes |
|---|---|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Phase 2 (Google integration) | sensitive | covered by sensitive-scope review; no CASA required |
| `https://www.googleapis.com/auth/calendar` | Phase 2 / Phase 5 | sensitive | covered by sensitive-scope review |
| `https://www.googleapis.com/auth/gmail.send` | Phase 3 (drafting + outbound) | **restricted — CASA Tier 2 required** | blocks Phase 3 until CASA passes |
| `https://www.googleapis.com/auth/gmail.modify` | `<TODO: decide whether Phase 3 needs modify (labels/archive) — if so, also CASA Tier 2>` | restricted | defer decision; document in CONTEXT |

## 4. Aria Data-Handling Story (verbatim for the CASA narrative)

**Architecture:** Aria is a local-first desktop application packaged via
Electron 41.6.1 (Chromium 134 / Node 20). The user installs Aria on their
own machine. All Google account data (email bodies, calendar events,
attachments metadata) is stored locally in a SQLCipher-encrypted SQLite
database under the OS-standard `userData` directory. The DB key never
leaves the user's machine — it is derived from a vault-sealed mnemonic and
held in OS keychain (DPAPI on Windows, Keychain on macOS, libsecret on
Linux) via Electron `safeStorage` (see Plan 01-03).

**Transmission posture:** No Google user data is transmitted to any Aria-
operated backend (there is no Aria backend). Aria has no servers, no
analytics endpoints, no telemetry collection. The ONLY outbound network
calls are:

1. Direct Google API calls from the user's machine using user-issued
   OAuth tokens (those tokens are likewise stored in OS keychain).
2. Scoped LLM prompts to user-configured frontier APIs (Anthropic,
   OpenAI, Google Gemini). Per Aria's sensitivity classifier (Plan 04),
   prompts that contain PII detected by the local Llama 3.1 8B classifier
   are either redacted before transmission or routed entirely to the local
   model. The user explicitly approves any outbound action that would
   transmit personal data.

**Approval gating:** All outbound communication (email send, calendar
event create/modify) requires explicit user confirmation in the Aria
Approvals UI before the corresponding Google API call is issued.

**Data retention:** No retention by Aria as an organization (Aria has no
servers). On-device data follows the user's local data retention policy.
Backup files are encrypted via SQLCipher VACUUM INTO and require the same
mnemonic + daily password to restore.

## 5. Infrastructure Overview (CASA section 4)

| Field | Value |
|---|---|
| Hosting | None — Aria has no backend infrastructure |
| Source code repo | `<TODO: confirm — currently github.com/<user>/Aria private repo>` |
| Build pipeline | Local-only in v1; GitHub Actions to be added in Phase 8 packaging |
| Code signing | macOS Developer ID + Windows OV cert (Phase 8) |
| Update channel | `<TODO: confirm — autoupdate via electron-updater against GitHub Releases or S3/R2 in Phase 8>` |
| Logging / telemetry | Local pino JSON files only; optional opt-in Sentry crash reports (Phase 8) — no PII per `src/main/log/redact.ts` |

## 6. CASA Tier 2 Requirements Checklist

| Requirement | Status | Notes |
|---|---|---|
| Privacy policy URL | `<TODO: publish privacy policy describing local-only storage + no Aria-side transmission; needed before OAuth consent screen verification>` |
| Terms of service URL | `<TODO: publish ToS>` |
| Application homepage | `<TODO: publish homepage / GitHub README link>` |
| Demo video / screencast | `<TODO: record 2–3 min screencast showing Gmail send approval flow once Phase 3 ships>` |
| Letter of Assessment (LoA) scope | `<TODO: confirm with CASA-authorized lab; expected scope = full app since gmail.send touches DOM + UI + IPC + provider>` |
| Scope-by-scope justification | drafted in §3 above; finalize narrative when filing |
| Penetration test (CASA Tier 2 requires) | `<TODO: engage CASA-authorized lab — see §7>` |

## 7. CASA-Authorized Lab Engagement

| Field | Value |
|---|---|
| Candidate labs | Bishop Fox, NCC Group, Leviathan Security, Kratikal, Securify |
| Chosen lab | `<TODO: request quotes; record selection here>` |
| Quote date | `<TODO>` |
| Engagement target start date | `<TODO: target Phase 2 mid-point so the LoA is in hand before Phase 3 wraps>` |
| Estimated cost | `<TODO: typical range USD 5k–15k for a desktop-only scope; confirm with lab>` |
| Estimated duration | 4–8 weeks (CASA review + lab pentest + Google verification round-trips) |

## 8. Submission Status

**Current state:** `deferred`

**Rationale:** Plan 03 ships the data-handling architecture (safeStorage + local-only secrets + redaction pipeline) that underpins the CASA narrative. The user must (a) create the GCP project, (b) publish privacy policy + ToS pages, and (c) request quotes from a CASA-authorized lab before submission is meaningful. None of those steps can be performed by the executor agent.

**Revisit date:** `<TODO: set explicit revisit date — recommended within 2 weeks (by 2026-05-30) so the CASA clock starts before Phase 2 Google integration work begins>`

**Phase 3 blocker:** Acknowledged. Phase 3 (`gmail.send`) cannot ship until CASA Tier 2 LoA is in hand. This is recorded in the Phase-3 plan dependency graph and surfaces in STATE.md / ROADMAP.md as a non-engineering blocker.

## 9. References

- Google scope tier mapping: https://support.google.com/cloud/answer/9110914
- CASA Tier 2 requirements: https://appdefensealliance.dev/casa/tier-2
- Aria D-15 decision record: `.planning/phases/01-foundation/01-CONTEXT.md`
- Aria threat model T-01-03-07 (Plan 03 PLAN.md): non-engineering compliance mitigation
- Aria redaction pipeline (LLM-02 in Phase 3): `src/main/log/redact.ts`

---

## Action Items Before Next Phase

1. `<TODO: user>` Create GCP project + OAuth client ID (Desktop app, loopback). Record IDs in §1.
2. `<TODO: user>` Publish privacy policy + ToS (can be GitHub Pages markdown for v1). Update §6.
3. `<TODO: user>` Request quotes from 2–3 CASA-authorized labs. Select one and record in §7.
4. `<TODO: user>` Submit Google OAuth consent screen for verification (sensitive scopes only at first; restricted scopes batched with the CASA LoA submission). Record verification request ID.
5. Revisit this document by the revisit date in §8.
