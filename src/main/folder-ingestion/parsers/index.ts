/**
 * Plan 10-01 Task 2 — Parser registry.
 *
 * Maps file extensions to parser modules. Unknown extensions return null.
 */
import type { ParsedDocument } from './text';

export type { ParsedDocument, SectionLocator } from './text';

export interface Parser {
  parse(absolutePath: string): Promise<ParsedDocument>;
}

type Extension = string; // lowercase, including the dot (e.g. '.txt')

async function loadParser(ext: Extension): Promise<Parser> {
  switch (ext) {
    case '.txt':
      return await import('./text');
    case '.md':
    case '.mdx':
      return await import('./markdown');
    case '.csv':
      return await import('./csv');
    case '.docx':
      return await import('./docx');
    case '.xlsx':
      return await import('./xlsx');
    case '.pdf':
      return await import('./pdf');
    default:
      throw new Error(`No parser for extension: ${ext}`);
  }
}

export const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.csv', '.docx', '.xlsx', '.pdf']);

/**
 * Returns the parser for a given filename, or null if unsupported.
 */
export function getParserFor(filename: string): Parser | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return null;
  // Return a lazy proxy that loads the real parser on first call.
  return {
    parse: async (absolutePath: string) => {
      const parser = await loadParser(ext);
      return parser.parse(absolutePath);
    },
  };
}

/**
 * Eager parser map (for tests / introspection).
 */
export const PARSERS: Record<Extension, Parser> = Object.fromEntries(
  Array.from(SUPPORTED_EXTENSIONS).map((ext) => [
    ext,
    {
      parse: async (absolutePath: string) => {
        const parser = await loadParser(ext);
        return parser.parse(absolutePath);
      },
    },
  ]),
);
