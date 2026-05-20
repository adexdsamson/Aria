// app-data.jsx — sample data for Aria desktop prototype
// All times for: Tuesday, 17 May 2026

const USER = {
  name: "Eleanor Vance",
  email: "eleanor@northwind.co",
  company: "Northwind",
  role: "Founder & CEO",
  initials: "EV",
  timezone: "America/New_York",
};

const TODAY = "Tuesday, 17 May 2026";

// ─────────── Today's events ───────────
const EVENTS = [
  { id: 'e1', time: "08:30", end: "09:00", title: "Focus block — Series B deck",         attendees: [], type: 'focus' },
  { id: 'e2', time: "09:30", end: "10:00", title: "1:1 with James Park",                  attendees: ['james'], type: 'meeting', prep: true, urgent: false },
  { id: 'e3', time: "10:30", end: "11:30", title: "Acme — Q3 partnership review",          attendees: ['diana','aaron','marcus'], type: 'meeting', prep: true, urgent: true },
  { id: 'e4', time: "12:00", end: "13:00", title: "Lunch — David Yoo (Maple Capital)",     attendees: ['david'], type: 'meeting', prep: true, urgent: false },
  { id: 'e5', time: "14:00", end: "14:30", title: "Engineering standup",                   attendees: ['team'], type: 'meeting', urgent: false },
  { id: 'e6', time: "15:00", end: "15:30", title: "Buffer",                                attendees: [], type: 'buffer' },
  { id: 'e7', time: "15:30", end: "16:30", title: "Board prep w/ Sarah Chen",              attendees: ['sarah'], type: 'meeting', prep: true, urgent: false },
  { id: 'e8', time: "17:00", end: "17:30", title: "Hold — pickup, school",                 attendees: [], type: 'personal' },
];

// ─────────── Inbox ───────────
const EMAILS = [
  { id: 'm1', from: 'Marcus Aldridge', sender_email: 'marcus@aldridgeco.com', avatar: 'MA',
    subject: 'Re: Term sheet — final language on liquidation preference',
    preview: 'Eleanor — I think we are close. The 1.2x non-participating is the right floor; my read is that the lead will live with that…',
    body: `Eleanor —

I think we are close. The 1.2x non-participating is the right floor; my read is that the lead will live with that if you concede on the protective provision around board composition. Joel's lawyer is going to push on the 7-year sunset which is fine — give them 5.

Two outstanding items:

1) The pro-rata side letter for Maple — David flagged that he wants this in writing. It is a clean give.

2) The drag-along threshold. They want 65%. I want 60%. Worth a call before tomorrow?

I am free 4–5 today or first thing in the morning.

— Marcus`,
    time: "07:14",
    classification: 'URGENT', score: 9,
    why: "Board member · time-sensitive (closing this week) · request for response today",
    has_draft: true,
    draft: `Marcus,

Thanks — agreed on 1.2x and the 7-year sunset (5 yrs is fine). I will concede board composition.

For drag, hold at 60% — I want headroom in case we add a strategic later.

I will get the Maple side letter drafted and over to David this afternoon.

4pm works. I'll send an invite.

— E`
  },
  { id: 'm2', from: 'Diana Reeves', sender_email: 'd.reeves@acmeworks.com', avatar: 'DR',
    subject: 'Tomorrow\'s review — agenda + the data we promised',
    preview: 'Quick note ahead of our 10:30 — attaching the cohort numbers Aaron put together and the proposed scope for Q3…',
    time: "06:42",
    classification: 'URGENT', score: 8,
    why: "Tomorrow's meeting · attached materials need review · external partner",
    has_draft: false,
  },
  { id: 'm3', from: 'David Yoo', sender_email: 'david@maplecapital.vc', avatar: 'DY',
    subject: 'Lunch today — moving to 12:15 if okay',
    preview: 'Running 15 late from my prior. Same place. Let me know.',
    time: "08:01",
    classification: 'URGENT', score: 7,
    why: "Calendar change · today · waiting on confirmation",
    has_draft: true,
    draft: `12:15 works. See you there.\n\n— E`,
  },
  { id: 'm4', from: 'Sarah Chen', sender_email: 'sarah@northwind.co', avatar: 'SC',
    subject: 'Board deck — v3 attached, two questions',
    preview: 'V3 incorporates your edits on slide 4 and the new revenue chart. Two open questions for you before I lock…',
    time: "Yesterday 22:18",
    classification: 'ACTION', score: 6,
    why: "Awaiting your input before board prep · internal",
    has_draft: false,
  },
  { id: 'm5', from: 'James Park', sender_email: 'james@northwind.co', avatar: 'JP',
    subject: 'Quick — can we push the offer for Tomás by a day?',
    preview: 'Legal asked for one more pass. Not a problem on his side, I checked.',
    time: "Yesterday 19:45",
    classification: 'ACTION', score: 5,
    why: "Cofounder · hiring decision · low-friction",
    has_draft: true,
    draft: `Yes, fine. Send me the new version when it is back from legal and I will sign.`,
  },
  { id: 'm6', from: 'Asha Murthy', sender_email: 'asha@northwind.co', avatar: 'AM',
    subject: 'Engineering OKRs — draft for Q3',
    preview: 'First pass, would love feedback by end of week. Not urgent.',
    time: "Yesterday 16:30",
    classification: 'ACTION', score: 4,
    why: "Internal · soft deadline · reading required",
    has_draft: false,
  },
  { id: 'm7', from: 'Pitchbook Weekly', sender_email: 'no-reply@pitchbook.com', avatar: 'PW',
    subject: 'This week in venture: Series A activity slows; sector deep dive on climate tech',
    preview: 'Your subscribed digest…',
    time: "06:00",
    classification: 'FYI', score: 2,
    why: "Industry newsletter · subscribed",
  },
  { id: 'm8', from: 'Holly Sanderson', sender_email: 'holly@graceful.events', avatar: 'HS',
    subject: 'Save the date — Founders dinner, 12 June',
    preview: 'Hi Eleanor, we are putting together a small dinner with a few founders…',
    time: "Mon 14:22",
    classification: 'FYI', score: 3,
    why: "Networking · no immediate action",
  },
  { id: 'm9', from: 'AWS', sender_email: 'no-reply@aws.amazon.com', avatar: 'AW',
    subject: 'Your invoice for April 2026 is ready',
    preview: 'Account 4711-9921…',
    time: "Mon 09:00",
    classification: 'NOISE', score: 1,
    why: "Automated notification",
  },
  { id: 'm10', from: 'Linkedin', sender_email: 'no-reply@linkedin.com', avatar: 'LI',
    subject: '12 people you may know',
    preview: 'Suggestions from your network…',
    time: "Sun 08:00",
    classification: 'NOISE', score: 1,
    why: "Automated notification",
  },
];

