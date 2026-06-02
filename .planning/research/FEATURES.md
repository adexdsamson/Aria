# Feature Research

**Domain:** Privacy-first executive voice interface layered over a shipped local-first desktop AI assistant (Aria v2.0)
**Researched:** 2026-06-02
**Confidence:** MEDIUM-HIGH

> **Scope note.** This milestone LAYERS voice over Aria v1.0's existing, shipped surfaces — briefing, email triage/drafting/send, calendar smart-scheduling, RAG `/ask`, meeting capture, weekly recap — all gated by the `assertApproved` chokepoint and hybrid local/frontier routing. Voice does **not** re-implement those features; it becomes an additional **input modality** (speech in) and **output modality** (speech out) over the same IPC + service layer. Models are already chosen (Whisper large-v3-turbo local STT; Kokoro-82M / Chatterbox-Turbo local TTS; cloud opt-in) and are **out of scope** here.

> **Dependency vocabulary.** Every feature below names the **existing Aria surface** it wires into. The voice layer's job is to translate audio ⇄ those surfaces, never to bypass them. Critically, every action that produces an `assertApproved`-guarded write (email send, calendar change, task batch) MUST route through the **same** chokepoint — voice gets a *confirm flow*, not a *bypass*.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume any 2026 voice assistant has. Missing these = "this voice mode feels broken / toy-grade."

