/**
 * Deterministic synthetic corpus for the offline retrieval bench.
 *
 * Builds an in-memory database carrying the real migration-126 RAG schema
 * (rag_chunk + rag_embedding + rag_chunk_fts with the porter tokenizer and
 * the sync triggers), then seeds it with topic-clustered documents.
 *
 * GROUND TRUTH. Every chunk belongs to exactly one topic. A query for topic T
 * is judged relevant to precisely the chunks of topic T and to nothing else.
 * That gives clean binary judgements without human labelling, at the cost of
 * being an easier task than real email: there is no topic drift and no
 * near-duplicate across topics. Treat absolute scores as an upper bound and
 * use them for A/B comparison between retrieval strategies, which is what
 * they are actually for.
 *
 * Contains no personal data. Nothing here touches the user's vault, so the
 * numbers are publishable.
 */
import Database from 'better-sqlite3-multiple-ciphers';
import { embedText, OFFLINE_EMBED_DIM, OFFLINE_EMBED_ID } from './fake-embed';

type Db = Database.Database;

/** Mulberry32: small, fast, seeded PRNG. Same seed, same corpus, forever. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Topic {
  key: string;
  /** Natural-language question, as a user would ask an assistant. */
  query: string;
  /** Bare keywords, as a user would type into a search box. */
  keywords: string;
  /** Distinctive vocabulary. Drives both BM25 and the hashing vectorizer. */
  terms: string[];
}

/**
 * Twelve topics drawn from the executive-assistant domain Aria targets.
 * Vocabulary overlaps deliberately across a few pairs (budget/forecast,
 * vendor/procurement) so fusion has something non-trivial to do.
 */
export const TOPICS: readonly Topic[] = [
  { key: 'q3-budget', query: 'what is the status of the Q3 budget approval', keywords: 'budget approval',
    terms: ['budget', 'approval', 'quarter', 'finance', 'allocation', 'variance', 'forecast'] },
  { key: 'vendor-renewal', query: 'when does the vendor contract renewal close', keywords: 'vendor renewal',
    terms: ['vendor', 'contract', 'renewal', 'procurement', 'terms', 'clause', 'counterparty'] },
  { key: 'hiring-pipeline', query: 'who is in the hiring pipeline for the platform role', keywords: 'hiring pipeline',
    terms: ['hiring', 'candidate', 'pipeline', 'interview', 'scorecard', 'offer', 'recruiter'] },
  { key: 'board-meeting', query: 'what do I need to prepare for the board meeting', keywords: 'board agenda',
    terms: ['board', 'meeting', 'deck', 'agenda', 'minutes', 'governance', 'resolution'] },
  { key: 'security-review', query: 'did the security review find anything blocking', keywords: 'security remediation',
    terms: ['security', 'review', 'vulnerability', 'penetration', 'remediation', 'severity', 'disclosure'] },
  { key: 'customer-escalation', query: 'what happened with the customer escalation last week', keywords: 'customer escalation',
    terms: ['escalation', 'customer', 'incident', 'outage', 'apology', 'credit', 'postmortem'] },
  { key: 'product-launch', query: 'what is left before the product launch', keywords: 'launch readiness',
    terms: ['launch', 'release', 'rollout', 'announcement', 'readiness', 'checklist', 'ga'] },
  { key: 'payroll-run', query: 'has the payroll run been approved this month', keywords: 'payroll approval',
    terms: ['payroll', 'salary', 'run', 'approval', 'deduction', 'pension', 'payslip'] },
  { key: 'travel-plans', query: 'what are my travel plans for next month', keywords: 'travel itinerary',
    terms: ['travel', 'flight', 'itinerary', 'hotel', 'visa', 'booking', 'departure'] },
  { key: 'legal-dispute', query: 'what is the current position on the legal dispute', keywords: 'legal settlement',
    terms: ['legal', 'dispute', 'counsel', 'settlement', 'litigation', 'exposure', 'filing'] },
  { key: 'infra-migration', query: 'how is the infrastructure migration progressing', keywords: 'migration cutover',
    terms: ['migration', 'infrastructure', 'cutover', 'rollback', 'downtime', 'capacity', 'cluster'] },
  { key: 'quarterly-forecast', query: 'what does the quarterly revenue forecast look like', keywords: 'revenue forecast',
    terms: ['forecast', 'revenue', 'pipeline', 'quarter', 'attainment', 'churn', 'bookings'] },
];

/** Domain-neutral filler so chunks read like prose rather than keyword soup. */
const FILLER = [
  'following up on the thread from yesterday afternoon',
  'please confirm whether this still needs a decision from me',
  'sharing the latest version ahead of the call',
  'flagging this early so nothing is a surprise later',
  'the summary below covers the open items only',
  'no action needed if you are already across this',
  'copying in the wider group for visibility',
  'this supersedes what I sent on Monday',
  'the attachment has the detailed breakdown',
  'happy to walk through any of it live',
];