// ─────────── Action items / commitments ───────────
const ACTIONS = [
  { id: 'a1', text: "Send pro-rata side letter to David Yoo",
    source: "Marcus Aldridge · email · today 07:14",
    due: "Today",   priority: 'high', status: 'open', owner: 'me' },
  { id: 'a2', text: "Review Sarah's v3 board deck and answer two questions",
    source: "Sarah Chen · email · yesterday",
    due: "Today",   priority: 'high', status: 'open', owner: 'me' },
  { id: 'a3', text: "Confirm drag-along threshold with Marcus",
    source: "Marcus Aldridge · email · today 07:14",
    due: "Today",   priority: 'high', status: 'open', owner: 'me' },
  { id: 'a4', text: "Reply to Diana with Q3 scope sign-off",
    source: "Acme · meeting today 10:30",
    due: "Tomorrow", priority: 'med', status: 'open', owner: 'me' },
  { id: 'a5', text: "Get Tomás offer letter back from legal",
    source: "James Park · cofounder",
    due: "Wed",     priority: 'med', status: 'open', owner: 'james' },
  { id: 'a6', text: "Review engineering Q3 OKRs",
    source: "Asha Murthy · email · yesterday",
    due: "Fri",     priority: 'low', status: 'open', owner: 'me' },
  { id: 'a7', text: "Send Aaron the pricing memo we discussed",
    source: "Acme · last week's call",
    due: "OVERDUE — 2 days", priority: 'high', status: 'overdue', owner: 'me' },
];

// ─────────── Pending approvals ───────────
const APPROVALS = [
  { id: 'p1', type: 'email_send', urgency: 'high',
    title: "Reply to Marcus Aldridge — Term sheet",
    to: ['marcus@aldridgeco.com'], from: 'eleanor@northwind.co',
    subject: 'Re: Term sheet — final language on liquidation preference',
    body: `Marcus,

Thanks — agreed on 1.2x and the 7-year sunset (5 yrs is fine). I will concede board composition.

For drag, hold at 60% — I want headroom in case we add a strategic later.

I will get the Maple side letter drafted and over to David this afternoon.

4pm works. I'll send an invite.

— E`,
    why: "Marcus asked a direct question. Voice match: trimmed greeting, dash sign-off, no hedging.",
    flags: ['Financial language present — sensitivity classifier asked for explicit confirmation'],
    sensitive: true,
  },
  { id: 'p2', type: 'email_send', urgency: 'med',
    title: "Reply to David Yoo — 12:15 lunch",
    to: ['david@maplecapital.vc'], from: 'eleanor@northwind.co',
    subject: 'Re: Lunch today — moving to 12:15 if okay',
    body: `12:15 works. See you there.\n\n— E`,
    why: "Trivial confirmation. Auto-approve eligible (under your AUTO_SMALL tier).",
    flags: [],
  },
  { id: 'p3', type: 'calendar_decline', urgency: 'low',
    title: "Decline — 'Quick chat?' from Holly Sanderson, Thu 5pm",
    payload: "Polite decline drafted citing focus block; suggests next Tuesday.",
    body: `Holly — I am blocked out Thursdays after 4pm. I could do next Tuesday 11–11:30 if that works for you. — E`,
    why: "Conflicts with your 'no meetings after 4pm' rule.",
    flags: [],
  },
  { id: 'p4', type: 'task_create', urgency: 'low',
    title: "Create Todoist task — 'Send Aaron the pricing memo'",
    payload: "Source: Acme call last week. Due: today.",
    body: "Will appear in Todoist · #Northwind · today",
    why: "Commitment detected in transcript; you have not acted on it for 4 days.",
    flags: [],
  },
  { id: 'p5', type: 'email_send', urgency: 'med',
    title: "Reply to James Park — Tomás offer push",
    to: ['james@northwind.co'], from: 'eleanor@northwind.co',
    subject: 'Re: Quick — can we push the offer for Tomás by a day?',
    body: `Yes, fine. Send me the new version when it is back from legal and I will sign.`,
    why: "James asked a yes/no. Voice match: short, lowercase informality with internal team.",
    flags: [],
  },
];

