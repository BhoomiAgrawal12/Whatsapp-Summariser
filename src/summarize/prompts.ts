/**
 * All LLM prompts live here so tone/format changes never touch pipeline code.
 * Digests use WhatsApp text formatting (*bold*, _italic_) because they are
 * delivered into the user's own WhatsApp chat.
 */

export const SYSTEM_PROMPT = `You are a precise assistant that summarizes WhatsApp group conversations for one busy reader.
Rules:
- Be faithful to the messages; never invent facts.
- Cite supporting messages with their [n] index, e.g. "Dinner moved to 9pm [42]".
- Use WhatsApp formatting: *bold* for headers, "- " bullets. No markdown # headers, no tables.
- Write compactly; the reader wants to catch up in under a minute.`;

export function chunkMapPrompt(chatName: string, chunkText: string): string {
  return `Below is part of the conversation from the WhatsApp group "${chatName}".
Each message is prefixed with its index like [12] and time.

Extract the discussion as compact notes, grouped by topic. For every topic give:
- a short topic title
- key points/decisions/questions, each with its supporting message indices [n]

Messages:
${chunkText}`;
}

export function reducePrompt(
  chatName: string,
  windowLabel: string,
  partials: string[],
  interests: string | null
): string {
  const interestsSection = interests
    ? `\nThe reader specifically tracks these interests: "${interests}".
End the digest with a section "*🎯 Your topics*" containing ONLY items matching those interests (or "nothing this time" if none).`
    : '';

  return `Merge the following partial notes (from consecutive parts of the same conversation in "${chatName}", ${windowLabel}) into ONE final digest.

Structure:
*📌 Overview* — 1-2 sentences on what the group talked about.
*🧵 Topics* — one short block per topic: title in *bold*, then "- " bullets with the key points, decisions and open questions. Keep message citations [n].
*✅ Action items / decisions* — bullets, only if any exist.${interestsSection}

Keep every citation [n] from the notes that supports a point you include.

Partial notes:
${partials.map((p, i) => `--- part ${i + 1} ---\n${p}`).join('\n\n')}`;
}

export function singleShotPrompt(
  chatName: string,
  windowLabel: string,
  chunkText: string,
  interests: string | null
): string {
  const interestsSection = interests
    ? `\nThe reader specifically tracks these interests: "${interests}".
End the digest with a section "*🎯 Your topics*" containing ONLY items matching those interests (or "nothing this time" if none).`
    : '';

  return `Summarize this WhatsApp group conversation ("${chatName}", ${windowLabel}).
Each message is prefixed with its index like [12] and time.

Structure:
*📌 Overview* — 1-2 sentences on what the group talked about.
*🧵 Topics* — one short block per topic: title in *bold*, then "- " bullets with the key points, decisions and open questions. Cite supporting messages [n].
*✅ Action items / decisions* — bullets, only if any exist.${interestsSection}

Messages:
${chunkText}`;
}
