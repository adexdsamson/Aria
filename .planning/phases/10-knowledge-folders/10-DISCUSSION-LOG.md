# Phase 10 — Knowledge Folders: Discussion Log

**Date:** 2026-05-21

Most decisions were pre-locked by the design spec at
`docs/superpowers/specs/2026-05-21-knowledge-folders-design.md` (§13: "None blocking").
This discussion resolved the four residual gray areas surfaced against prior-phase decisions.

## Gray areas selected
User picked all four presented:
1. Embed-model swap interaction
2. Disk-footprint stat method
3. Large-folder registration UX
4. Sensitive-folder boundary tests

## Q&A

### 1. Embed-model swap interaction
**Options presented:**
- Re-embed from existing chunk text *(recommended)*
- Mark stale, re-embed on next file change
- Re-parse from disk + re-embed

**Selected:** Re-embed from existing chunk text.
**Note:** Folder chunks participate in the existing Phase 7 reconciler with no special path. Preserves "never mixed-model retrieval" invariant.

### 2. Disk-footprint stat method
**Options presented:**
- Source-file bytes *(recommended)*
- Extracted-text bytes
- Chunk-table bytes
- Both source + DB cost

**Selected:** Source-file bytes (`SUM(knowledge_files.size)`).
**Note:** Matches user intuition of "folder size". Single number on the card; editorial sparse style preserved.

### 3. Large-folder registration UX
**Options presented:**
- Pre-scan + confirm with file count *(recommended)*
- Accept silently, stream
- Hard cap

**Selected:** Pre-scan + confirm dialog.
**Note:** Thresholds: file count > 5,000 OR bytes > 2 GB. Read-only walk before any DB write.

### 4. Sensitive-folder boundary contract
**Options presented:**
- Per-turn taint, no cross-turn carry *(recommended)*
- Conversation-sticky taint
- Per-turn + visible warning on first taint

**Selected:** Per-turn taint, no cross-turn carry.
**Note:** Mirrors Phase 3 per-call sensitivity router shape. Hybrid retrieval sets taint per-turn; multi-turn re-evaluates from scratch.

## Additional decisions captured (Claude's discretion, informed by prior memory)

- Phase 8 14-day data hard gate **does not** count folder chunks. Gate is about activity-stream signal, not Q&A context.
- `/ask` UI unchanged; citation component handles folder citations through existing extension-keyed icon mapping.
- Remove folder must use the destructive-action confirm dialog established in Phase 7 UAT.

## Deferred ideas
All deferred items match the design spec §2 Non-Goals (Drive, OCR, additional parsers, per-file sensitivity, symlinks, shared folders, hard quotas). No new deferrals surfaced.
