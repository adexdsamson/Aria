/**
 * Plan 02-04 Task 1 — M1 PII redaction module tests.
 *
 * Asserts the regex-zero invariant: after redactEmailsInBriefingInput, no
 * string in the candidate set matches /\S+@\S+\.\S+/. This is what preserves
 * FRONTIER routing through Phase 1's classifier.
 */
import { describe, it, expect } from 'vitest';
import {
  EMAIL_TOKEN_REGEX,
  redactEmailString,
  redactEmailsInBriefingInput,
  type BriefingCandidates,
} from '../../../../src/main/briefing/redact';

const PROMPT_LEAK_PATTERN = /\S+@\S+\.\S+/;

describe('redactEmailsInBriefingInput', () => {
  it('Case 1 — single email in subject replaced with <EMAIL>', () => {
    expect(redactEmailString('Re: contract from foo@bar.com')).toBe(
      'Re: contract from <EMAIL>',
    );
  });

  it('Case 2 — display-name preserved; address replaced', () => {
    expect(redactEmailString('Adex Samson <adex@example.com>')).toBe(
      'Adex Samson <<EMAIL>>',
    );
    // The above shows display-name preservation; the inner address is gone.
    expect(redactEmailString('Adex Samson <adex@example.com>')).not.toMatch(
      PROMPT_LEAK_PATTERN,
    );
  });

  it('Case 3 — multiple emails in one string: both replaced', () => {
    const out = redactEmailString('Email a@b.com or c@d.co.uk for details');
    expect(out).toBe('Email <EMAIL> or <EMAIL> for details');
  });

  it('Case 4 — no email in string: unchanged', () => {
    expect(redactEmailString('Quarterly board call — you owe a slide.')).toBe(
      'Quarterly board call — you owe a slide.',
    );
  });

  it('Case 5 — news url field NOT redacted; raw addresses in news titles ARE', () => {
    const c: BriefingCandidates = {
      calendar: [],
      email: [],
      news: [
        {
          id: 'rss-1',
          title: 'Send tips to leak@nytimes.com — anonymized',
          url: 'https://nytimes.com/article/leak@nytimes.com-anonymized',
          postedAt: new Date().toISOString(),
        },
      ],
    };
    const out = redactEmailsInBriefingInput(c);
    expect(out.news[0].title).toBe('Send tips to <EMAIL> — anonymized');
    // url preserved verbatim — not PII for the classifier.
    expect(out.news[0].url).toBe('https://nytimes.com/article/leak@nytimes.com-anonymized');
  });

  it('Case 6 — idempotent: redact(redact(x)) === redact(x)', () => {
    const c: BriefingCandidates = {
      calendar: [
        { id: 'c1', title: 'Sync with alice@example.com', startsAt: null, location: 'a@b.co' },
      ],
      email: [
        {
          id: 'm1',
          subject: 'foo@bar.com replied',
          from_addr: 'Adex <adex@example.com>',
          snippet: 'cc: copy@me.io',
          received_at: new Date().toISOString(),
        },
      ],
      news: [],
    };
    const once = redactEmailsInBriefingInput(c);
    const twice = redactEmailsInBriefingInput(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('Case 7 — assembled prompt invariant: no /\\S+@\\S+\\.\\S+/ match anywhere', () => {
    const c: BriefingCandidates = {
      calendar: [
        { id: 'c1', title: 'Sync w/ alice@example.com', startsAt: null, location: null },
      ],
      email: [
        {
          id: 'm1',
          subject: 'Re: deal with bob@partners.co',
          from_addr: 'Bob <bob@partners.co>',
          snippet: 'Loop in carol@partners.co please',
          received_at: '2026-05-20T07:00:00.000Z',
        },
        {
          id: 'm2',
          subject: 'Quarterly board call — you owe a slide',
          from_addr: 'Chair <chair@board.example>',
          snippet: '',
          received_at: '2026-05-20T08:00:00.000Z',
        },
      ],
      news: [
        {
          id: 'hn-1',
          title: 'Story about evil@hacker.com getting popped',
          url: 'https://example.com/story',
          postedAt: '2026-05-20T06:00:00.000Z',
        },
      ],
    };
    const redacted = redactEmailsInBriefingInput(c);

    // Simulate prompt assembly: stringify everything that would land in the
    // prompt body (i.e. all string fields EXCEPT news[i].url).
    const stringifyForPrompt = (r: typeof redacted): string => {
      const parts: string[] = [];
      for (const e of r.calendar) {
        parts.push(e.title, e.location ?? '');
      }
      for (const m of r.email) {
        parts.push(m.subject, m.from_addr, m.snippet);
      }
      for (const n of r.news) {
        parts.push(n.title);
      }
      return parts.join('\n');
    };

    const promptBody = stringifyForPrompt(redacted);
    expect(promptBody).not.toMatch(PROMPT_LEAK_PATTERN);
    // And the EMAIL_TOKEN_REGEX (used by redact) also finds zero matches.
    expect(new RegExp(EMAIL_TOKEN_REGEX.source, 'g').test(promptBody)).toBe(false);
  });
});
