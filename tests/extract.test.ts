import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { proto } from 'baileys';
import { extractMessage, isStarEmoji, toUnixMs, unwrapMessage } from '../src/wa/extract.js';

describe('extractMessage', () => {
  it('extracts plain conversation text', () => {
    const result = extractMessage({ conversation: ' hello world ' });
    assert.ok(result.type === 'content');
    assert.equal(result.content.text, 'hello world');
    assert.equal(result.content.kind, 'conversation');
    assert.equal(result.content.hasMedia, false);
  });

  it('extracts extended text with quoted message id', () => {
    const result = extractMessage({
      extendedTextMessage: { text: 'a reply', contextInfo: { stanzaId: 'ABC123' } },
    });
    assert.ok(result.type === 'content');
    assert.equal(result.content.quotedId, 'ABC123');
  });

  it('extracts image captions and flags media', () => {
    const result = extractMessage({ imageMessage: { caption: 'look!' } });
    assert.ok(result.type === 'content');
    assert.equal(result.content.kind, 'image');
    assert.equal(result.content.hasMedia, true);
  });

  it('unwraps ephemeral wrappers', () => {
    const result = extractMessage({
      ephemeralMessage: { message: { conversation: 'disappearing' } },
    });
    assert.ok(result.type === 'content');
    assert.equal(result.content.text, 'disappearing');
  });

  it('detects revokes', () => {
    const result = extractMessage({
      protocolMessage: { key: { id: 'DEAD' }, type: proto.Message.ProtocolMessage.Type.REVOKE },
    });
    assert.deepEqual(result, { type: 'revoke', targetId: 'DEAD' });
  });

  it('detects edits with the new text', () => {
    const result = extractMessage({
      protocolMessage: {
        key: { id: 'E1' },
        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
        editedMessage: { conversation: 'fixed typo' },
      },
    });
    assert.deepEqual(result, { type: 'edit', targetId: 'E1', newText: 'fixed typo' });
  });

  it('detects reactions with target key', () => {
    const result = extractMessage({
      reactionMessage: { key: { id: 'T1', remoteJid: 'g@g.us' }, text: '⭐' },
    });
    assert.deepEqual(result, {
      type: 'reaction', targetId: 'T1', targetChatJid: 'g@g.us', emoji: '⭐',
    });
  });

  it('extracts polls', () => {
    const result = extractMessage({
      pollCreationMessageV3: {
        name: 'Dinner?',
        options: [{ optionName: 'Pizza' }, { optionName: 'Sushi' }],
      },
    });
    assert.ok(result.type === 'content');
    assert.equal(result.content.text, 'Poll: Dinner? [Pizza / Sushi]');
  });

  it('ignores empty/unknown messages', () => {
    assert.deepEqual(extractMessage(undefined), { type: 'ignore' });
    assert.deepEqual(extractMessage({}), { type: 'ignore' });
  });
});

describe('helpers', () => {
  it('unwrapMessage returns null for nothing', () => {
    assert.equal(unwrapMessage(null), null);
  });

  it('toUnixMs converts seconds to ms', () => {
    assert.equal(toUnixMs(1_700_000_000), 1_700_000_000_000);
    assert.equal(toUnixMs(null), 0);
  });

  it('isStarEmoji matches star variants only', () => {
    assert.ok(isStarEmoji('⭐'));
    assert.ok(isStarEmoji('🌟'));
    assert.ok(!isStarEmoji('👍'));
  });
});
