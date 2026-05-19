import type { MeetingActionArtifact } from './extract';

export function dedupeActions(actions: MeetingActionArtifact[]): MeetingActionArtifact[] {
  const out: MeetingActionArtifact[] = [];
  for (const action of actions) {
    const key = normalize(action.text);
    const duplicate = out.some((existing) => {
      const overlap = Math.max(
        0,
        Math.min(existing.citation.end, action.citation.end) -
          Math.max(existing.citation.start, action.citation.start),
      );
      const minLen = Math.min(
        existing.citation.end - existing.citation.start,
        action.citation.end - action.citation.start,
      );
      return normalize(existing.text) === key || (minLen > 0 && overlap / minLen > 0.5);
    });
    if (!duplicate) out.push(action);
  }
  return out;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
