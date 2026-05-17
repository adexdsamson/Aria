/**
 * Plan 02-04 Task 1 — M1 PII redaction module tests.
 *
 * Asserts the regex-zero invariant: after redactPiiInBriefingInput, no
 * string in the candidate set matches /\S+@\S+\.\S+/. This is what preserves
 * FRONTIER routing through Phase 1's classifier.
 */
import { describe, it, expect } from 'vitest';
import {
  EMAIL_TOKEN_REGEX,
  redactAllPii,
  redactPiiInBriefingInput,
  type BriefingCandidates,
} from '../../../../src/main/briefing/redact';
import { classifySensitivity } from '../../../../src/main/llm/classifier';

const PROMPT_LEAK_PATTERN = /\S+@\S+\.\S+/;

describe('redactPiiInBriefingInput', () => {
  it('Case 1 — single email in subject replaced with <EMAIL>', () => {
    expect(redactAllPii('Re: contract from foo@bar.com')).toBe(
      'Re: contract from <EMAIL>',
    );
  });

  it('Case 2 — display-name preserved; address replaced', () => {
    expect(redactAllPii('Adex Samson <adex@example.com>')).toBe(
      'Adex Samson <<EMAIL>>',
    );
    // The above shows display-name preservation; the inner address is gone.
    expect(redactAllPii('Adex Samson <adex@example.com>')).not.toMatch(
      PROMPT_LEAK_PATTERN,
    );
  });

  it('Case 3 — multiple emails in one string: both replaced', () => {
    const out = redactAllPii('Email a@b.com or c@d.co.uk for details');
    expect(out).toBe('Email <EMAIL> or <EMAIL> for details');
  });

  it('Case 4 — no email in string: unchanged', () => {
    expect(redactAllPii('Quarterly board call — you owe a slide.')).toBe(
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
    const out = redactPiiInBriefingInput(c);
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
    const once = redactPiiInBriefingInput(c);
    const twice = redactPiiInBriefingInput(once);
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
    const redacted = redactPiiInBriefingInput(c);

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

describe('redactAllPii — UAT Gap 9 (full PII pattern set)', () => {
  it('email pattern → <EMAIL>', () => {
    expect(redactAllPii('mail foo@bar.com please')).toBe('mail <EMAIL> please');
  });

  it('phone pattern → <PHONE> (covers meeting IDs / dial-ins)', () => {
    // 10-digit NANP-ish — the classifier hits this and so should the redactor.
    expect(redactAllPii('Zoom dial-in: 415-555-1234 PIN 9999')).toBe(
      'Zoom dial-in: <PHONE> PIN 9999',
    );
  });

  it('SSN pattern → <SSN>', () => {
    expect(redactAllPii('SSN on file 123-45-6789')).toBe('SSN on file <SSN>');
  });

  it('currency pattern → <AMOUNT>', () => {
    expect(redactAllPii('Invoice for $1,234.56 due Friday')).toBe(
      'Invoice for <AMOUNT> due Friday',
    );
    expect(redactAllPii('paid $50')).toBe('paid <AMOUNT>');
  });

  it('currency with magnitude suffix → <AMOUNT> (K/M/B/T, case-insensitive)', () => {
    // The reason this test exists: previously `$50M Series B` redacted to
    // `<AMOUNT>M Series B`, leaving a stray `M` next to the placeholder.
    // Harmless for the classifier invariant (no `$<digits>` remained) but ugly
    // in any debug surface that renders the redacted prompt body.
    expect(redactAllPii('Acme raises $50M Series B')).toBe(
      'Acme raises <AMOUNT> Series B',
    );
    expect(redactAllPii('Valuation hit $1.2B last quarter')).toBe(
      'Valuation hit <AMOUNT> last quarter',
    );
    expect(redactAllPii('seed round $300k closed')).toBe(
      'seed round <AMOUNT> closed',
    );
    expect(redactAllPii('national debt $30T projection')).toBe(
      'national debt <AMOUNT> projection',
    );
  });

  it('Bearer token → <BEARER>', () => {
    expect(redactAllPii('Authorization: Bearer ya29.A0ARrdaM_abcDEF-123')).toBe(
      'Authorization: <BEARER>',
    );
  });

  it('OAuth code= → <OAUTH_CODE>', () => {
    expect(redactAllPii('redirect /?code=4/0AeanS0abc-123_xyz&state=q')).toBe(
      'redirect /?<OAUTH_CODE>&state=q',
    );
  });

  it('after redactAllPii the classifier reports sensitive=false (root-cause invariant)', () => {
    // The exact failure mode from UAT Gap 9: a briefing prompt containing a
    // phone-shaped meeting ID would previously trip the classifier → LOCAL
    // route. After the broadened redactor, it must not.
    const before = 'Daily standup — dial 415-555-1234 to join';
    expect(classifySensitivity(before).sensitive).toBe(true);
    const after = redactAllPii(before);
    expect(classifySensitivity(after).sensitive).toBe(false);
  });

  it('briefing candidates with mixed PII: phone in event title + currency in email snippet are all redacted', () => {
    const c: BriefingCandidates = {
      calendar: [
        {
          id: 'c1',
          title: 'Investor call — dial 415-555-1234',
          startsAt: null,
          location: 'Conf room A',
        },
      ],
      email: [
        {
          id: 'm1',
          subject: 'Re: invoice',
          from_addr: 'cfo@x.co',
          snippet: 'wire $12,500 by EOD',
          received_at: '2026-05-20T00:00:00.000Z',
        },
      ],
      news: [
        {
          id: 'hn-1',
          title: 'Acme raises $50M Series B',
          url: 'https://example.com/acme',
          postedAt: '2026-05-20T00:00:00.000Z',
        },
      ],
    };
    const out = redactPiiInBriefingInput(c);
    expect(out.calendar[0].title).toBe('Investor call — dial <PHONE>');
    expect(out.email[0].from_addr).toBe('<EMAIL>');
    expect(out.email[0].snippet).toBe('wire <AMOUNT> by EOD');
    // Currency pattern now consumes the trailing magnitude suffix so the
    // redacted prompt body is clean (`<AMOUNT> Series B`).
    expect(out.news[0].title).toBe('Acme raises <AMOUNT> Series B');
    // url preserved verbatim.
    expect(out.news[0].url).toBe('https://example.com/acme');

    // Classifier must report not-sensitive on the assembled prompt body.
    const body = [
      out.calendar[0].title,
      out.calendar[0].location,
      out.email[0].subject,
      out.email[0].from_addr,
      out.email[0].snippet,
      out.news[0].title,
    ].join('\n');
    expect(classifySensitivity(body).sensitive).toBe(false);
  });
});
