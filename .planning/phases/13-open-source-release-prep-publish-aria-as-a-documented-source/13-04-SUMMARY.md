---
phase: 13-open-source-release-prep-publish-aria-as-a-documented-source
plan: "04"
subsystem: oss-meta
tags: [github-templates, package-metadata, agents-tidy, community-standards]

dependency_graph:
  requires: [13-01]
  provides: [github-community-scaffolding, package-oss-metadata]
  affects: [package.json, AGENTS.md, .github/]

tech_stack:
  added: []
  patterns: [github-issue-template-yaml-frontmatter]

key_files:
  created:
    - .github/ISSUE_TEMPLATE/bug_report.md
    - .github/ISSUE_TEMPLATE/feature_request.md
    - .github/PULL_REQUEST_TEMPLATE.md
  modified:
    - package.json
    - AGENTS.md

decisions:
  - "GitHub URL: git+https://github.com/adexdsamson/Aria.git (from grounding rules; overrides CONTEXT placeholder)"
  - "private:true retained in package.json — desktop app, not an npm package"
  - "4 Codex occurrences replaced in AGENTS.md: Team constraint, UI stack pairing, Project Skills path, Developer Profile generator comment"

metrics:
  duration: "~10 minutes"
  completed: "2026-06-02"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 2
---

# Phase 13 Plan 04: GitHub Scaffolding + Package Metadata Summary

**One-liner:** GitHub community templates (.github/ × 3) and package.json OSS metadata (MIT license, repository, homepage, author, bugs) added; AGENTS.md stray Codex references corrected to Claude Code.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create .github issue templates and PR template | 4cbbe82 | .github/ISSUE_TEMPLATE/bug_report.md, feature_request.md, PULL_REQUEST_TEMPLATE.md |
| 2 | Add package.json OSS metadata and tidy AGENTS.md | f781c79 | package.json (+5 fields), AGENTS.md (4 replacements) |

## What Was Built

### .github/ISSUE_TEMPLATE/bug_report.md
Structured bug report template with YAML front matter (name, about, labels: bug). Body sections: Description, Steps to Reproduce, Expected/Actual Behavior, Environment (OS, Electron version, Node version, pnpm version, Ollama running, LLM providers configured), Logs (pino log file attachment guidance), Additional Context.

### .github/ISSUE_TEMPLATE/feature_request.md
Feature request template with YAML front matter (labels: enhancement). Body sections: Summary, Problem/Motivation, Proposed Solution, Alternatives Considered, Additional Context. Includes solo-maintainer note at bottom.

### .github/PULL_REQUEST_TEMPLATE.md
Light PR template (plain markdown, no front matter). Sections: Description, Type of Change (5 checkboxes), Testing (run pnpm test:unit + typecheck), Checklist (typecheck, lint:guard, test:unit, no secrets, limited scope). Under 30 lines.

### package.json (additive metadata)
Added after `"description"`:
- `"license": "MIT"`
- `"author": "Mainland Tech <ai@mainlandtech.com>"`
- `"homepage": "https://github.com/adexdsamson/Aria#readme"`
- `"repository": { "type": "git", "url": "git+https://github.com/adexdsamson/Aria.git" }`
- `"bugs": { "url": "https://github.com/adexdsamson/Aria/issues" }`

`"private": true` confirmed present. All existing keys (name, version, scripts, dependencies, devDependencies, build) untouched. JSON validity confirmed via node parse.

### AGENTS.md (tidy)
4 stray "Codex" references replaced:
1. `Solo dev + Codex` → `Solo dev + Claude Code` (Constraints section)
2. `fastest Codex pairing` → `fastest Claude Code pairing` (UI stack section)
3. `.Codex/skills/` → `.claude/skills/` (Project Skills section)
4. `generate-Codex-profile` → `generate-claude-profile` (Developer Profile section)

Zero "Codex" occurrences remain (verified with grep count = 0).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

One deliberate override: the plan body suggested a `mainlandtech/aria` placeholder URL for package.json. The grounding rules explicitly specified `https://github.com/adexdsamson/Aria.git` as the actual remote. Used the actual remote URL.

## Verification Results

- [x] .github/ISSUE_TEMPLATE/bug_report.md exists and contains "Steps to Reproduce"
- [x] .github/ISSUE_TEMPLATE/feature_request.md exists and contains "feature_request" in front matter
- [x] .github/PULL_REQUEST_TEMPLATE.md exists, contains "## Description" and "pnpm run typecheck"
- [x] package.json contains "license": "MIT", "private": true, "repository", "author", "homepage", "bugs"
- [x] package.json is valid JSON (node parse confirmed)
- [x] AGENTS.md: grep "Codex" = 0 matches
- [x] .github/workflows/build.yml untouched (not staged or modified)
- [x] STATE.md and ROADMAP.md not modified

## Self-Check: PASSED

Files confirmed present:
- C:\Users\HomePC\Documents\GitHub\Aria\.github\ISSUE_TEMPLATE\bug_report.md
- C:\Users\HomePC\Documents\GitHub\Aria\.github\ISSUE_TEMPLATE\feature_request.md
- C:\Users\HomePC\Documents\GitHub\Aria\.github\PULL_REQUEST_TEMPLATE.md

Commits confirmed:
- 4cbbe82 feat(13-04): add GitHub community issue and PR templates
- f781c79 feat(13-04): add OSS metadata to package.json and fix AGENTS.md Codex refs
