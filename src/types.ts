/** Domain types shared across the app. All timestamps are unix milliseconds (UTC). */

export interface StoredMessage {
  /** Internal autoincrement id (used for summary citations). */
  id: number;
  chatJid: string;
  waMessageId: string;
  senderJid: string;
  senderName: string;
  timestamp: number;
  /** Extracted plain text ('' for pure-media messages). */
  text: string;
  /** conversation | image | video | sticker | document | audio | poll | ... */
  kind: string;
  /** wa message id this message quotes/replies to, if any. */
  quotedId: string | null;
  deleted: boolean;
  edited: boolean;
}

export interface ChatInfo {
  jid: string;
  name: string;
  isGroup: boolean;
  messageCount: number;
  lastMessageTs: number | null;
}

export interface SummaryWindow {
  fromTs: number;
  toTs: number;
  /** Human description, e.g. "last 2 days" or "since last catch-up". */
  label: string;
}

/** Maps a [n] citation in a summary to the internal id of the cited message. */
export interface CitationRef {
  n: number;
  messageId: number;
}

export interface SavedSummary {
  id: number;
  chatJid: string;
  chatName: string;
  fromTs: number;
  toTs: number;
  createdAt: number;
  /** Markdown-ish digest text (WhatsApp formatting). */
  content: string;
  citations: CitationRef[];
  messageCount: number;
}

export interface StarredMessage {
  id: number;
  chatJid: string;
  chatName: string;
  waMessageId: string;
  senderName: string;
  timestamp: number;
  starredAt: number;
  text: string;
  kind: string;
  /** Relative path (under DATA_DIR) of downloaded media, if any. */
  mediaPath: string | null;
}

export interface TopicProfile {
  /** Free-text interests, e.g. "tech talks, AI tools, hackathon announcements". */
  interests: string;
  updatedAt: number;
}

export interface ScheduleEntry {
  chatJid: string;
  /** "HH:MM" 24h local time. */
  time: string;
}

/** Minimal LLM provider abstraction — both drivers implement this. */
export interface LlmProvider {
  readonly name: string;
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