// ─────────── Recent past meetings / capture ───────────
const MEETINGS = [
  { id: 'mt1', title: "Acme — kickoff call", date: "10 May 2026", attendees: ['Diana Reeves','Aaron Cole','Marcus Aldridge','Eleanor'], duration: "47 min",
    captured: true,
    transcript_excerpt: `…Diana: We can have the cohort numbers to you by Tuesday morning.
Aaron: I will own the deck — I'd like Eleanor's pricing memo by Friday so we can run scenarios.
Eleanor: I will get that to Aaron by end of week.
Marcus: Are we agreed on the 60-day pilot scope? Anyone?…`,
    extracted: [
      { kind: 'commitment', text: "Eleanor will send pricing memo to Aaron by Friday", owner: 'Eleanor', due: '14 May' },
      { kind: 'commitment', text: "Diana will deliver cohort numbers by Tuesday", owner: 'Diana', due: '17 May' },
      { kind: 'decision',   text: "60-day pilot scope agreed in principle, pending Q3 review" },
      { kind: 'followup',   text: "Schedule Q3 partnership review — Aaron to send doodle" },
    ]
  },
  { id: 'mt2', title: "Board prep — Q1 close", date: "06 May 2026", attendees: ['Sarah Chen','Eleanor'], duration: "32 min", captured: true,
    extracted: [
      { kind: 'commitment', text: "Sarah will produce v3 of board deck by Monday", owner: 'Sarah', due: '12 May' },
      { kind: 'decision',   text: "Lead with revenue, not pipeline, on slide 4" },
    ]
  },
  { id: 'mt3', title: "1:1 with Asha", date: "05 May 2026", attendees: ['Asha Murthy','Eleanor'], duration: "28 min", captured: true,
    extracted: [
      { kind: 'commitment', text: "Asha will draft Q3 OKRs by 16 May", owner: 'Asha', due: '16 May' },
      { kind: 'followup',   text: "Eleanor to review and respond by Friday 23 May" },
    ]
  },
];

// ─────────── Weekly recap (W20) ───────────
const RECAP = {
  week: "Week 20 · 11–17 May 2026",
  summary: "A heads-down week. The Series B term sheet moved from open to nearly closed, with the board composition concession the only outstanding bargain. Acme kickoff exceeded the bar set in March; you committed to a pricing memo and have not yet sent it. Eight one-on-ones were held — two with new hires. Your average response time improved by 14% week over week.",
  meetings_held: 17,
  meetings_declined: 4,
  actions_closed: 12,
  actions_open: 7,
  hit_rate: 0.82,
  decisions: [
    "Concede board composition; hold liquidation preference at 1.2x",
    "Lead with revenue on board deck slide 4",
    "Extend Tomás offer with one-day legal delay",
    "60-day pilot scope agreed with Acme pending Q3 review",
  ],
  threads_sent: 41,
  open_carried: [
    "Pricing memo to Aaron (overdue)",
    "Pro-rata side letter to David",
    "Drag-along threshold w/ Marcus",
  ],
};

// ─────────── Insights / trends ───────────
const INSIGHTS = {
  calendar_load: [38, 36, 41, 39, 44, 42, 39, 45, 48, 46, 50, 47],     // hours/wk
  response_time_hours: [9.2, 8.1, 7.4, 6.8, 6.2, 5.5, 5.1, 4.8, 4.3, 3.9, 3.6, 3.4],
  unread_inbox: [148, 162, 134, 121, 119, 102, 88, 81, 73, 64, 57, 51],
};

Object.assign(window, { USER, TODAY, EVENTS, EMAILS, ACTIONS, APPROVALS, MEETINGS, RECAP, INSIGHTS });

// ─────────── Tasks (Todoist + meeting-action source) ───────────
// Mirrors TaskRowDto in ipc-contract: { id, source, content, dueIso, priority,
// projectName, labels, isCompleted, noteId, remoteId, ... }
const TASKS = [
  { id: 't1', source: 'aria',    remoteId: 'td_8801',
    content: "Send Aaron the pricing memo we discussed",
    dueIso: '2026-05-19', priority: 'p1', projectName: 'Northwind · Acme', labels: ['acme','q3-pilot'],
    completed: false, overdue: true, noteId: 'note_acme_kickoff',
    citation: 'Acme — kickoff call · 10 May 2026 · turn 42' },

  { id: 't2', source: 'aria',
    content: "Draft pro-rata side letter for [Maple Capital](https://maplecapital.vc)",
    dueIso: '2026-05-19', priority: 'p1', projectName: null, labels: ['legal'],
    completed: false, noteId: 'note_marcus_email',
    citation: 'Marcus Aldridge · email · today 07:14' },

  { id: 't3', source: 'todoist', remoteId: 'td_8123',
    content: "Review Sarah\u2019s v3 board deck",
    dueIso: '2026-05-19', priority: 'p2', projectName: 'Northwind · Inbox', labels: ['board'],
    completed: false },

  { id: 't4', source: 'todoist', remoteId: 'td_8077',
    content: "Confirm drag-along threshold w/ Marcus",
    dueIso: '2026-05-19', priority: 'p1', projectName: 'Northwind · Inbox', labels: ['series-b','marcus'],
    completed: false },

  { id: 't5', source: 'aria',    remoteId: 'td_8802',
    content: "Get Tomás offer letter back from legal",
    dueIso: '2026-05-20', priority: 'p2', projectName: null, labels: ['hiring'],
    completed: false, owner: 'james',
    citation: 'James Park · email · yesterday 19:45' },

  { id: 't6', source: 'todoist',
    content: "Review engineering Q3 OKRs",
    dueIso: '2026-05-22', priority: 'p3', projectName: 'Northwind · Inbox', labels: ['team'],
    completed: false },

  { id: 't7', source: 'aria',
    content: "Schedule Q3 partnership review with Acme",
    dueIso: null, priority: 'p3', projectName: null, labels: ['acme'],
    completed: false, owner: 'unassigned',
    citation: 'Acme — kickoff call · 10 May 2026 · turn 51' },

  { id: 't8', source: 'todoist', remoteId: 'td_7956',
    content: "Sign Q1 close memo",
    dueIso: '2026-05-12', priority: 'p2', projectName: 'Northwind · Inbox', labels: [],
    completed: true, completedAt: '2026-05-12' },
];

