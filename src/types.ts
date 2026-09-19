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

/**
 * Maps a `[n]` citation in a summary back to the message it came from.
 *
 * `messageId` alone is enough for the dashboard, but a jump into WhatsApp Web
 * needs the *WhatsApp* identity of the message (chat jid + wa message id) plus
 * enough content to locate it by search when the id is not in the DOM. Storing
 * all of it with the summary keeps citations resolvable even if the message is
 * later deleted from the messages table.
 *
 * Fields beyond `n`/`messageId` are optional: summaries saved by older versions
 * do not have them, and readers must tolerate their absence.
 */
export interface CitationRef {
  n: number;
  messageId: number;
  chatJid?: string;
  /** WhatsApp's own message id — what `data-id` contains on web.whatsapp.com. */
  waMessageId?: string;
  timestamp?: number;
  senderName?: string;
  /** Short excerpt used as the search key when locating the message in WA Web. */
  snippet?: string;
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