| Feature | Why Expected | Complexity | Aria surface dependency / notes |
|---------|--------------|------------|----------------------------------|
| **Push-to-talk activation** (hotkey + on-screen mic button) | The baseline, precise, privacy-safe way to talk to an assistant; execs in shared/open offices expect explicit control over when the mic is hot. PTT is "more precise and more appropriate for professional workflows." | **S** | New global hotkey + tray/mic affordance → routes captured audio to STT → existing intent/command dispatch. No always-listening risk. |
| **Live transcription display of what Aria heard** | Users must see the recognized text to trust it and catch mishears before action. Windows 11 / Android set the expectation that speech shows as live captions. | **S–M** | New transcript UI element near each surface; reuses existing screen layouts. The recognized string is the audit trail for "what did I just ask?" |
| **Spoken briefing playback** with **pause / resume / skip-section / speed (0.5–2.0×)** | TTS players universally ship play/pause, ±skip, and 0.5–2× speed; an audio briefing without them feels primitive. Execs listen while commuting/getting ready and need to skip sections they don't care about. | **M** | Wires into existing **daily briefing** generator (sectioned doc: calendar/email/tasks/news). Skip-section maps to the briefing's existing section structure. Needs a persistent mini-player overlay. |
| **Spoken answer playback for `/ask`** | If you can ask by voice, you expect the cited answer read back. | **S–M** | Wires into existing **RAG `/ask`** AnswerService. Read the answer body; surface citations visually (don't read URLs aloud). |
| **Barge-in / interruption** (user can cut off Aria mid-speech and it stops within ~200–300 ms) | Core to feeling conversational rather than scripted; "mature systems handle barge-in within 200–300 ms." Without it, playback feels like a robocall. | **M–L** | New: VAD on input stream while TTS plays + duck/stop TTS on detected speech onset. Must defend against false barge-in (echo, background noise). Cross-cuts every spoken-output surface. |
| **Multi-turn context within a session** | Users expect "schedule it for then" / "draft a reply to that one" to resolve against the prior turn. A voice assistant that forgets the last sentence is unusable. | **M** | Reuses existing conversational state where present; voice layer must carry a turn buffer + referent resolution into the existing command dispatch. |
| **Read-back + explicit confirm before any irreversible action** | The single non-negotiable safety pattern for voice. Intent Preview before execution is "non-negotiable for any action that is irreversible." Users assume the assistant will say what it's about to send/move and wait for a yes. | **M** | **Hard dependency on the existing `assertApproved` chokepoint.** See the dedicated section below. Applies to email send, material calendar change, task batch push, sensitivity-flagged drafts. |
| **Error/mishear recovery** ("did you mean…", repeat-to-correct) | Misrecognition is inevitable; users expect a graceful repair loop, not a dead end. Clarification prompts ("Did you mean *appointment* or *payment*?") and repeat-based correction are standard. | **M** | New repair logic: low STT confidence → confirm/clarify rather than act; "no, I said…" re-runs the utterance against the prior intent. Tied to confidence-cascade routing. |
| **Voice/output settings** (pick TTS voice, default speed, enable/disable spoken output) | Users expect to choose the voice and rate; a single fixed voice feels canned. | **S** | New settings section; reuses existing typed-prefs/settings pattern. Persists chosen Kokoro/Chatterbox voice + speed. |
| **Visible mic / listening state indicator** | Users must always know whether the mic is hot (privacy) and whether Aria is listening/thinking/speaking (turn-taking clarity). | **S** | New status affordance (idle / listening / thinking / speaking) in the shell; reuses existing tray + sidebar status patterns. |
| **Consent + disclosure gate before any audio leaves the machine (cloud opt-in)** | Aria's entire positioning is privacy-first local. Sending raw voice to cloud without an explicit, informed opt-in would violate the trust posture and 2026 norms ("only intentional requests or compact text are sent to the cloud"). | **M** | Mirrors the **existing hybrid-LLM routing consent** pattern. Default = on-device STT/TTS. Cloud path requires explicit per-feature opt-in + clear disclosure of what is sent. |

### Differentiators (Competitive Advantage)

Where Aria's privacy-first + chief-of-staff positioning lets voice stand out vs Copilot/Gemini/Siri.

| Feature | Value Proposition | Complexity | Aria surface dependency / notes |
|---------|-------------------|------------|----------------------------------|
| **Fully on-device voice by default** (STT + TTS local) | The differentiator vs every cloud assistant: an exec can talk to their inbox/calendar with zero audio leaving the machine. Directly extends Aria's local-first guarantee to the voice channel. | (models chosen) **M** to integrate | Local Whisper-turbo + Kokoro/Chatterbox sidecar. Mirrors the Ollama localhost-sidecar pattern already used for LLM/embeddings. |
| **Voice-confirm flow tuned for the `assertApproved` chokepoint** | A *safe* way to authorize irreversible work by voice — read-back of recipient + subject/time + body gist, then explicit verbal "yes, send" **or** click. Most assistants either refuse high-stakes actions or do them unsafely; Aria does them *safely by voice*. | **M–L** | Direct dependency on `assertApproved` + sensitivity classifier. The differentiating UX is the read-back script + dual-channel confirm. See dedicated section. |
| **Hands-free spoken morning briefing** ("Good morning — here's your day") | Turns the briefing (Aria's wedge) into an ambient, eyes-free ritual while getting ready/commuting — a daily habit cloud assistants can't safely offer over private calendar/email. | **M** | Wires into existing **briefing** generator + scheduler. Could trigger on PTT or (opt-in) wake word at the user's briefing time. |
| **Opt-in wake-word for true hands-free** ("Hey Aria") with on-device detection | Hands-free for kitchen/commute moments; on-device wake-word keeps audio local until trigger. Off by default to protect privacy posture; a deliberate, low-power local wake-word "provides both privacy and control." | **M** | New on-device wake-word model gating the same STT pipeline as PTT. Must be clearly off-by-default with a persistent listening indicator. |
| **Voice-driven triage** ("read me what needs me", "archive that", "draft a reply") | Eyes-free inbox triage is genuinely useful for execs between meetings; reads the existing prioritized queue and lets voice act on it (action still approval-gated). | **M** | Wires into existing **email triage** classifier + draft/send. Send always read-back-confirmed. |
| **Voice-driven scheduling** ("find me 30 minutes with Sam this week", "move my 2pm to 3") | NL scheduling by voice over the existing slot-finder is a strong chief-of-staff moment. Material calendar changes are read back + confirmed. | **M** | Wires into existing **calendar smart-scheduling** (slot finder, conflict detection, rules). Reuses the existing NL-intent schema. |
| **Voice-driven drafting that matches the user's voice** | Dictate intent → Aria drafts in the user's learned voice → reads it back → user edits by voice or approves. Compounds Aria's existing voice-match drafting. | **M** | Wires into existing **drafting** + voice-match. Read-back of draft is the natural review step. |
| **Accessibility as a first-class win** (full eyes-free + hands-free operation; live captions of Aria's speech) | Voice + live transcription makes Aria usable for low-vision users (TTS output) and deaf/HoH users (captions of spoken output). A genuine inclusivity advantage and a marketing point. | **S–M** | Layered on the live-transcript + TTS features already listed; mostly UI polish + reduced-motion/caption parity with existing editorial UI. |
| **Confidence-aware behavior** (high confidence → act after read-back; low → clarify) | "Confidence cascades": don't act confidently on a shaky transcription. Reduces wrong-action risk and feels smart. | **M** | New routing rule in the voice dispatch; feeds the error-recovery loop. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that sound good but conflict with Aria's privacy/trust posture or solo-dev scope. Document to prevent scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Always-listening with no wake word / no PTT (open mic)** | "Most natural, just talk anytime." | Continuous open mic shreds the privacy posture, causes false activations, captures unintended conversations, and burns CPU. "Removing the wakeword entirely undermines trust." | PTT default + **opt-in** on-device wake-word, off by default, with a visible listening indicator. |
| **Voice-only confirmation for irreversible sends** (just "yes" sends it) | "Faster, fully hands-free." | A single "yes" is dangerous — mishears, ambient speech, TV/other people can trigger an irreversible send. Violates "no surprising send." | Read-back + **explicit** confirm via verbal *confirmation phrase* **or** click; high-sensitivity items require the click (or typed/visible) confirm. Never auto-execute on a bare "yes." |
| **Auto-send / autonomous action without confirmation** ("just handle my email") | Feels like a true chief of staff. | Breaks the core trust guarantee and the `assertApproved` invariant; one wrong autonomous send destroys the product's reputation. | Keep human-in-the-loop. Offer an "Autonomy Dial" *only* down to "Act with Confirmation" — never "Act Autonomously" for outbound/material changes in v2.0. |
| **Cloud STT/TTS on by default for "best quality"** | Cloud voices sound a touch better. | Sends raw private audio off-machine by default — contradicts local-first positioning; the local models were chosen precisely because they now match cloud quality. | Local default; cloud is explicit per-feature opt-in behind consent + disclosure. |
| **Reading sensitive content aloud unprompted** (full email bodies, PII, financials over speakers) | "Just read me everything." | Speakers leak private content in shared spaces; sensitivity-flagged content read aloud is a privacy incident. | Read summaries/gist by default; require explicit "read the full message" and route sensitive content through the existing sensitivity classifier (and warn before reading flagged items aloud). |
| **Voice biometric authentication / speaker verification to unlock** | "Only I can use it." | Voice biometrics are spoofable, add large complexity, and create a false sense of security; the DB is already SQLCipher-locked behind the existing unlock. | Keep the existing vault-unlock auth; the mic only operates on an already-unlocked session. |
| **True single-model full-duplex (Aria talks while you talk, like Moshi)** | "Most human." | Needs A100-class GPU; impossible on-device for the target machines. The chosen approach is a cascading pipeline. | Half-duplex with fast barge-in (user can interrupt; Aria stops). That's the 2026 norm anyway: "Most systems use half-duplex with barge-in." |
| **Custom-trained branded wake words / multiple wake words** | Branding, personality. | Custom wake-word training is a project unto itself; marginal value for a solo dev. | Ship one solid built-in wake word ("Hey Aria"); defer customization. |
| **Voice notifications that speak interruptions aloud** ("You have a new email from…") | Proactive assistant feel. | Unsolicited speech in meetings/shared spaces is intrusive and a privacy leak. | Notifications stay visual (existing tray/toast); spoken output only on user request or scheduled briefing the user opted into. |

---

## Feature Dependencies

```
[STT pipeline (Whisper-turbo, local)]
    └──enables──> [Push-to-talk] ──enables──> [Voice-driven triage / scheduling / ask / drafting]
                       │                              │
                       │                              └──requires──> [assertApproved chokepoint] (EXISTING)
                       │                                                   └──requires──> [Voice-confirm read-back flow]
                       │                                                                        └──requires──> [Sensitivity classifier] (EXISTING)
                       └──enhanced by──> [Live transcription display]
                                              └──enables──> [Error/mishear recovery] ──requires──> [Confidence-aware routing]

[Opt-in wake word (local)] ──requires──> [STT pipeline] + [Visible listening indicator] + [Consent gate]

[TTS pipeline (Kokoro/Chatterbox, local)]
    └──enables──> [Spoken briefing playback] ──requires──> [Briefing generator] (EXISTING)
    └──enables──> [Spoken /ask answer]      ──requires──> [RAG AnswerService] (EXISTING)
    └──enables──> [Voice/output settings]
    └──requires──> [Barge-in / VAD] for natural interruption

[Cloud opt-in (STT and/or TTS)] ──requires──> [Consent + disclosure gate] (mirrors EXISTING hybrid-LLM consent)

[Multi-turn context] ──enhances──> [all voice-driven actions]  (referent resolution: "that one", "then", "him")
```

### Dependency Notes

- **All voice-driven actions require the existing `assertApproved` chokepoint.** Voice is an input modality onto the *same* approval path used by the text UI. The chokepoint already guards email send, calendar change, and task batch (3 surfaces). Voice adds a confirm *flow* in front of it — it must never call the underlying write directly. (Aria has been bitten before by approve-paths that wrote before/around the chokepoint — Phase 4 silent-write, Phase 6 missing guard — so the voice path needs the same guard + a ratchet.)
- **Voice-confirm requires the sensitivity classifier (existing).** Sensitivity level drives confirm strictness: normal → verbal-or-click confirm; flagged → require the click/visible confirm and warn before reading aloud.
- **Barge-in requires VAD over the input stream while TTS is playing**, plus false-barge-in defense (acoustic echo from TTS, background noise). This is the hardest net-new audio-engineering piece.
- **Wake word enhances (not replaces) PTT**, and depends on a visible listening indicator + the consent gate. It is off by default.
- **Error recovery depends on confidence-aware routing**: low STT confidence must clarify/confirm rather than dispatch an action.
- **Cloud opt-in mirrors the existing hybrid-LLM consent pattern** — reuse that UX/affordance rather than inventing a new one.

---

## The Voice-Confirm Flow for Approval-Gated / Irreversible Actions

**This is the load-bearing safety design for the milestone.** It must let an exec authorize an irreversible action by voice *without* the risk of an accidental send. Downstream requirements should treat this as a single hardened pattern reused by every voice-driven action surface.

**Pattern: Stage → Read-Back (Intent Preview) → Dual-Channel Explicit Confirm → existing `assertApproved` write → Audit/Undo.**

1. **Stage the action, never execute on the spoken command.** "Send the reply to Sam" produces a *staged* draft, exactly as the text UI would — it does not send.
2. **Read-back the consequential facts** (the Intent Preview pattern, "non-negotiable for irreversible actions"). For an email send: recipient(s), subject, and a one-line gist (not the full body unless asked). For a calendar change: event, old time → new time, attendees affected. Keep it short — voice UX demands brevity, known-info-first.
3. **Require an explicit, unambiguous confirm — not a bare "yes."**
   - **Normal sensitivity:** accept a **confirmation phrase** ("yes, send it" / "confirm") *or* a click on the on-screen Approve button. Reject ambiguous/low-confidence audio → re-prompt.
   - **High sensitivity (classifier-flagged) or high-stakes (external recipients, delete, money-adjacent):** require the **click / visible confirm** (the friction "speed bump"), because a verbal-only confirm is spoofable by ambient speech. Do **not** read flagged content aloud without a separate explicit request.
4. **The confirm routes through the existing `assertApproved` chokepoint.** The voice layer calls the same approve IPC the button calls — same single write path, same audit log entry. Add the voice path to the existing static-grep ratchet so it can't silently bypass.
5. **Always-available undo / audit after the fact.** Surface the resulting action in the existing action audit log; where the underlying provider supports it, expose an undo. "The ability to easily reverse an agent's action" is the strongest trust mechanism.
6. **Disambiguate before staging when reference is unclear** ("which Sam?", "the 2pm with marketing or sales?") — use the clarification-prompt pattern rather than guessing.

**Anti-pattern reminders:** never auto-execute on "yes"; never confirm-and-send sensitive content read aloud over speakers; never let the voice path reach the write without crossing `assertApproved`.

Complexity: **M–L** (the read-back scripting + dual-channel confirm + ratchet is the work; the write path already exists).

---

## MVP Definition

### Launch With (v2.0 core)

Minimum viable voice layer that's genuinely usable and trustworthy.

- [ ] **Push-to-talk + STT (local Whisper-turbo)** — the safe baseline input; everything depends on it.
- [ ] **Live transcription display + visible mic/state indicator** — trust + privacy clarity.
- [ ] **Spoken briefing playback with pause/skip-section/speed (local TTS)** — the wedge habit, hands-free.
- [ ] **Spoken `/ask` answer playback** — natural pairing with voice input; reuses RAG.
- [ ] **Voice-confirm flow over `assertApproved`** — required before *any* voice-driven action that sends/moves anything.
- [ ] **Voice-driven triage + scheduling + drafting** — the chief-of-staff payoff, each behind the confirm flow.
- [ ] **Multi-turn context (session referent resolution)** — without it, voice feels broken.
- [ ] **Error/mishear recovery + confidence-aware routing** — inevitable; ship the repair loop.
- [ ] **Voice/output settings (voice pick, speed, enable spoken output)** — basic control.
- [ ] **Cloud opt-in consent + disclosure gate** — must exist *before* any cloud audio path is offered (even if cloud itself ships slightly later, the gate gates it).

### Add After Validation (v2.0.x)

- [ ] **Barge-in / interruption** — high polish value; can ship shortly after the half-duplex core works if VAD/echo tuning isn't ready at launch. (Borderline table-stakes — promote if dogfood feels robotic without it.)
- [ ] **Opt-in wake-word ("Hey Aria")** — add once PTT + indicator + consent are proven; it's the riskiest privacy surface.
- [ ] **Cloud STT/TTS opt-in path (actual route)** — turn on the cloud route once the consent gate + local default are validated.
- [ ] **Accessibility polish** (caption parity, reduced-motion, full eyes-free nav audit) — once core voice flows are stable.

### Future Consideration (v2.1+)

- [ ] **Custom/branded wake words** — defer; low value for solo dev.
- [ ] **Deeper barge-in (backchannel "mm-hm" handling, partial-turn resume)** — refinement.
- [ ] **Voice over multi-party meeting coordination** — already deferred to v2.1+ per PROJECT.md.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Push-to-talk + local STT | HIGH | LOW | P1 |
| Live transcription + state indicator | HIGH | LOW | P1 |
| Voice-confirm flow over `assertApproved` | HIGH | MEDIUM | P1 |
| Spoken briefing playback (pause/skip/speed) | HIGH | MEDIUM | P1 |
| Spoken `/ask` answer | MEDIUM | LOW | P1 |
| Voice-driven triage / scheduling / drafting | HIGH | MEDIUM | P1 |
| Multi-turn context | HIGH | MEDIUM | P1 |
| Error/mishear recovery + confidence routing | HIGH | MEDIUM | P1 |
| Cloud opt-in consent gate | HIGH (trust) | MEDIUM | P1 |
| Voice/output settings | MEDIUM | LOW | P1 |
| Barge-in / interruption | HIGH | HIGH | P2 |
| Opt-in wake-word | MEDIUM | MEDIUM | P2 |
| Actual cloud STT/TTS route | MEDIUM | MEDIUM | P2 |
| Accessibility polish | MEDIUM | LOW–MEDIUM | P2 |
| Custom wake words | LOW | HIGH | P3 |

**Priority key:** P1 = must have for v2.0 launch · P2 = should have, add when stable · P3 = defer.

---

## Competitor Feature Analysis

| Feature | Siri / Apple Intelligence | Copilot Voice / Gemini Live | Aria's Approach |
|---------|---------------------------|------------------------------|-----------------|
| Audio processing locality | Mixed; cloud for most reasoning | Cloud | **Local-first by default**, cloud explicit opt-in — the differentiator |
| High-stakes action confirm | Often refuses or hands off to app | Confirms in-app | **Read-back + dual-channel confirm over a single `assertApproved` chokepoint** |
| Wake word | Always-on "Hey Siri" | "Hey Copilot" / always-on options | **Opt-in, off by default**, on-device, visible indicator |
| Barge-in | Yes | Yes (Gemini Live full-duplex-ish) | **Half-duplex + fast barge-in** (cascading pipeline; no A100) |
| Reads private inbox/calendar aloud | Limited | Cloud-mediated | **Summaries by default; sensitive content gated**; full read only on explicit request |
| Drafting in user's voice | Generic | Generic | **Learned voice-match** (existing) read back before send |
| Undo / audit of actions | Partial | Partial | **Existing action audit log + undo where provider supports** |

---

## Sources

- [Designing Agentic AI: UX Patterns for Control, Consent, Accountability — Smashing Magazine (Feb 2026)](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) — Intent Preview, Autonomy Dial, Confidence Signal, Action Audit & Undo, escalation, anti-patterns. (MEDIUM-HIGH)
- [Voice AI Barge-In and Turn-Taking: A 2026 Implementation Guide — Future AGI](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/) — VAD, false-barge-in defense, 200–300 ms barge-in, end-of-turn detection. (MEDIUM)
- [Real-Time (Speech-to-Speech) vs Turn-Based Cascading STT/TTS Architecture — Softcery](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture) — half-duplex + barge-in as the practical norm. (MEDIUM)
- [Complete Guide to Wake Word Detection (2026) — Picovoice](https://picovoice.ai/blog/complete-guide-to-wake-word/) — on-device wake-word gating, privacy architecture. (MEDIUM)
- [The Future of Voice Interaction Beyond "Always-Listening" — Sensory](https://sensory.com/sensory-smart-wakewords-future-voice-interaction/) — why removing the wake word undermines trust; PTT vs wake-word tradeoffs. (MEDIUM)
- [Voice UI Design Guide 2026 — Fuselab Creative](https://fuselabcreative.com/voice-user-interface-design-guide-2026/) — confidence cascades, short responses, confirmation prompts, interruption handling. (MEDIUM)
- [UI & UX Principles for Voice Assistants — Google Design](https://design.google/library/speaking-the-same-language-vui) — read-back/known-info-first to confirm correct hearing. (MEDIUM)
- [User-Initiated Repetition-Based Recovery in Multi-Utterance Dialogue Systems — arXiv (Apple Research)](https://arxiv.org/pdf/2108.01208) — repeat-to-correct mishear recovery. (MEDIUM)
- [TTS playback controls — ArticleAudio / OpenAI Read-Aloud feature requests](https://articleaudio.com/) — standard pause/play, ±skip, 0.5–2× speed expectations. (MEDIUM)
- [Use Live Captions — Microsoft Support](https://support.microsoft.com/en-us/accessibility/windows/use-live-captions-to-better-understand-audio) — live caption display as the accessibility/transcription norm. (HIGH)
- Aria `PROJECT.md` (v2.0 milestone) and `CLAUDE.md` (existing `assertApproved` chokepoint, sensitivity classifier, hybrid-LLM consent pattern, shipped surfaces). (HIGH — internal)

---
*Feature research for: privacy-first executive voice interface (Aria v2.0)*
*Researched: 2026-06-02*
