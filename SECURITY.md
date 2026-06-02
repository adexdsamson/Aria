# Security

## Security Posture

Aria is a local-first application. Its security model is designed so that your data stays on your machine:

- **Local encrypted storage.** All calendar, email, meeting, and task data is stored in an SQLCipher-encrypted SQLite database (AES-256 whole-database encryption). The database key is derived from your vault passphrase and never stored in plaintext.
- **Secrets in the OS keychain.** OAuth tokens and API keys are stored via Electron `safeStorage` — which uses Keychain on macOS, DPAPI on Windows, and libsecret on Linux. They are never written to disk as plaintext.
- **Only scoped LLM prompts leave the machine.** Aria sends prompts to frontier LLM APIs (Anthropic, OpenAI, or Google AI) using your own API keys. These prompts are scoped to the task (briefing generation, email drafting, etc.) — your raw inbox is never bulk-uploaded.
- **PII pre-routing to local model.** Content classified as sensitive or PII-containing is routed to a local Ollama model (Llama 3.1 8B / Qwen class running on your machine at `localhost:11434`) and is never sent to a frontier API.
- **Approval gate on all outbound actions.** Aria cannot send email, modify your calendar, or create tasks autonomously. Every such action requires explicit user confirmation in the approvals queue before the main process executes it.
- **No telemetry by default.** Crash reporting via Sentry is opt-in only, and the `beforeSend` filter strips all user content — only stack traces are transmitted.

## Reporting a Vulnerability

Please do **not** open a public GitHub Issue for security vulnerabilities. Disclosing a security issue publicly before a fix is available puts all users at risk.

Instead, use one of these private channels:

- **GitHub private vulnerability reporting:** Go to the Security tab of this repository → "Report a vulnerability". GitHub will create a private advisory and notify the maintainer.
- **Email:** Send details to [ai@mainlandtech.com](mailto:ai@mainlandtech.com). Include a description of the vulnerability, reproduction steps, and any relevant log output.

We will respond within 72 hours and coordinate a fix before any public disclosure.

## Scope

This project is a solo-developer showcase. Security fixes are handled on a best-effort basis with no formal SLA. For production-critical or enterprise deployments, please conduct your own security review.
