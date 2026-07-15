---
quick_id: 260715-pdf
slug: pdf-worker-src
date: 2026-07-15
---

# Fix PDF ingestion (pdfjs-dist workerSrc) — Ask Aria "No answer found"

## Problem

Ask Aria returned "No answer found" for queries about "swiftpro". Runtime log
(aria.1.log) root cause:

```
folder-ingestion file_error  ...\Downloads\Swiftpro\SwiftPro Project Handover.pdf
  error: "Setting up fake worker failed: \"No \"GlobalWorkerOptions.workerSrc\" specified.\""
folder-ingestion file_error  ...\Downloads\Swiftpro\SwiftPro_Handover_Document.docx.pdf  (same)
knowledge-ipc reindex_done  indexed:5  errors:3
```

The two SwiftPro handover PDFs — the actual content the user asked about —
failed to parse, so no chunks were indexed → nothing to retrieve.

`src/main/folder-ingestion/parsers/pdf.ts:27` set
`pdfjs.GlobalWorkerOptions.workerSrc = ''` ("disable worker for Node.js").
That empty-string trick worked under pdfjs's old Node-detection path, but
pdfjs-dist v5 detects Electron's main process as browser-like (not Node) and
takes the browser fake-worker path, which REQUIRES a loadable workerSrc. Empty
→ "No GlobalWorkerOptions.workerSrc specified" → every PDF errors.

(nomic-embed-text:v1.5 IS installed; embeddings were never the issue. Prior
commit c3222f7 got the ESM build loading but left this stale worker line.)

## Change

`pdf.ts`: resolve `pdfjs-dist/legacy/build/pdf.worker.mjs` via `require.resolve`
and set `workerSrc` to its `pathToFileURL(...).href` (file:// URL — a bare/OS
path is not a valid ESM import specifier). The in-process fake worker then
import()s it successfully.

## Verification

- Node harness parsed the real failing PDF: 5 pages, 1522 chars page 1.
- `npm run typecheck`: pdf.ts clean (no new errors; 20 pre-existing unrelated).
- RUNTIME (pending user): unlock vault → manual reindex of Swiftpro folder
  (ingestFolderOnce retries all files) → log shows upsert (no file_error) →
  Ask "swiftpro" returns an answer.

## Notes / follow-up

- Boot reconciler (boot-reconciler.ts) only re-ingests new/mtime-changed files,
  so it will NOT auto-retry previously-errored files on restart — a manual
  folder reindex is required. Consider making the reconciler retry rows with
  status='error' (separate enhancement; guard against infinite retry of
  permanently-broken files).
- Packaged builds: pdfjs + worker live in the asar; ESM import() of the worker
  from a file:// URL inside app.asar is unverified — confirm when a packaged
  build exercises PDF ingestion.
