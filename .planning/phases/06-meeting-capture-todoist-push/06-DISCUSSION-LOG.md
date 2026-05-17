# Phase 6 Discussion Log

**Date:** 2026-05-17
**Phase:** 6 — Meeting Capture + Todoist Push

Human reference only.

## Gray Areas Selected
- Transcript ingest + calendar linking
- Action-item extraction schema
- Todoist sync semantics
- Dashboard surface + MEET-06 invariant

## Q&A

### Transcript ingest + calendar linking
- **Supported formats:** _Raw text + VTT/SRT + JSON exports (Otter / Fireflies / tldv) + .docx / .pdf — all four._
  - User context: _"we are building a chrome extension to capture recording during meetings and it shows the transcript for the user to copy"_ — captured as a separate companion project; Aria-side handles paste path only.
- **Calendar linking:** _Time-window + attendee/title fuzzy match from transcript content._
- **No-event case:** _Allow standalone transcript Note (no event link)._

### Action-item extraction schema
- **Citation span:** _Char offsets into normalized transcript text._
- **Owner inference:** _Self + 'follow-up needed with X' as a self-task variant._ (Three states total: self, follow-up, unassigned.)
- **Summary structure:** _Topics covered + Decisions + Actions + Follow-ups + Open questions (5 sections)._

### Todoist sync semantics
- **Direction:** _Two-way (push + pull)._
- **Field mapping:** _Title + description (citation deep-link) + due (high-confidence only) + priority + project/labels._
- **Reject after push:** _Prompt: 'Also remove from Todoist?'_

### Dashboard surface + MEET-06 invariant
- **Surface:** _Dedicated Tasks view + briefing 'Open Actions' section._
- **Approval flow:** _Approval Queue card per Note (batch approve / edit / reject)._
- **MEET-06 enforcement:** _Both — architectural boundary module + CI checks + documented threat model entry._
- **Chrome extension:** _Separate project; Phase 6 only handles the paste path._

## Deferred Ideas
- Live meeting capture / bot attendees / cloud recording — explicitly forbidden
- Chrome extension bridge → future companion phase
- Asana / Jira task systems → ROADMAP later phase
- Three-way merge on Todoist conflicts → v1.x
- Speaker-diarized retrieval → Phase 7
- Bulk historic transcript import → defer
- Audio file upload + local transcription → out of scope

## Claude's Discretion (not asked, applied)
- Internal text model: `{ normalizedText, segments: [{start, end, speaker?, timestampSec?}] }`
- Long transcripts chunked (~3k tokens with overlap); actions de-duplicated across chunks
- Todoist auth = pasted API token (no OAuth needed)
- Push immediate on approval; pull every 5min
- Deep-link scheme `aria://notes/{noteId}#{start}-{end}` for citation back-link in Todoist descriptions
- Conflict resolution: last-write-wins (field-level) with "edited in Todoist" badge
- Todoist registered as `Provider` with `task` capability; uses provider_sync_state table
- Sensitivity classifier runs on transcript chunks before frontier calls (Phase 3 router)
