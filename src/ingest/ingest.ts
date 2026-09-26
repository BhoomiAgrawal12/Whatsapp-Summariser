import { proto, type WAMessage, type WAMessageUpdate } from 'baileys';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import type { MessageRepo } from '../store/messages.js';
import type { StarredRepo } from '../store/starred.js';
import type { WaConnection } from '../wa/connection.js';
import { extractMessage, isStarEmoji, toUnixMs, unwrapMessage } from '../wa/extract.js';

const MEDIA_EXT: Record<string, string> = {
  image: 'jpg',
  video: 'mp4',
  sticker: 'webp',
  audio: 'ogg',
  document: 'bin',
};

/**
 * Turns raw Baileys events into database rows:
 *  - stores every group/chat message (text extracted, media protos kept)
 *  - applies edits and revokes
 *  - archives the user's starred messages (WhatsApp's own star AND a ⭐ reaction)
 *  - routes "/command" texts from the self-chat to the command handler
 */
export class Ingestor {
  private conn: WaConnection | null = null;

  constructor(
    private readonly messages: MessageRepo,
    private readonly starred: StarredRepo,
    private readonly dataDir: string,
    private readonly logger: Logger,
    private readonly onSelfCommand: (text: string) => Promise<void>
  ) {}

  /** Late-bound: the connection needs this ingestor's handlers to be constructed first. */
  attach(conn: WaConnection): void {
    this.conn = conn;
  }

  registerGroups(groups: Map<string, string>): void {
    for (const [jid, name] of groups) this.messages.upsertChat(jid, name, true);
  }

  async handleMessages(batch: WAMessage[], source: 'live' | 'history'): Promise<void> {
    for (const msg of batch) {
      try {
        await this.handleOne(msg, source);
      } catch (err) {
        this.logger.error({ err, id: msg.key?.id }, 'failed to ingest message');
      }
    }
  }

  private async handleOne(msg: WAMessage, source: 'live' | 'history'): Promise<void> {
    const chatJid = msg.key?.remoteJid;
    const waId = msg.key?.id;
    if (!chatJid || !waId) return;
    // Status updates and channels are not conversations we summarize.
    if (chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) return;

    const extracted = extractMessage(msg.message);

    // Self-chat commands: only live messages I sent to myself, starting with "/".
    if (source === 'live' && msg.key.fromMe && this.conn?.isSelfChat(chatJid)) {
      if (extracted.type === 'content' && extracted.content.text.startsWith('/')) {
        await this.onSelfCommand(extracted.content.text);
      }
      return; // never store the self-chat (it's the control channel)
    }

    switch (extracted.type) {
      case 'content': {
        const { text, kind, quotedId, hasMedia } = extracted.content;
        if (!text && !hasMedia) return;
        const raw = hasMedia
          ? Buffer.from(proto.WebMessageInfo.encode(msg as proto.IWebMessageInfo).finish())
          : null;
        this.messages.upsertChat(chatJid, '', chatJid.endsWith('@g.us'));
        this.messages.insert({
          chatJid,
          waMessageId: waId,
          senderJid: msg.key.fromMe ? 'me' : (msg.key.participant ?? chatJid),
          senderName: msg.key.fromMe ? 'Me' : (msg.pushName ?? shortJid(msg.key.participant ?? chatJid)),
          timestamp: toUnixMs(msg.messageTimestamp),
          text,
          kind,
          quotedId,
          raw,
        });
        // Messages can arrive already starred — history sync replays stars set
        // before this app existed, so the archive backfills instead of only ever
        // seeing stars applied from now on.
        if (msg.starred === true) await this.archive(chatJid, waId, 'already starred');
        return;
      }
      case 'edit':
        this.messages.markEdited(chatJid, extracted.targetId, extracted.newText);
        return;
      case 'revoke':
        this.messages.markDeleted(chatJid, extracted.targetId);
        return;
      case 'reaction':
        // Only my own reactions drive the star archive.
        if (msg.key.fromMe) {
          await this.handleOwnReaction(
            extracted.targetChatJid ?? chatJid,
            extracted.targetId,
            extracted.emoji
          );
        }
        return;
      case 'ignore':
        return;
    }
  }

  /**
   * WhatsApp's own star (long-press → Star) syncs to linked devices as a
   * `messages.update` carrying `starred`. Supporting it means the built-in
   * gesture people already know works, alongside the ⭐ reaction.
   */
  async handleUpdates(updates: WAMessageUpdate[]): Promise<void> {
    for (const { key, update } of updates) {
      const chatJid = key?.remoteJid;
      const waId = key?.id;
      if (!chatJid || !waId || typeof update?.starred !== 'boolean') continue;
      try {
        if (update.starred) await this.archive(chatJid, waId, 'native star');
        else this.starred.remove(chatJid, waId);
      } catch (err) {
        this.logger.error({ err, chatJid, waId }, 'failed to apply star update');
      }
    }
  }

  private async handleOwnReaction(chatJid: string, targetId: string, emoji: string): Promise<void> {
    if (emoji === '') {
      // Reaction removed -> unstar (archive is otherwise permanent).
      this.starred.remove(chatJid, targetId);
      return;
    }
    if (!isStarEmoji(emoji)) return;
    await this.archive(chatJid, targetId, '⭐ reaction');
  }

  /** Copy a recorded message (and its media) into the permanent archive. */
  private async archive(chatJid: string, targetId: string, via: string): Promise<void> {
    const stored = this.messages.getByWaId(chatJid, targetId);
    if (!stored) {
      this.logger.warn({ chatJid, targetId, via }, 'starred a message we never recorded');
      return;
    }
    const mediaPath = await this.tryDownloadMedia(chatJid, targetId, stored.kind);
    this.starred.add({
      chatJid,
      chatName: this.messages.chatName(chatJid) || shortJid(chatJid),
      waMessageId: targetId,
      senderName: stored.senderName,
      timestamp: stored.timestamp,
      starredAt: Date.now(),
      text: stored.text,
      kind: stored.kind,
      mediaPath,
    });
    this.logger.info({ chatJid, targetId, via }, 'message starred into permanent archive');
  }

  /** Returns a path relative to dataDir, or null when there is no media / download fails. */
  private async tryDownloadMedia(
    chatJid: string,
    waId: string,
    kind: string
  ): Promise<string | null> {
    const rawProto = this.messages.getRaw(chatJid, waId);
    if (!rawProto || !this.conn) return null;
    try {
      const buffer = await this.conn.downloadMedia(rawProto);
      const ext = this.mediaExtension(rawProto, kind);
      const relative = path.join('media', `${sanitize(waId)}.${ext}`);
      const absolute = path.join(this.dataDir, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, buffer);
      return relative;
    } catch (err) {
      this.logger.warn({ err, waId }, 'media download failed (message archived text-only)');
      return null;
    }
  }

  private mediaExtension(rawProto: Buffer, kind: string): string {
    if (kind === 'document') {
      const decoded = proto.WebMessageInfo.decode(rawProto);
      const fileName = unwrapMessage(decoded.message)?.documentMessage?.fileName ?? '';
      const ext = path.extname(fileName).slice(1);
      if (ext) return ext;
    }
    return MEDIA_EXT[kind] ?? 'bin';
  }
}

function shortJid(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
