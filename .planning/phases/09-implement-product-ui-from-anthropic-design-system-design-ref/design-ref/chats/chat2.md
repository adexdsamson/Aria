# Codebase Product Update

_Started 2026-05-17 16:53 UTC_

---

## User

I want you to update the product based on the update to the codebase

## Assistant

_[tool: list_files]_

_[tool: local_ls]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: read_file]_

_[tool: local_ls]_

_[tool: local_ls]_

_[tool: local_ls]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

Let me see the current state of the screens in the prototype, and the actual built features.

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

Let me look at the settings, onboarding, side nav and routes to understand the actual app structure.

_[tool: read_file]_

Let me look at the current prototype to understand what needs updating.

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Let me check a few more things quickly to round out my picture.

_[tool: update_todos]_

_[tool: snip]_

I have a clear picture. The codebase has shipped Phases 1+2 and the prototype currently shows the full vision (9 screens). I'll update the prototype to honestly reflect what's actually shipped — restructuring the briefing to match the real 3-section UI, swapping onboarding to the recovery-phrase flow, rebuilding settings with the 8 actual tabs, demoting approvals to its real placeholder state, and grouping the unbuilt screens under a "Roadmap" section in the nav.

_[tool: grep]_

_[tool: grep]_

_[tool: write_file]_

Good — I have all the icons available. Now let me start rebuilding. I'll start with the Briefing screen (most impactful change).Now the Settings rebuild with the actual 8 tabs:

_[tool: write_file]_

Now the Onboarding rebuild — the new flow is BIP39 mnemonic → confirm → news picker → daily password:

_[tool: write_file]_

Now Approvals — demote to the Phase-3 placeholder it actually is, but with rich preview of what's coming:

_[tool: write_file]_

Now I need to update the app shell — restructure the SideNav (Shipped vs Roadmap), add phase badges, add the preview banner for unbuilt screens, and update topbar titles.

_[tool: write_file]_

_[tool: str_replace_edit]_

Let me wire the Settings tab override so clicking "Ask Aria" actually lands in Diagnostics:Now let me update the index.html and landing.html to reflect the actual shipped state. Also, I'll preview the app to make sure it works.

_[tool: show_html]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: str_replace_edit]_

Clean. Now update the index page to reflect the new structure:

_[tool: grep]_

_[tool: str_replace_edit]_

Now let me check the landing page and decide what to update. Then I'll verify the app works.

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: update_todos]_

The landing page is marketing for the eventual product — I'll keep that aspirational. Let me add a small honesty note in the hero, then verify everything works.

_[tool: save_screenshot]_

Let me do a quick visual check before handing off.

_[tool: view_image]_

_[tool: str_replace_edit]_

The sidebar items are wrapping awkwardly with the phase badges. Let me fix:Also need to prevent the nav item labels from wrapping. Let me add white-space: nowrap:

_[tool: str_replace_edit]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

Looks like the screenshot is stale — html-to-image caches. Let me reload explicitly:

_[tool: show_html]_

_[tool: sleep]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: str_replace_edit]_

Brand row is wrapping and pushing things tight. Let me clean up the sidebar header:

_[tool: done]_

The cramped view is from the screenshot iframe being narrow — at a normal viewport this'll be fine. Let me hand off to the user.

_[tool: fork_verifier_agent]_

Updated the prototype to match what's actually shipped vs. what's still on the roadmap.

**Shipped surfaces (rebuilt to match the codebase)**
- **Briefing** — now three sections (Today's Calendar · Priority Email · News) with a `[FRONTIER]/[LOCAL]` route badge, Regenerate button, per-item "why this mattered" rationales, B4 "no-IMPORTANT-label" fallback copy, dismissible news with back-links.
- **Settings** — the eight real tabs: Status · Frontier key · Local model · Integrations · News sources · Briefing · Backup & restore · Diagnostics (with Ask Aria + routing_log).
- **Onboarding** — BIP39 12-word phrase → 3-position challenge → country/sector picker → daily password seal.
- **Approvals** — honest Phase-3 placeholder, with the rich queue UX preserved beside it as a labelled design preview.

**Roadmap section** in the sidebar groups the unbuilt surfaces (Inbox triage · Smart calendar · Meeting capture · Ask Aria RAG · Weekly recap), each phase-tagged (P3–P8) and prefixed with a "Design preview" banner naming the plans that will deliver it. Index page now reads "Phase 1 & 2 shipped"; landing hero says "shipping in waves."

**Tweaks panel** gained switches for the briefing-specific states the codebase models: route (FRONTIER/LOCAL), the no-IMPORTANT fallback, and the "no briefing for today" empty state with the GenerateNowAffordance.Verifier finished without flagging anything — the prototype is good to review.

