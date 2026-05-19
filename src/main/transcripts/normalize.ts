export type TranscriptSourceKind = 'paste' | 'txt' | 'vtt' | 'srt' | 'json';

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker?: string;
  timestampSec?: number;
}

export interface NormalizeTranscriptInput {
  sourceKind: TranscriptSourceKind;
  text: string;
}

export interface NormalizedTranscript {
  normalizedText: string;
  segments: TranscriptSegment[];
}

interface DraftSegment {
  text: string;
  speaker?: string;
  timestampSec?: number;
}

export function normalizeTranscript(input: NormalizeTranscriptInput): NormalizedTranscript {
  const text = input.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) {
    return { normalizedText: '', segments: [] };
  }
  if (input.sourceKind === 'vtt') return fromDraftSegments(parseVtt(text));
  if (input.sourceKind === 'srt') return fromDraftSegments(parseSrt(text));
  if (input.sourceKind === 'json') return fromDraftSegments(parseJsonTranscript(text));
  return fromDraftSegments([{ text }]);
}

function fromDraftSegments(drafts: DraftSegment[]): NormalizedTranscript {
  const segments: TranscriptSegment[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const draft of drafts) {
    const clean = draft.text.trim();
    if (!clean) continue;
    if (parts.length > 0) {
      parts.push('\n');
      offset += 1;
    }
    const start = offset;
    parts.push(clean);
    offset += clean.length;
    const segment: TranscriptSegment = { start, end: offset };
    if (draft.speaker) segment.speaker = draft.speaker;
    if (draft.timestampSec !== undefined) segment.timestampSec = draft.timestampSec;
    segments.push(segment);
  }
  return { normalizedText: parts.join(''), segments };
}

function parseVtt(text: string): DraftSegment[] {
  const withoutHeader = text.replace(/^WEBVTT[^\n]*(\n|$)/i, '').trim();
  return parseCueBlocks(withoutHeader, /-->/);
}

function parseSrt(text: string): DraftSegment[] {
  return parseCueBlocks(text, /-->/);
}

function parseCueBlocks(text: string, timePattern: RegExp): DraftSegment[] {
  const blocks = text.split(/\n{2,}/);
  const out: DraftSegment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => timePattern.test(line));
    if (timeIndex < 0) continue;
    const timestampSec = parseTimestamp(lines[timeIndex]!.split('-->')[0]!.trim());
    const body = lines.slice(timeIndex + 1).join(' ');
    out.push(withSpeaker(body, timestampSec));
  }
  return out;
}

function parseJsonTranscript(text: string): DraftSegment[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { segments?: unknown }).segments)
        ? (parsed as { segments: unknown[] }).segments
        : Array.isArray((parsed as { transcript?: unknown }).transcript)
          ? (parsed as { transcript: unknown[] }).transcript
          : [];
    const out: DraftSegment[] = [];
    for (const row of rows) {
      const obj = row as Record<string, unknown>;
      const rawText = firstString(obj.text, obj.transcript, obj.content, obj.value);
      if (!rawText) continue;
      const start = firstNumber(obj.start, obj.startTime, obj.timestamp, obj.timestampSec);
      const segment: DraftSegment = { text: rawText };
      const speaker = firstString(obj.speaker, obj.name, obj.author);
      if (speaker) segment.speaker = speaker;
      if (start !== undefined) segment.timestampSec = start;
      out.push(segment);
    }
    return out;
  } catch {
    return [{ text }];
  }
}

function withSpeaker(text: string, timestampSec?: number): DraftSegment {
  const match = /^([^:]{1,80}):\s+(.+)$/.exec(text);
  if (!match) return { text, timestampSec };
  return { speaker: match[1], text: match[2]!, timestampSec };
}

function parseTimestamp(value: string): number | undefined {
  const normalized = value.replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find((v) => typeof v === 'string' && v.trim().length > 0);
  return typeof value === 'string' ? value : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  const value = values.find((v) => typeof v === 'number' && Number.isFinite(v));
  return typeof value === 'number' ? value : undefined;
}