// ─────────── Routing log rows (every LLM call) ───────────
// Mirrors routing_log_v2 from the codebase. `route` is FRONTIER|LOCAL,
// `source` describes what triggered the call.
const ROUTING_LOG = [
  { id: 'r1',  ts: '2026-05-17 07:00:04', route: 'FRONTIER', source: 'briefing',          model: 'anthropic/claude-sonnet-4.5',  sensitivity: 'low',       tokensIn: 14820, tokensOut: 1240, latencyMs: 3140, reason: 'No PII detected · public news + calendar summaries' },
  { id: 'r2',  ts: '2026-05-17 07:00:01', route: 'LOCAL',    source: 'briefing.classify', model: 'llama3.1:8b-instruct',         sensitivity: 'unknown',   tokensIn: 412,   tokensOut: 12,   latencyMs: 220,  reason: 'Sensitivity classifier — pre-routing gate' },
  { id: 'r3',  ts: '2026-05-17 06:58:11', route: 'LOCAL',    source: 'email.triage',      model: 'llama3.1:8b-instruct',         sensitivity: 'financial',tokensIn: 1840,  tokensOut: 38,   latencyMs: 1080, reason: 'Body contains "liquidation preference", "drag-along" — financial · routed local' },
  { id: 'r4',  ts: '2026-05-17 06:58:09', route: 'LOCAL',    source: 'email.triage',      model: 'llama3.1:8b-instruct',         sensitivity: 'normal',    tokensIn: 1210,  tokensOut: 32,   latencyMs: 940,  reason: 'No sensitive entities · 5-signal triage' },
  { id: 'r5',  ts: '2026-05-17 06:58:07', route: 'LOCAL',    source: 'email.triage',      model: 'llama3.1:8b-instruct',         sensitivity: 'hr',        tokensIn: 980,   tokensOut: 30,   latencyMs: 870,  reason: 'Subject contains "offer letter", "Tomás" — HR · routed local' },
  { id: 'r6',  ts: '2026-05-17 06:14:33', route: 'FRONTIER', source: 'drafting.email',    model: 'anthropic/claude-sonnet-4.5',  sensitivity: 'low',       tokensIn: 8240,  tokensOut: 410,  latencyMs: 2810, reason: 'Voice-match draft · no sensitive content · 50 sent-mail exemplars' },
  { id: 'r7',  ts: '2026-05-17 06:14:30', route: 'LOCAL',    source: 'drafting.classify', model: 'llama3.1:8b-instruct',         sensitivity: 'unknown',   tokensIn: 510,   tokensOut: 14,   latencyMs: 240,  reason: 'Sensitivity classifier — pre-drafting gate' },
  { id: 'r8',  ts: '2026-05-16 22:18:42', route: 'LOCAL',    source: 'rag.ask',           model: 'llama3.1:8b-instruct',         sensitivity: 'normal',    tokensIn: 3120,  tokensOut: 220,  latencyMs: 1860, reason: 'PII present (employee names) — routed local per L-04-03' },
  { id: 'r9',  ts: '2026-05-16 17:02:00', route: 'LOCAL',    source: 'transcript.extract',model: 'llama3.1:8b-instruct',         sensitivity: 'normal',    tokensIn: 6810,  tokensOut: 380,  latencyMs: 4200, reason: 'Meeting transcript · structured-output mode · stays local' },
  { id: 'r10', ts: '2026-05-16 12:34:18', route: 'FRONTIER', source: 'scheduling.parse',  model: 'anthropic/claude-sonnet-4.5',  sensitivity: 'low',       tokensIn: 920,   tokensOut: 110,  latencyMs: 1180, reason: 'NL intent parser · no PII · public event metadata' },
];

// ─────────── Scheduling rules ───────────
const SCHEDULING_RULES = {
  timeZone: 'America/New_York',
  primeTime: [
    { day: 'all', start: '10:00', end: '12:30', label: 'Deep work · mornings' },
  ],
  noMeeting: [
    { day: 'all', start: '16:00', end: '18:00', label: 'School pickup window' },
    { day: 'fri', start: '14:00', end: '23:59', label: 'Friday afternoons clear' },
  ],
  focusBlocks: [
    { day: 'tue', start: '08:30', end: '09:00', label: 'Series B deck' },
    { day: 'thu', start: '13:00', end: '14:30', label: 'Board deck' },
  ],
  bufferMin: 10,
  maxBackToBack: 3,
  preferredLengths: { '1:1': 30, 'team': 45, 'external': 60 },
};

// ─────────── RAG index status ───────────
const RAG_INDEX = {
  vectorBackend: 'sqlite-vec',         // | 'fallback'
  modelId: 'nomic-embed-text:v1.5',
  dim: 768,
  aliveChunkCount: 41820,
  pendingChunkCount: 0,
  estimatedBytes: 41820 * 4096,
  rebuildInProgress: false,
  lastIndexedAt: '2026-05-17 06:58:00',
  backfill: { state: 'idle', remaining: 0, total: 41820, etaSec: 0 },
};