export const SCHEMA_SQL = `
CREATE TABLE rag_chunk (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('email','event','note','action')),
  source_id TEXT NOT NULL,
  provider_key TEXT,
  account_id TEXT,
  parent_ref TEXT,
  speaker_hint TEXT,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  lang TEXT,
  sensitivity TEXT,
  sensitivity_model TEXT,
  sensitivity_at TEXT,
  source_updated_at TEXT,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_rag_chunk_account ON rag_chunk(provider_key, account_id);
CREATE INDEX idx_rag_chunk_alive ON rag_chunk(source_kind, source_id) WHERE deleted_at IS NULL;

CREATE TABLE rag_embedding (
  chunk_id TEXT NOT NULL REFERENCES rag_chunk(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  embedding_norm REAL,
  embedded_at TEXT NOT NULL,
  PRIMARY KEY (chunk_id, model_id)
);
CREATE INDEX idx_rag_embedding_model ON rag_embedding(model_id);

CREATE VIRTUAL TABLE rag_chunk_fts USING fts5(
  text,
  content='rag_chunk',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 1'
);
CREATE TRIGGER rag_chunk_ai AFTER INSERT ON rag_chunk BEGIN
  INSERT INTO rag_chunk_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER rag_chunk_ad AFTER DELETE ON rag_chunk BEGIN
  INSERT INTO rag_chunk_fts(rag_chunk_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER rag_chunk_au AFTER UPDATE ON rag_chunk BEGIN
  INSERT INTO rag_chunk_fts(rag_chunk_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO rag_chunk_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE rag_index_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_model_id TEXT NOT NULL,
  active_model_dim INTEGER NOT NULL,
  rebuild_in_progress INTEGER NOT NULL DEFAULT 0,
  vector_backend TEXT NOT NULL DEFAULT 'fallback',
  updated_at TEXT NOT NULL
);

CREATE TABLE app_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export interface CorpusOptions {
  /** Chunks per topic. Total corpus = chunksPerTopic * TOPICS.length. */
  chunksPerTopic?: number;
  /** Distractor chunks containing no topic vocabulary. */
  distractors?: number;
  seed?: number;
  dim?: number;
}

export interface Corpus {
  db: Db;
  /** topic key -> the chunk ids judged relevant for that topic's query. */
  judgements: Map<string, Set<string>>;
  totalChunks: number;
  dim: number;
  modelId: string;
  close(): void;
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

export function buildCorpus(opts: CorpusOptions = {}): Corpus {
  const chunksPerTopic = opts.chunksPerTopic ?? 40;
  const distractors = opts.distractors ?? 200;
  const seed = opts.seed ?? 20260908;
  const dim = opts.dim ?? OFFLINE_EMBED_DIM;
  const r = rng(seed);

  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT INTO rag_index_state(id, active_model_id, active_model_dim, updated_at)
     VALUES (1, ?, ?, ?)`,
  ).run(OFFLINE_EMBED_ID, dim, new Date().toISOString());

  const insChunk = db.prepare(
    `INSERT INTO rag_chunk
       (id, source_kind, source_id, provider_key, account_id, parent_ref,
        title, text, char_start, char_end, token_count, created_at, updated_at, dirty)
     VALUES (@id, @sourceKind, @sourceId, @providerKey, @accountId, NULL,
             @title, @text, 0, @len, @tokens, @now, @now, 0)`,
  );
  const insEmb = db.prepare(
    `INSERT INTO rag_embedding(chunk_id, model_id, dim, vector, embedding_norm, embedded_at)
     VALUES (?, ?, ?, ?, 1.0, ?)`,
  );

  const judgements = new Map<string, Set<string>>();
  const now = new Date().toISOString();
  let total = 0;

  const write = (id: string, title: string, text: string): void => {
    insChunk.run({
      id, sourceKind: 'email', sourceId: `msg-${id}`,
      providerKey: 'bench', accountId: 'bench-account',
      title, text, len: text.length,
      tokens: Math.ceil(text.length / 4), now,
    });
    const vec = embedText(text, dim);
    insEmb.run(id, OFFLINE_EMBED_ID, dim, Buffer.from(vec.buffer.slice(0)), now);
    total += 1;
  };

  db.transaction(() => {
    for (const topic of TOPICS) {
      const ids = new Set<string>();
      for (let i = 0; i < chunksPerTopic; i += 1) {
        const id = `${topic.key}-${i}`;
        // 3 to 5 topic terms, so no single chunk carries the whole vocabulary.
        const n = 3 + Math.floor(r() * 3);
        const chosen: string[] = [];
        for (let j = 0; j < n; j += 1) chosen.push(pick(r, topic.terms));
        const text = `${pick(r, FILLER)}. ${chosen.join(' ')}. ${pick(r, FILLER)}.`;
        write(id, topic.key.replace(/-/g, ' '), text);
        ids.add(id);
      }
      judgements.set(topic.key, ids);
    }
    for (let i = 0; i < distractors; i += 1) {
      const text = `${pick(r, FILLER)}. ${pick(r, FILLER)}. ${pick(r, FILLER)}.`;
      write(`distractor-${i}`, 'general', text);
    }
  })();

  return {
    db, judgements, totalChunks: total, dim, modelId: OFFLINE_EMBED_ID,
    close: () => db.close(),
  };
}
