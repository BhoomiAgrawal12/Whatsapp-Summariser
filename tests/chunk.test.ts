import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLines } from '../src/summarize/chunk.js';

describe('chunkLines', () => {
  it('returns empty for no lines', () => {
    assert.deepEqual(chunkLines([]), []);
  });

  it('keeps everything in one chunk when under the budget', () => {
    const lines = ['a', 'b', 'c'];
    assert.deepEqual(chunkLines(lines, { maxChars: 100, overlapLines: 2 }), [lines]);
  });

  it('splits over budget and repeats overlap lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`.padEnd(10, 'x'));
    const chunks = chunkLines(lines, { maxChars: 35, overlapLines: 1 });
    assert.ok(chunks.length > 1);
    for (let i = 1; i < chunks.length; i++) {
      const prevLast = chunks[i - 1]!.at(-1);
      assert.equal(chunks[i]![0], prevLast, 'next chunk starts with previous overlap line');
    }
    // Every original line appears somewhere.
    const flat = new Set(chunks.flat());
    for (const line of lines) assert.ok(flat.has(line));
  });

  it('does not loop on a single line larger than the budget', () => {
    const lines = ['x'.repeat(500)];
    assert.deepEqual(chunkLines(lines, { maxChars: 100, overlapLines: 2 }), [lines]);
  });
});
