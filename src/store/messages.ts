import type { Db } from './db.js';
import type { ChatInfo, StoredMessage } from '../types.js';

interface MessageRow {
  id: number;
  chat_jid: string;
  wa_message_id: string;
  sender_jid: string;
  sender_name: string;
  timestamp: number;
  text: string;
  kind: string;
  quoted_id: string | null;
  deleted: number;
  edited: number;
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    chatJid: row.chat_jid,
    waMessageId: row.wa_message_id,
    senderJid: row.sender_jid,
    senderName: row.sender_name,
    timestamp: row.timestamp,
    text: row.text,
    kind: row.kind,
    quotedId: row.quoted_id,
    deleted: row.deleted === 1,
    edited: row.edited === 1,
  };
}

export interface NewMessage {
  chatJid: string;
  waMessageId: string;
  senderJid: string;
  senderName: string;
  timestamp: number;
  text: string;
  kind: string;
  quotedId: string | null;
  /** Encoded proto, only kept for media messages (starring downloads media later). */
  raw: Buffer | null;
}

export class MessageRepo {
  constructor(private readonly db: Db) {}

  /** Insert a message; ignores duplicates (history sync overlaps live events). */
  insert(msg: NewMessage): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
           (chat_jid, wa_message_id, sender_jid, sender_name, timestamp, text, kind, quoted_id, raw)
         VALUES (@chatJid, @waMessageId, @senderJid, @senderName, @timestamp, @text, @kind, @quotedId, @raw)`
      )
      .run(msg);
  }

  /** Raw encoded proto for media messages (null for text messages). */
  getRaw(chatJid: string, waMessageId: string): Buffer | null {
    const row = this.db
      .prepare('SELECT raw FROM messages WHERE chat_jid = ? AND wa_message_id = ?')
      .get(chatJid, waMessageId) as { raw: Buffer | null } | undefined;
    return row?.raw ?? null;
  }

  markEdited(chatJid: string, waMessageId: string, newText: string): void {
    this.db
      .prepare(
        'UPDATE messages SET text = ?, edited = 1 WHERE chat_jid = ? AND wa_message_id = ?'
      )
      .run(newText, chatJid, waMessageId);
  }

  /** Soft delete: keeps the record so summaries/archive stay consistent. */
  markDeleted(chatJid: string, waMessageId: string): void {
    this.db
      .prepare('UPDATE messages SET deleted = 1 WHERE chat_jid = ? AND wa_message_id = ?')
      .run(chatJid, waMessageId);
  }

  getByWaId(chatJid: string, waMessageId: string): StoredMessage | null {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE chat_jid = ? AND wa_message_id = ?')
      .get(chatJid, waMessageId) as MessageRow | undefined;
    return row ? toMessage(row) : null;
  }

  getById(id: number): StoredMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
      | MessageRow
      | undefined;
    return row ? toMessage(row) : null;
  }

  /** Messages in [fromTs, toTs], oldest first, excluding deleted ones. */
  inRange(chatJid: string, fromTs: number, toTs: number): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE chat_jid = ? AND timestamp >= ? AND timestamp <= ? AND deleted = 0
         ORDER BY timestamp ASC, id ASC`
      )
      .all(chatJid, fromTs, toTs) as MessageRow[];
    return rows.map(toMessage);
  }

  /** Neighbourhood of a message for the dashboard context view. */
  context(messageId: number, radius: number): StoredMessage[] {
    const center = this.getById(messageId);
    if (!center) return [];
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE chat_jid = @chatJid AND id <= @id ORDER BY id DESC LIMIT @take
         )
         UNION
         SELECT * FROM (
           SELECT * FROM messages WHERE chat_jid = @chatJid AND id > @id ORDER BY id ASC LIMIT @take
         )
         ORDER BY timestamp ASC, id ASC`
      )
      .all({ chatJid: center.chatJid, id: messageId, take: radius }) as MessageRow[];
    return rows.map(toMessage);
  }

  upsertChat(jid: string, name: string, isGroup: boolean): void {
    this.db
      .prepare(
        `INSERT INTO chats (jid, name, is_group) VALUES (?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET
           name = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END`
      )
      .run(jid, name, isGroup ? 1 : 0);
  }

  chatName(jid: string): string {
    const row = this.db.prepare('SELECT name FROM chats WHERE jid = ?').get(jid) as
      | { name: string }
      | undefined;
    return row?.name ?? '';
  }

  /** All known group chats with message stats, most recently active first. */
  listGroups(): ChatInfo[] {
    const rows = this.db
      .prepare(
        `SELECT c.jid, c.name, c.is_group,
                COUNT(m.id) AS message_count, MAX(m.timestamp) AS last_ts
         FROM chats c LEFT JOIN messages m ON m.chat_jid = c.jid
         WHERE c.is_group = 1
         GROUP BY c.jid
         ORDER BY last_ts DESC NULLS LAST`
      )
      .all() as { jid: string; name: string; is_group: number; message_count: number; last_ts: number | null }[];
    return rows.map((r) => ({
      jid: r.jid,
      name: r.name,
      isGroup: r.is_group === 1,
      messageCount: r.message_count,
      lastMessageTs: r.last_ts,
    }));
  }
}
