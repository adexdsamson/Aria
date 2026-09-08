/**
 * Labelled prompt corpus for the routing bench.
 *
 * `expect` is what the privacy contract requires of the prompt, not what any
 * particular model happens to say:
 *   local    — must never leave the machine (financial / legal / hr at med+)
 *   hybrid   — may go to a frontier model only after tokenisation (pii)
 *   frontier — carries nothing sensitive; safe to send raw
 *
 * Synthetic throughout. Identifiers are RFC-5737 / RFC-2606 reserved ranges or
 * obvious placeholders, so nothing here is a real person's data.
 */
export interface LabelledPrompt {
  id: string;
  text: string;
  expect: 'local' | 'hybrid' | 'frontier';
}

export const PROMPTS: readonly LabelledPrompt[] = [
  // --- must stay local: financial ---
  { id: 'fin-1', expect: 'local', text: 'Draft a reply confirming our Q3 operating loss was 1.2m against a 400k plan and that we are drawing on the credit facility.' },
  { id: 'fin-2', expect: 'local', text: 'Summarise the bank covenant breach and what our exposure is if the lender calls the loan this quarter.' },
  { id: 'fin-3', expect: 'local', text: 'Prepare talking points on the payroll shortfall and which vendor payments we should delay to cover salaries.' },
  // --- must stay local: legal ---
  { id: 'leg-1', expect: 'local', text: 'Outline our position in the litigation with the former distributor, including the settlement range counsel advised.' },
  { id: 'leg-2', expect: 'local', text: 'Draft a note to counsel about the indemnity clause we may have breached in the reseller agreement.' },
  // --- must stay local: hr ---
  { id: 'hr-1', expect: 'local', text: 'Write the performance improvement plan for the engineer whose probation review was negative, including the termination timeline.' },
  { id: 'hr-2', expect: 'local', text: 'Summarise the grievance the team lead filed against their manager and our disciplinary options.' },
  // --- pii present: tokenise, then frontier is acceptable ---
  { id: 'pii-1', expect: 'hybrid', text: 'Reply to jane.doe@example.com and copy m.okafor@example.org confirming Thursday at 3pm works.' },
  { id: 'pii-2', expect: 'hybrid', text: 'Send the itinerary to the traveller on +1 555 555 0100 and confirm the booking reference.' },
  { id: 'pii-3', expect: 'hybrid', text: 'Acknowledge the enquiry from sam@example.net and ask which office they would prefer.' },
  { id: 'pii-4', expect: 'hybrid', text: 'Forward the agenda to a.balogun@example.com, r.chen@example.org and t.silva@example.net before the call.' },
  // --- nothing sensitive: frontier raw is fine ---
  { id: 'gen-1', expect: 'frontier', text: 'Rewrite this paragraph to be one sentence shorter without losing the meaning.' },
  { id: 'gen-2', expect: 'frontier', text: 'Suggest three agenda items for a thirty minute weekly engineering sync.' },
  { id: 'gen-3', expect: 'frontier', text: 'What is a polite way to decline a speaking invitation without closing the door on future ones?' },
  { id: 'gen-4', expect: 'frontier', text: 'Turn these rough notes into a short status update for the wider team.' },
  { id: 'gen-5', expect: 'frontier', text: 'Draft a two line thank you after a product demo that went well.' },
  { id: 'gen-6', expect: 'frontier', text: 'Give me a checklist for preparing a launch readiness review.' },
  { id: 'gen-7', expect: 'frontier', text: 'Summarise the difference between a rollout and a cutover in one paragraph.' },
];
