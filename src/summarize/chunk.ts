/**
 * Pure chunking logic for the map-reduce summarizer.
 * Lines are pre-rendered "[n] HH:MM sender: text" strings; we split them into
 * chunks bounded by character budget (a char is a rough proxy for a token),
 * keeping a small overlap so conversations aren't cut mid-thread.
 */

export interface ChunkOptions {
  /** Max characters per chunk (~4 chars ≈ 1 token). */
  maxChars: number;
  /** How many trailing lines of a chunk are repeated at the start of the next. */
  overlapLines: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 12_000,
  overlapLines: 8,
};

export function chunkLines(lines: string[], options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[][] {
  if (lines.length === 0) return [];

  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const line of lines) {
    // A single pathological line still becomes its own chunk rather than looping forever.
    if (currentChars + line.length > options.maxChars && current.length > 0) {
      chunks.push(current);
      const overlap = current.slice(-options.overlapLines);
      current = [...overlap];
      currentChars = overlap.reduce((sum, l) => sum + l.length, 0);
    }
    current.push(line);
    currentChars += line.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