// ─────────── Transcripts ───────────
// Mirrors TranscriptNoteDto: { id, title, sourceKind, body, extracted, citationSpans }
const TRANSCRIPTS = [
  { id: 'tx1', title: 'Acme — kickoff call', date: '10 May 2026', sourceKind: 'paste',
    attendees: ['Diana Reeves','Aaron Cole','Marcus Aldridge','Eleanor'],
    bodyChunks: [
      { spk: 'Diana',   text: "We can have the cohort numbers to you by Tuesday morning.", cite: '12-19' },
      { spk: 'Aaron',   text: "I will own the deck — I'd like Eleanor's pricing memo by Friday so we can run scenarios.", cite: '24-33' },
      { spk: 'Eleanor', text: "I will get that to Aaron by end of week.", cite: '34-37' },
      { spk: 'Marcus',  text: "Are we agreed on the 60-day pilot scope? Anyone object?", cite: '42-46' },
      { spk: 'Diana',   text: "60 days works — pending Q3 review.", cite: '47-49' },
      { spk: 'Aaron',   text: "I'll send a doodle for the Q3 review next week.", cite: '50-52' },
    ],
    extracted: [
      { id: 'x1', kind: 'commitment', owner: 'self',       text: "Send Aaron the pricing memo by Friday",            dueRaw: 'by Friday', dueIso: '2026-05-15', priorityHint: 'p1', cite: '34-37' },
      { id: 'x2', kind: 'commitment', owner: 'follow-up',  followUpWith: 'Diana Reeves',
                                                            text: "Diana to deliver cohort numbers by Tuesday",      dueRaw: 'by Tuesday', dueIso: '2026-05-17', priorityHint: 'p2', cite: '12-19' },
      { id: 'x3', kind: 'decision',                         text: "60-day pilot scope agreed in principle",                                                                          cite: '42-49' },
      { id: 'x4', kind: 'commitment', owner: 'follow-up',  followUpWith: 'Aaron Cole',
                                                            text: "Aaron to send doodle for Q3 partnership review",   dueRaw: 'next week', dueIso: '2026-05-22', priorityHint: 'p3', cite: '50-52' },
      { id: 'x5', kind: 'commitment', owner: 'unassigned',  text: "Pull benchmark numbers from prior pilots",                                                                          cite: '38-41' },
    ],
  },
  { id: 'tx2', title: 'Board prep — Q1 close', date: '06 May 2026', sourceKind: 'vtt',
    attendees: ['Sarah Chen','Eleanor'],
    bodyChunks: [
      { spk: 'Sarah',   text: "I'll produce v3 of the board deck by Monday.", cite: '8-12' },
      { spk: 'Eleanor', text: "Lead with revenue on slide 4, not pipeline.",  cite: '14-17' },
    ],
    extracted: [
      { id: 'y1', kind: 'commitment', owner: 'follow-up', followUpWith: 'Sarah Chen',
                                       text: "Sarah to produce v3 of board deck by Monday", dueRaw: 'by Monday', dueIso: '2026-05-12', priorityHint: 'p1', cite: '8-12' },
      { id: 'y2', kind: 'decision',     text: "Lead with revenue on slide 4, not pipeline", cite: '14-17' },
    ],
  },
];

// ─────────── Ask-Aria threads ───────────
const ASK_THREADS = [
  { id: 'th1', title: "Q3 commitments to Acme",  updatedAt: 'Today 09:12',
    turns: [
      { id: 'u1', role: 'user',      text: "What did we commit to Acme this quarter?" },
      { id: 'a1', role: 'assistant', text: "Across the Acme kickoff (10 May) and the email thread with Diana, you committed to (1) sending Aaron a pricing memo by Friday — currently overdue by 2 days — and (2) agreeing in principle to a 60-day pilot scope, pending the Q3 partnership review. Diana committed to cohort numbers by Tuesday 17 May; she delivered them at 06:42 this morning.",
        route: 'LOCAL', model: 'llama3.1:8b', sensitivity: 'normal',
        cites: [
          { kind: 'meeting', label: 'Acme — kickoff call · 10 May 2026', span: 'turn 24-37' },
          { kind: 'email',   label: 'Diana Reeves · tomorrow\u2019s review', span: 'today 06:42' },
        ],
      },
    ],
  },
  { id: 'th2', title: "When did I last talk to David Yoo?", updatedAt: 'Yesterday',
    turns: [
      { id: 'u2', role: 'user',      text: "When did I last talk to David Yoo?" },
      { id: 'a2', role: 'assistant', text: "David sent you a lunch confirmation today at 08:01 (moved to 12:15). Before that, your last live conversation was 02 May at 14:00 (\u201cMaple — wire confirmation\u201d). No voice or video calls are indexed.",
        route: 'LOCAL', model: 'llama3.1:8b', sensitivity: 'normal',
        cites: [
          { kind: 'email',    label: 'David Yoo · Lunch today \u2014 moving to 12:15', span: 'today 08:01' },
          { kind: 'calendar', label: 'Maple \u2014 wire confirmation', span: '02 May 14:00' },
        ],
      },
    ],
  },
  { id: 'th3', title: "Open items from board prep", updatedAt: 'Mon',
    turns: [],
  },
];

// ─────────── Provider accounts (multi-account fan-out) ───────────
const PROVIDER_ACCOUNTS = [
  { id: 'g1', providerKey: 'google',    accountId: 'eleanor@northwind.co',    displayEmail: 'eleanor@northwind.co',    label: 'Work',     color: '#B8860B', connected: true,  lastSync: '09:34' },
  { id: 'g2', providerKey: 'google',    accountId: 'eleanor.vance@gmail.com', displayEmail: 'eleanor.vance@gmail.com', label: 'Personal', color: '#5B6E3A', connected: true,  lastSync: '09:31' },
  { id: 'm1', providerKey: 'microsoft', accountId: 'evance@board.northwind.co', displayEmail: 'evance@board.northwind.co', label: 'Board',  color: '#1F3A5F', connected: true,  lastSync: '09:28' },
];

