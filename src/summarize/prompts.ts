/**
 * All LLM prompts live here so tone/format changes never touch pipeline code.
 * Digests use WhatsApp text formatting (*bold*, _italic_) because they are
 * delivered into the user's own WhatsApp chat.
 *
 * Every prompt takes a `perDay` flag: when the window covers more than one
 * calendar day the transcript is grouped under `=== Wed 01 Jul 2026 ===`
 * headings and the digest is asked for a matching day-by-day structure.
 */

export const SYSTEM_PROMPT = `You are a precise assistant that summarizes WhatsApp group conversations for one busy reader.
Rules:
- Be faithful to the messages; never invent facts.
- Cite supporting messages with their [n] index, e.g. "Dinner moved to 9pm [42]".
- Never invent an index: only cite indices that appear in the transcript you were given.
- Use WhatsApp formatting: *bold* for headers, "- " bullets. No markdown # headers, no tables.
- Write compactly; the reader wants to catch up in under a minute.`;

const DAY_RULE = `The transcript is grouped by day under "=== <weekday> <date> ===" headings.
Keep every point under the day it happened on, and never merge points from different days.`;

function dayStructure(perDay: boolean): string {
  return perDay
    ? `*🗓 Day by day* — one block per date, in chronological order. Start each block with the date in *bold* exactly as it appears in the transcript heading, then "- " bullets for that day's key points, decisions and open questions, each with its [n] citations. Skip days with nothing worth reporting.`
    : `*🧵 Topics* — one short block per topic: title in *bold*, then "- " bullets with the key points, decisions and open questions. Cite supporting messages [n].`;
}

export function chunkMapPrompt(chatName: string, chunkText: string, perDay = false): string {
  const grouping = perDay
    ? `${DAY_RULE}\nExtract the discussion as compact notes grouped FIRST by day, then by topic within the day. Repeat each day heading verbatim above its notes.`
    : `Extract the discussion as compact notes, grouped by topic.`;

  return `Below is part of the conversation from the WhatsApp group "${chatName}".
Each message is prefixed with its index like [12] and time.

${grouping}
For every topic give:
- a short topic title
- key points/decisions/questions, each with its supporting message indices [n]

Messages:
${chunkText}`;
}

export function reducePrompt(
  chatName: string,
  windowLabel: string,
  partials: string[],
  interests: string | null,
  perDay = false
): string {
  return `Merge the following partial notes (from consecutive parts of the same conversation in "${chatName}", ${windowLabel}) into ONE final digest.
${perDay ? `\n${DAY_RULE}\n` : ''}
Structure:
*📌 Overview* — 1-2 sentences on what the group talked about.
${dayStructure(perDay)}
*✅ Action items / decisions* — bullets, only if any exist.${interestsSection(interests)}

Keep every citation [n] from the notes that supports a point you include.

Partial notes:
${partials.map((p, i) => `--- part ${i + 1} ---\n${p}`).join('\n\n')}`;
}

export function singleShotPrompt(
  chatName: string,
  windowLabel: string,
  chunkText: string,
  interests: string | null,
  perDay = false
): string {
  return `Summarize this WhatsApp group conversation ("${chatName}", ${windowLabel}).
Each message is prefixed with its index like [12] and time.
${perDay ? `\n${DAY_RULE}\n` : ''}
Structure:
*📌 Overview* — 1-2 sentences on what the group talked about.
${dayStructure(perDay)}
*✅ Action items / decisions* — bullets, only if any exist.${interestsSection(interests)}

Messages:
${chunkText}`;
}

function interestsSection(interests: string | null): string {
  if (!interests) return '';
  return `\nThe reader specifically tracks these interests: "${interests}".
End the digest with a section "*🎯 Your topics*" containing ONLY items matching those interests (or "nothing this time" if none).`;
}
