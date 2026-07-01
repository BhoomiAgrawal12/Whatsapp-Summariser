import type { Db } from './db.js';
import type { CitationRef, SavedSummary } from '../types.js';

interface SummaryRow {
  id: number;
  chat_jid: string;
  chat_name: string;
  from_ts: number;
  to_ts: number;
  created_at: number;
  content: string;
  citations: string;
  message_count: number;
}

function toSummary(row: SummaryRow): SavedSummary {
  return {
    id: row.id,
    chatJid: row.chat_jid,
    chatName: row.chat_name,
    fromTs: row.from_ts,
    toTs: row.to_ts,
    createdAt: row.created_at,
    content: row.content,
    citations: JSON.parse(row.citations) as CitationRef[],
    messageCount: row.message_count,
  };
}

export class SummaryRepo {
  constructor(private readonly db: Db) {}

  save(summary: Omit<SavedSummary, 'id'>): number {
    const result = this.db
      .prepare(
        `INSERT INTO summaries
           (chat_jid, chat_name, from_ts, to_ts, created_at, content, citations, message_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        summary.chatJid,
        summary.chatName,
        summary.fromTs,
        summary.toTs,
        summary.createdAt,
        summary.content,
        JSON.stringify(summary.citations),
        summary.messageCount
      );
    return Number(result.lastInsertRowid);
  }

  get(id: number): SavedSummary | null {
    const row = this.db.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as
      | SummaryRow
      | undefined;
    return row ? toSummary(row) : null;
  }

  listRecent(limit: number): SavedSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM summaries ORDER BY created_at DESC LIMIT ?')
      .all(limit) as SummaryRow[];
    return rows.map(toSummary);
  }
}