// ─────────── Approval queue v2 ───────────
// Real shape from ApprovalRowDto: kind ∈ email_send | calendar_change | task_batch.
// Replace the legacy APPROVALS_V1 with the richer model used by the screen.
const APPROVALS_V2 = [
  // email_send · ready · explicit-required (financial)
  { id: 'ap1', kind: 'email_send', state: 'ready', severity: 'high',
    accountId: 'g1', subject: "Re: Term sheet — final language on liquidation preference",
    recipients: ['marcus@aldridgeco.com'],
    categories: ['financial','legal'],
    triage: { priority: 'urgent', signals: ['board-member','closing-this-week','question-asked'], summary: "Marcus asked direct questions on drag-along threshold and side-letter; he gave you a 4–5 PM slot to call." },
    rationale: "Severity HIGH due to financial language (\u201cliquidation preference\u201d, \u201cdrag-along\u201d) — silent approve disabled per APPR-07.",
    routed: 'FRONTIER · claude-sonnet-4.5',
    bodyOriginal: "Marcus,\n\nThanks — agreed on 1.2x and the 7-year sunset (5 yrs is fine). I will concede board composition.\n\nFor drag, hold at 60% — I want headroom in case we add a strategic later.\n\nI will get the Maple side letter drafted and over to David this afternoon.\n\n4pm works. I'll send an invite.\n\n— E",
    bodyEdited: null,
    voiceBeta: false, sourceMessageId: 'm1',
  },

  // email_send · ready · auto-approve eligible
  { id: 'ap2', kind: 'email_send', state: 'ready', severity: 'low',
    accountId: 'g1', subject: "Re: Lunch today — moving to 12:15 if okay",
    recipients: ['david@maplecapital.vc'],
    categories: [],
    triage: { priority: 'urgent', signals: ['today','question-asked'], summary: "David moved your 12:00 lunch to 12:15 — yes/no confirmation." },
    rationale: "Severity LOW · 8 words · matches AUTO_SMALL trust tier.",
    routed: 'FRONTIER · claude-sonnet-4.5',
    bodyOriginal: "12:15 works. See you there.\n\n— E",
    bodyEdited: null,
    voiceBeta: false, sourceMessageId: 'm3',
  },

  // calendar_change · ready · soft conflict
  { id: 'ap3', kind: 'calendar_change', state: 'ready', severity: 'med',
    accountId: 'g1', subject: "Move 'Acme review' to Thursday 10:30",
    calendarAction: 'reschedule',
    before: { summary: 'Acme — Q3 partnership review', startUtc: '2026-05-17T14:30:00Z', endUtc: '2026-05-17T15:30:00Z',
              attendees: [{email:'d.reeves@acmeworks.com'},{email:'aaron@acmeworks.com'},{email:'marcus@aldridgeco.com'}], isRecurring: false },
    after:  { startUtc: '2026-05-19T14:30:00Z', endUtc: '2026-05-19T15:30:00Z' },
    conflicts: [
      { type: 'prime-time', severity: 'soft', label: 'Outside prime-time window (10:00–12:30)' },
    ],
    alternatives: [
      { startUtc: '2026-05-19T14:30:00Z', endUtc: '2026-05-19T15:30:00Z', score: 0.91, primeTimeMatched: false },
      { startUtc: '2026-05-20T15:00:00Z', endUtc: '2026-05-20T16:00:00Z', score: 0.88, primeTimeMatched: false },
      { startUtc: '2026-05-21T11:00:00Z', endUtc: '2026-05-21T12:00:00Z', score: 0.96, primeTimeMatched: true  },
    ],
    rationale: "From scheduling chat: \u201cmove acme to thursday\u201d · external attendees · proposed change emails all 3.",
  },

  // task_batch · ready · meeting-action push to Todoist
  { id: 'ap4', kind: 'task_batch', state: 'ready', severity: 'low',
    accountId: 'g1', subject: "5 meeting actions from \u201cAcme — kickoff call\u201d",
    actions: [
      { id: 'x1', text: "Send Aaron the pricing memo by Friday",            owner: 'self',       dueIso: '2026-05-15', priorityHint: 'p1', cite: '34-37' },
      { id: 'x2', text: "Diana to deliver cohort numbers by Tuesday",       owner: 'follow-up',  followUpWith: 'Diana Reeves', dueIso: '2026-05-17', priorityHint: 'p2', cite: '12-19' },
      { id: 'x4', text: "Aaron to send doodle for Q3 partnership review",   owner: 'follow-up',  followUpWith: 'Aaron Cole',  dueIso: '2026-05-22', priorityHint: 'p3', cite: '50-52' },
      { id: 'x5', text: "Pull benchmark numbers from prior pilots",         owner: 'unassigned', cite: '38-41' },
    ],
    rationale: "Will push 3 selected actions to Todoist project \u201cNorthwind \u00b7 Acme\u201d. Unassigned actions need an owner before push.",
  },

  // email_send · interrupted · regenerate
  { id: 'ap5', kind: 'email_send', state: 'interrupted', severity: 'med',
    accountId: 'g1', subject: "Re: Quick — can we push the offer for Tomás by a day?",
    recipients: ['james@northwind.co'],
    categories: ['hr'],
    triage: { priority: 'action', signals: ['cofounder','hiring'], summary: "James asked yes/no on a one-day legal delay for Tomás\u2019 offer letter." },
    rationale: "Severity MED · HR category · silent approve disabled. Generation interrupted (app suspended); regenerate to continue.",
    routed: 'LOCAL · llama3.1:8b',
    bodyOriginal: null,
    bodyEdited:   null,
    voiceBeta: true,
    sourceMessageId: 'm5',
  },

  // email_send · snoozed
  { id: 'ap6', kind: 'email_send', state: 'snoozed', severity: 'low',
    accountId: 'g2', subject: "Re: Save the date — Founders dinner, 12 June",
    recipients: ['holly@graceful.events'],
    categories: [],
    triage: { priority: 'fyi', signals: ['networking'], summary: "Holly\u2019s save-the-date — declining politely; no immediate deadline." },
    rationale: "Snoozed for 1h by you · re-surfaces at 10:34.",
    routed: 'FRONTIER · claude-sonnet-4.5',
    bodyOriginal: "Holly — flattered to be on the list. Travel that week, will have to pass. Hope it goes well.\n\n— E",
    bodyEdited: null,
    voiceBeta: false,
    sourceMessageId: 'm8',
  },
];

