import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  jid            TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  is_group       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid       TEXT NOT NULL,
  wa_message_id  TEXT NOT NULL,
  sender_jid     TEXT NOT NULL DEFAULT '',
  sender_name    TEXT NOT NULL DEFAULT '',
  timestamp      INTEGER NOT NULL,
  text           TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT 'conversation',
  quoted_id      TEXT,
  deleted        INTEGER NOT NULL DEFAULT 0,
  edited         INTEGER NOT NULL DEFAULT 0,
  -- encoded proto.WebMessageInfo, kept only for media messages so that
  -- starring can download the media later
  raw            BLOB,
  UNIQUE (chat_jid, wa_message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_jid, timestamp);

CREATE TABLE IF NOT EXISTS summaries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid          TEXT NOT NULL,
  chat_name         TEXT NOT NULL DEFAULT '',
  from_ts           INTEGER NOT NULL,
  to_ts             INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  content           TEXT NOT NULL,
  -- JSON array of {n, messageId} pairs linking [n] citations to messages
  citations         TEXT NOT NULL DEFAULT '[]',
  message_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_summaries_chat ON summaries (chat_jid, created_at);

CREATE TABLE IF NOT EXISTS starred_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid      TEXT NOT NULL,
  chat_name     TEXT NOT NULL DEFAULT '',
  wa_message_id TEXT NOT NULL,
  sender_name   TEXT NOT NULL DEFAULT '',
  timestamp     INTEGER NOT NULL,
  starred_at    INTEGER NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'conversation',
  media_path    TEXT,
  UNIQUE (chat_jid, wa_message_id)
);

-- Single-row-per-key generic settings: topic profile, catch-up markers, schedules.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Open (creating if needed) the app database with WAL mode for concurrent reads. */
export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export type Db = Database.Database;
