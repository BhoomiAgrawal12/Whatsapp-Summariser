import type { Db } from './db.js';
import type { StarredMessage } from '../types.js';

interface StarredRow {
  id: number;
  chat_jid: string;
  chat_name: string;
  wa_message_id: string;
  sender_name: string;
  timestamp: number;
  starred_at: number;
  text: string;
  kind: string;
  media_path: string | null;
}

function toStarred(row: StarredRow): StarredMessage {
  return {
    id: row.id,
    chatJid: row.chat_jid,
    chatName: row.chat_name,
    waMessageId: row.wa_message_id,
    senderName: row.sender_name,
    timestamp: row.timestamp,
    starredAt: row.starred_at,
    text: row.text,
    kind: row.kind,
    mediaPath: row.media_path,
  };
}

export class StarredRepo {
  constructor(private readonly db: Db) {}

  /** Archive a message permanently; re-starring is a no-op. */
  add(entry: Omit<StarredMessage, 'id'>): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO starred_archive
           (chat_jid, chat_name, wa_message_id, sender_name, timestamp, starred_at, text, kind, media_path)
         VALUES (@chatJid, @chatName, @waMessageId, @senderName, @timestamp, @starredAt, @text, @kind, @mediaPath)`
      )
      .run(entry);
  }

  remove(chatJid: string, waMessageId: string): void {
    this.db
      .prepare('DELETE FROM starred_archive WHERE chat_jid = ? AND wa_message_id = ?')
      .run(chatJid, waMessageId);
  }

  list(): StarredMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM starred_archive ORDER BY starred_at DESC')
      .all() as StarredRow[];
    return rows.map(toStarred);
  }
}