Object.assign(window, {
  TASKS,
  ROUTING_LOG,
  SCHEDULING_RULES,
  RAG_INDEX,
  TRANSCRIPTS,
  ASK_THREADS,
  PROVIDER_ACCOUNTS,
  APPROVALS_V2,
});

// ─────────── Entitlement (Plan 08.1) ───────────
const ENTITLEMENT_STATES = {
  'trial-active-quiet':  { kind: 'trial-active-quiet', daysRemaining: 47, trialExpiresAt: '2026-07-06' },
  'trial-active-day50':  { kind: 'trial-active-day50', daysRemaining: 10, trialExpiresAt: '2026-05-27' },
  'trial-active-day55':  { kind: 'trial-active-day55', daysRemaining: 5,  trialExpiresAt: '2026-05-22' },
  'trial-active-day59':  { kind: 'trial-active-day59', daysRemaining: 1,  trialExpiresAt: '2026-05-18' },
  'trial-expired-grace': { kind: 'trial-expired-grace', trialExpiresAt: '2026-05-15', hoursOfGraceRemaining: 38 },
  'trial-locked':        { kind: 'trial-locked',        trialExpiresAt: '2026-05-10' },
  'pro-active':          { kind: 'pro-active',          subscriptionUntil: '2027-05-17' },
  'pro-grace':           { kind: 'pro-grace',           lastVerifiedAt: '2026-05-09', daysUntilLock: 4 },
  'pro-locked':          { kind: 'pro-locked',          lastVerifiedAt: '2026-05-03' },
  'clock-skew-warn':     { kind: 'clock-skew-warn',     skewDays: 92, underlyingState: { kind: 'pro-active', subscriptionUntil: '2027-05-17' } },
};

// ─────────── Weekly recaps (Plan 08-02) ───────────
const RECAPS = [
  {
    id: 'rc1',
    isoWeek: '2026-W20',
    weekStartYmd: '2026-05-11',
    label: 'Week of 11\u201317 May 2026',
    finalizedAt: null,
    canonical: {
      meetings: { heading: 'Meetings', blocks: [
        { kind: 'bullet_list', items: [
          "Acme \u2014 kickoff call (10 May, 47 min) \u2014 agreed on 60-day pilot scope; Diana to deliver cohort numbers Tuesday.",
          "Board prep w/ Sarah Chen (06 May, 32 min) \u2014 locked v3 of the deck; lead with revenue on slide 4.",
          "1:1 with Asha Murthy (05 May, 28 min) \u2014 Q3 OKR draft inbound by 16 May.",
          "Maple Capital \u2014 wire confirmation (02 May, 15 min) \u2014 pro-rata side letter committed.",
        ]},
      ]},
      actions: { heading: 'Commitments', blocks: [
        { kind: 'paragraph', text: "Twelve commitments closed, three carried into next week. Hit rate 82% on time \u2014 best week since W14." },
        { kind: 'bullet_list', items: [
          "Closed \u00b7 Series B term sheet: concede board composition, hold 1.2x non-participating",
          "Closed \u00b7 Sign Q1 close memo (Sarah)",
          "Open  \u00b7 Pricing memo to Aaron (overdue 2 days)",
          "Open  \u00b7 Pro-rata side letter to David Yoo",
          "Open  \u00b7 Drag-along threshold with Marcus",
        ]},
      ]},
      wins: { heading: 'Wins & decisions', blocks: [
        { kind: 'bullet_list', items: [
          "Decided: Concede board composition; hold liquidation preference at 1.2x.",
          "Decided: Lead with revenue on board deck slide 4.",
          "Decided: Extend Tom\u00e1s offer with one-day legal delay.",
          "Won: Acme leadership aligned on 60-day pilot scope.",
        ]},
      ]},
      upcoming: { heading: 'Upcoming \u00b7 next week', blocks: [
        { kind: 'bullet_list', items: [
          "Tue \u00b7 Acme Q3 partnership review",
          "Wed \u00b7 Board: comp committee",
          "Fri \u00b7 Tom\u00e1s offer call",
          "Watch \u00b7 Maple pro-rata side letter (David is waiting)",
        ]},
      ]},
      whatAriaDid: {
        heading: 'What Aria did this week',
        narrative: "A quiet week of execution. Aria drafted 14 replies in your voice (you approved 12, edited 2 lightly, rejected none). Two relationship alerts surfaced and were cleared; a third was held back pending your call. Three calendar moves went through the approval queue \u2014 all self-only, no external attendees touched.",
        blocks: [
          { kind: 'bullet_list', items: [
            "14 May 09:12 \u00b7 Drafted reply to Marcus Aldridge (term sheet) \u00b7 Anthropic claude-sonnet \u00b7 approved",
            "14 May 11:48 \u00b7 Drafted reply to David Yoo (lunch) \u00b7 Anthropic claude-sonnet \u00b7 approved (silent \u00b7 AUTO_SMALL)",
            "13 May 17:30 \u00b7 Proposed move: Investor catch-up \u2192 Wed 11:00 \u00b7 LOCAL llama3.1:8b \u00b7 approved",
            "12 May 09:00 \u00b7 Triaged 47 emails \u00b7 LOCAL llama3.1:8b",
            "11 May 16:42 \u00b7 Extracted 5 actions from Acme kickoff transcript \u00b7 LOCAL llama3.1:8b",
            "11 May 09:00 \u00b7 Generated daily briefing \u00b7 Anthropic claude-sonnet \u00b7 viewed 09:14",
          ]},
        ],
      },
    },
  },
  {
    id: 'rc2', isoWeek: '2026-W19', weekStartYmd: '2026-05-04', label: 'Week of 04\u201310 May 2026', finalizedAt: '2026-05-11 09:00',
    canonical: {
      meetings: { heading: 'Meetings', blocks: [{ kind: 'paragraph', text: "Fourteen meetings, average 38 minutes. Most-attended thread: Acme partnership." }] },
      actions:  { heading: 'Commitments', blocks: [{ kind: 'paragraph', text: "10 of 11 commitments hit on time." }] },
      wins:     { heading: 'Wins & decisions', blocks: [{ kind: 'bullet_list', items: ["Series B narrative locked","Acme kickoff exceeded benchmark"] }] },
      upcoming: { heading: 'Upcoming \u00b7 next week', blocks: [] },
      whatAriaDid: { heading: 'What Aria did this week', narrative: "Steady drafting week. 11 replies approved, 1 edited.", blocks: [] },
    },
  },
  {
    id: 'rc3', isoWeek: '2026-W18', weekStartYmd: '2026-04-27', label: 'Week of 27 Apr \u2013 3 May', finalizedAt: '2026-05-04 09:00',
    canonical: {
      meetings: { heading: 'Meetings', blocks: [] },
      actions:  { heading: 'Commitments', blocks: [] },
      wins:     { heading: 'Wins & decisions', blocks: [{ kind: 'bullet_list', items: ["Closed seed extension"] }] },
      upcoming: { heading: 'Upcoming \u00b7 next week', blocks: [] },
      whatAriaDid: { heading: 'What Aria did this week', narrative: "First week of voice profile training \u2014 9 approved, 4 edited.", blocks: [] },
    },
  },
];

