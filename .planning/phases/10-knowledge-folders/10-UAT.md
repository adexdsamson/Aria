# Phase 10 — Knowledge Folders UAT Checklist

**Plan:** 10-03  
**Status:** Awaiting sign-off  
**Date:** 2026-05-21

---

## Verifier checks (run FIRST before walking through steps)

```bash
# All three must pass:
git diff src/main/rag/model-swap-reconciler.ts   # must be empty
grep -E "source_kind\s+IN" src/main/insights/gate.ts  # must NOT contain 'folder'
grep -c "KnowledgeFoldersSection" src/renderer/features/settings/SettingsScreen.tsx  # must be >= 2
```

---

## 1. Add a small folder (below threshold)

**Steps:**
1. Launch the Aria desktop app and unlock.
2. Navigate to **Settings** → **Knowledge folders** (under Connections).
3. Click **+ Add folder**.
4. In the system folder picker, choose a directory with fewer than 100 files (e.g. a small `~/Documents/notes` folder).

**Expected:**
- The folder picker closes and the Add-folder modal opens directly — NO threshold confirm dialog appears.
- Modal shows the folder path and a label field pre-filled with the folder name.
- Set label to **"Test Small"**, sensitivity = **General**. Click **Add**.
- A folder card appears in the list showing:
  - Label: "Test Small"
  - Sensitivity badge: "General"
  - Status badge: "active"
  - `fileCount` > 0
  - `bytesIndexed` > 0
  - `lastScanAt` shows a recent timestamp

**Pass condition:** Card appears with correct metadata within a few seconds.

---

## 2. Add a large folder (above threshold)

**Steps:**
1. Click **+ Add folder**.
2. Choose a directory containing > 5000 files OR > 2 GB total (e.g. a `node_modules` directory with excludes off, or assemble fixtures).

**Expected — Cancel path:**
- The threshold confirm dialog appears with text including the file count and formatted size.
- Click **Cancel**: no folder card appears. The list is unchanged.

**Expected — Continue path:**
3. Click **+ Add folder** again, pick the same large directory.
4. Threshold dialog appears. Click **Continue**.
5. The Add-folder modal opens. Fill in label, click **Add**.
6. A folder card appears. `fileCount` and `bytesIndexed` reflect the large folder.

**Pass condition:** Cancel suppresses add; Continue proceeds through add-modal to card appearance.

---

## 3. /ask returns folder citations

**Steps:**
1. Create a `.md` file in the Test Small folder with a uniquely-keyworded phrase, e.g.:
   ```
   The secret project codename is: COBALT-ZEPHYR-9274
   ```
2. Save the file. Wait ~5 seconds (chokidar 1.5s stability threshold + ingest).
3. Navigate to **/ask**.
4. Query: `"What is the secret project codename?"`

**Expected:**
- A non-refusal answer that quotes or references **COBALT-ZEPHYR-9274**.
- A citation entry pointing to the file in the Test Small folder.
- Routing badge shows **FRONTIER** (general folder = non-sensitive).

**Pass condition:** Citation present with folder source; FRONTIER routing shown.

---

## 4. Sensitivity flip routes LOCAL

**Steps:**
1. Return to **Settings** → **Knowledge folders**.
2. On the "Test Small" card, click **Mark sensitive**.
3. Card sensitivity badge changes to "Sensitive" (gold).
4. Navigate to **/ask**. Re-query the same unique keyword.

**Expected:**
- Response routes **LOCAL** (lock-badge indicator visible).
- Routing reason contains `folder:high`.

5. On the "Test Small" card, click **Mark general**.
6. Re-query /ask.

**Expected:**
- Response routes **FRONTIER** again (no lock badge).

**Pass condition:** FRONTIER → LOCAL → FRONTIER round-trip confirmed.

---

## 5. Destructive remove

**Steps:**
1. In **Settings** → **Knowledge folders**, click **Remove** on "Test Small".

**Expected (cancel path):**
- A confirm dialog appears with text mentioning "Test Small" and noting files on disk are not touched.
- Click **Cancel**: folder card remains. `removeFolder` IPC NOT called.

2. Click **Remove** again.

**Expected (confirm path):**
- Confirm dialog appears.
- Click **Remove** (red button).
- The "Test Small" folder card disappears from the list.

3. Navigate to **/ask** and re-query the unique keyword.

**Expected:**
- /ask no longer returns citations from the removed folder.

**Pass condition:** Cancel preserves; confirm removes; /ask cleared.

---

## 6. Watcher live edits

**Pre-condition:** A folder with at least one indexed file is present.

**Steps:**
1. Open the indexed `.md` file in an editor and add a new unique keyword, e.g. `INDIGO-AXIOM-5512`.
2. Save the file.
3. Wait ~5 seconds.
4. Query /ask for `INDIGO-AXIOM-5512`.

**Expected:**
- /ask returns the new keyword in its answer (chunk re-indexed by chokidar watcher).

**Pass condition:** New keyword appears in /ask results within ~5s.

---

## 7. Tombstone

**Steps:**
1. Delete the `.md` file from disk (move to Trash or `rm`).
2. Wait ~5s for the watcher to fire.
3. Check the folder card: `fileCount` should have decremented.
4. Query /ask for the unique keyword.

**Expected:**
- /ask no longer returns that keyword (chunk tombstoned, not returned by hybrid retrieval).

**Pass condition:** fileCount decrements; /ask no longer returns the deleted file's content.

---

## Sign-off

Type `approved` to close Phase 10, or list issues found.

| Step | Result | Notes |
|------|--------|-------|
| 1. Add small folder | ☐ Pass / ☐ Fail | |
| 2. Add large folder (cancel + continue) | ☐ Pass / ☐ Fail | |
| 3. /ask folder citations | ☐ Pass / ☐ Fail | |
| 4. Sensitivity flip LOCAL | ☐ Pass / ☐ Fail | |
| 5. Destructive remove | ☐ Pass / ☐ Fail | |
| 6. Watcher live edits | ☐ Pass / ☐ Fail | |
| 7. Tombstone | ☐ Pass / ☐ Fail | |
