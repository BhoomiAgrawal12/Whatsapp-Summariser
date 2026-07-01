import { proto } from 'baileys';
import type Long from 'long';

/**
 * Boundary module: narrows Baileys' loose proto types into clean domain values.
 * Everything below is pure and unit-tested.
 */

export interface ExtractedContent {
  text: string;
  kind: string;
  quotedId: string | null;
  hasMedia: boolean;
}

export type ExtractResult =
  | { type: 'content'; content: ExtractedContent }
  | { type: 'edit'; targetId: string; newText: string }
  | { type: 'revoke'; targetId: string }
  | { type: 'reaction'; targetId: string; targetChatJid: string | null; emoji: string }
  | { type: 'ignore' };

const MEDIA_KINDS = new Set(['image', 'video', 'sticker', 'document', 'audio']);

export function isMediaKind(kind: string): boolean {
  return MEDIA_KINDS.has(kind);
}

/** Peel ephemeral / view-once / doc-with-caption wrappers to reach the real content. */
export function unwrapMessage(m: proto.IMessage | null | undefined): proto.IMessage | null {
  if (!m) return null;
  const inner =
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message ??
    m.viewOnceMessageV2Extension?.message ??
    m.documentWithCaptionMessage?.message ??
    m.editedMessage?.message;
  return inner ? unwrapMessage(inner) : m;
}

function quotedIdOf(ctx: proto.IContextInfo | null | undefined): string | null {
  return ctx?.stanzaId ?? null;
}

/** Classify a (already unwrapped) proto message and extract its text. */
export function extractMessage(raw: proto.IMessage | null | undefined): ExtractResult {
  const m = unwrapMessage(raw);
  if (!m) return { type: 'ignore' };

  if (m.reactionMessage) {
    const key = m.reactionMessage.key;
    if (!key?.id) return { type: 'ignore' };
    return {
      type: 'reaction',
      targetId: key.id,
      targetChatJid: key.remoteJid ?? null,
      emoji: m.reactionMessage.text ?? '',
    };
  }

  if (m.protocolMessage) {
    const p = m.protocolMessage;
    const targetId = p.key?.id;
    if (!targetId) return { type: 'ignore' };
    if (p.type === proto.Message.ProtocolMessage.Type.REVOKE) {
      return { type: 'revoke', targetId };
    }
    if (p.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
      const edited = extractMessage(p.editedMessage);
      const newText = edited.type === 'content' ? edited.content.text : '';
      return { type: 'edit', targetId, newText };
    }
    return { type: 'ignore' };
  }

  if (m.conversation) {
    return content(m.conversation, 'conversation', null);
  }
  if (m.extendedTextMessage) {
    return content(
      m.extendedTextMessage.text ?? '',
      'conversation',
      quotedIdOf(m.extendedTextMessage.contextInfo)
    );
  }
  if (m.imageMessage) {
    return content(m.imageMessage.caption ?? '', 'image', quotedIdOf(m.imageMessage.contextInfo));
  }
  if (m.videoMessage) {
    return content(m.videoMessage.caption ?? '', 'video', quotedIdOf(m.videoMessage.contextInfo));
  }
  if (m.stickerMessage) {
    return content('', 'sticker', quotedIdOf(m.stickerMessage.contextInfo));
  }
  if (m.audioMessage) {
    return content('', 'audio', quotedIdOf(m.audioMessage.contextInfo));
  }
  if (m.documentMessage) {
    const d = m.documentMessage;
    const label = [d.fileName ?? '', d.caption ?? ''].filter(Boolean).join(' — ');
    return content(label, 'document', quotedIdOf(d.contextInfo));
  }
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (poll) {
    const options = (poll.options ?? []).map((o) => o.optionName ?? '').filter(Boolean);
    return content(`Poll: ${poll.name ?? ''} [${options.join(' / ')}]`, 'poll', null);
  }
  if (m.contactMessage) {
    return content(`Contact: ${m.contactMessage.displayName ?? ''}`, 'contact', null);
  }
  if (m.locationMessage) {
    const l = m.locationMessage;
    return content(
      `Location: ${l.name ?? ''} (${l.degreesLatitude ?? '?'}, ${l.degreesLongitude ?? '?'})`,
      'location',
      null
    );
  }
  if (m.eventMessage) {
    return content(`Event: ${m.eventMessage.name ?? ''}`, 'event', null);
  }
  return { type: 'ignore' };
}

function content(text: string, kind: string, quotedId: string | null): ExtractResult {
  return {
    type: 'content',
    content: { text: text.trim(), kind, quotedId, hasMedia: isMediaKind(kind) },
  };
}

/** proto timestamps are number | Long — normalize to unix ms. */
export function toUnixMs(ts: number | Long | null | undefined): number {
  if (ts == null) return 0;
  const seconds = typeof ts === 'number' ? ts : ts.toNumber();
  return seconds * 1000;
}

const STAR_EMOJIS = new Set(['⭐', '🌟', '✨', '💫', '⭐️']);

export function isStarEmoji(emoji: string): boolean {
  return STAR_EMOJIS.has(emoji.trim());
}