// ─────────── Insights (Plan 08-01) ───────────
const INSIGHTS_V2 = {
  state: 'unlocked',
  daysRemaining: 0,
  blockedKinds: [],
  rows: [
    { id: 'i1', kind: 'calendar_load', sentences: [
      "You averaged 39 meeting hours this week, down from 47 the week before.",
      "Mondays remain heaviest (9.5 h); Fridays are protected on average (3.1 h).",
    ]},
    { id: 'i2', kind: 'response_time', sentences: [
      "Median first-response time was 3.4 hours, down from 4.8 in W19.",
      "Two threads aged past 24h before you replied \u2014 both from Marcus.",
    ]},
    { id: 'i3', kind: 'recurring_themes', sentences: [
      "\u201cSeries B\u201d, \u201cAcme\u201d, and \u201cboard deck\u201d dominated drafts and meetings (61% of mentions).",
      "\u201cTom\u00e1s offer\u201d emerged as a new theme this week (8 mentions).",
    ]},
    { id: 'i4', kind: 'approval_edits', sentences: [
      "Of 14 drafts, you edited 2 \u2014 both adjusted the closing line.",
      "Voice profile is learning a slightly warmer sign-off pattern with internal team.",
    ]},
  ],
};

// ─────────── Learned preferences (Plan 08-03) ───────────
const LEARNED_PREFS = {
  preferences: {
    voice: { terseness: 0.78, formality: 'mixed', preferredSignoff: '\u2014 E', capitalizeOpenings: false },
    briefing: { sectionOrder: ['calendar','email','open-actions','news'], showNews: true },
    scheduling: { preferredMeetingLength: { '1:1': 30, 'team': 45, 'external': 60 } },
    triage: { vipDomains: ['aldridgeco.com','maplecapital.vc','northwind.co'] },
  },
  signalsCount: 1247,
  lastUpdatedAt: '2026-05-17 06:14',
};

const LEARNING_SIGNALS = [
  { id: 'ls1', occurredAt: '2026-05-17 06:14', source: 'drafting',   kind: 'voice/edit_trim',        payload: { from_words: 32, to_words: 21, kept_signoff: true } },
  { id: 'ls2', occurredAt: '2026-05-16 22:14', source: 'briefing',   kind: 'feedback/thumb_up',      payload: { section: 'open-actions' } },
  { id: 'ls3', occurredAt: '2026-05-16 22:13', source: 'briefing',   kind: 'feedback/thumb_down',    payload: { section: 'news' } },
  { id: 'ls4', occurredAt: '2026-05-16 17:08', source: 'approvals',  kind: 'edit_before_approve',    payload: { kind: 'email_send', changed: 'body', diff_chars: 18 } },
  { id: 'ls5', occurredAt: '2026-05-16 09:42', source: 'scheduling', kind: 'override/no-meeting',    payload: { reason: 'one-time exception \u00b7 investor in town' } },
  { id: 'ls6', occurredAt: '2026-05-15 11:30', source: 'triage',     kind: 'reclassify',             payload: { from: 'ACTION', to: 'URGENT', sender_domain: 'aldridgeco.com' } },
  { id: 'ls7', occurredAt: '2026-05-14 15:02', source: 'drafting',   kind: 'voice/reject',           payload: { reason: 'too formal' } },
];

// ─────────── Updates (Plan 08-04) ───────────
const UPDATES = {
  channel: 'tester',
  currentVersion: '0.8.1',
  availableVersion: '0.9.0',
  releaseDate: '2026-05-16',
  notes: [
    "Weekly Recap export to DOCX + PDF (Plan 08-02)",
    "Per-section briefing feedback chips (Plan 08-03)",
    "Insights: calendar load \u00b7 response time \u00b7 recurring themes \u00b7 draft-edit pattern (Plan 08-01)",
    "60-day trial + Stripe activation flow (Plan 08.1-03)",
    "Auto-updater on the tester channel via electron-updater (Plan 08-04)",
  ],
};

Object.assign(window, {
  ENTITLEMENT_STATES,
  RECAPS,
  INSIGHTS_V2,
  LEARNED_PREFS,
  LEARNING_SIGNALS,
  UPDATES,
});
