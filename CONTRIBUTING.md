# Contributing to Aria

## Reporting Issues

File a GitHub Issue using the bug or feature template. Please include your operating system, Electron version (shown in Help → About or `npx electron --version`), and a clear set of steps to reproduce the problem. Screenshots and log excerpts (from `~/.aria/logs/`) are especially helpful.

## Development Setup

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites and running instructions.

## Pull Requests

This is a solo-developer showcase project. Pull requests are welcome but not actively solicited. Before opening a large PR, please file an issue to discuss the change — it avoids wasted effort if the direction does not align. Small fixes, typo corrections, and documentation improvements can go straight to a PR.

There is no CLA or DCO requirement.

## Code Style

TypeScript strict mode throughout. Run `pnpm run typecheck` before submitting to catch type errors (note: `electron-vite` does not run `tsc` during build — errors can slip through without this step). Run `pnpm run lint:guard` to execute the codebase-specific grep ratchets in `scripts/grep-*.mjs` that enforce invariants like the `assertApproved` chokepoint and migration call-site patterns.

## Thank You

Thank you for your interest in Aria.
