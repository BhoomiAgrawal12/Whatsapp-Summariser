import type { Db } from './db.js';
import type { Note } from '../types.js';

interface NoteRow {
  id: number;
  title: string;
  body: string;
  position: number;
  chat_jid: string | null;
  source: string;
  created_at: number;
  updated_at: number;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    position: row.position,
    chatJid: row.chat_jid,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NoteInput {
  /** Either may be omitted; both default to empty rather than NULL. */
  title?: string;
  body?: string;
  chatJid?: string | null;
  source?: string;
}

/**
 * The user's own notes: created, edited, deleted and ordered by hand.
 *
 * Ordering is an explicit `position` column rather than creation time, because
 * the point of the feature is arranging notes the way the user wants them.
 */
export class NotesRepo {
  constructor(private readonly db: Db) {}

  /** All notes in the user's chosen order. */
  list(): Note[] {
    const rows = this.db
      .prepare('SELECT * FROM notes ORDER BY position ASC, id ASC')
      .all() as NoteRow[];
    return rows.map(toNote);
  }

  get(id: number): Note | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
    return row ? toNote(row) : null;
  }

  /** New notes go to the top — a note just written is the one being worked on. */
  create(input: NoteInput, now: number): Note {
    const min = (this.db.prepare('SELECT MIN(position) AS p FROM notes').get() as { p: number | null }).p;
    const position = (min ?? 0) - 1;
    const result = this.db
      .prepare(
        `INSERT INTO notes (title, body, position, chat_jid, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      // Coerce every text column here: the columns are NOT NULL, and a caller
      // omitting one should produce an empty note field, not a constraint error.
      .run(
        input.title ?? '',
        input.body ?? '',
        position,
        input.chatJid ?? null,
        input.source ?? '',
        now,
        now
      );
    return this.get(Number(result.lastInsertRowid))!;
  }

  /** Returns null when the note does not exist. */
  update(id: number, fields: Partial<Pick<Note, 'title' | 'body'>>, now: number): Note | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
      .run(fields.title ?? existing.title, fields.body ?? existing.body, now, id);
    return this.get(id);
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0;
  }

  /**
   * Apply a new order. Positions are rewritten as one transaction so a failure
   * part-way cannot leave the list in a half-reordered state. Ids that are not
   * in `orderedIds` keep their relative order after the listed ones.
   */
  reorder(orderedIds: number[]): void {
    const setPosition = this.db.prepare('UPDATE notes SET position = ? WHERE id = ?');
    const apply = this.db.transaction((ids: number[]) => {
      ids.forEach((id, index) => setPosition.run(index, id));
      // Anything not mentioned is pushed below, preserving its previous order.
      const rest = this.db
        .prepare('SELECT id FROM notes WHERE id NOT IN (SELECT value FROM json_each(?)) ORDER BY position ASC, id ASC')
        .all(JSON.stringify(ids)) as { id: number }[];
      rest.forEach((row, index) => setPosition.run(ids.length + index, row.id));
    });
    apply(orderedIds);
  }
}
