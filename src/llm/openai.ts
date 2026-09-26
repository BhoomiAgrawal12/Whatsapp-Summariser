import type { LlmProvider } from '../types.js';

interface ChatCompletionResponse {
  choices: { message: { content: string | null } }[];
}

/** OpenAI Chat Completions driver (plain fetch — no SDK dependency). */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string
  ) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `OpenAI request failed (${res.status}): ${body.slice(0, 500)}${this.hint(res.status)}`
      );
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices[0]?.message.content;
    if (!text) throw new Error('OpenAI returned an empty completion');
    return text;
  }

  /**
   * Turn the common HTTP failures into something actionable. A 401 in particular
   * says nothing about *which* key was used, which is the whole question — so
   * report the key's non-secret shape (type prefix + length) to compare against
   * the one in the OpenAI dashboard.
   */
  private hint(status: number): string {
    if (status === 401) {
      const prefix = /^sk-(proj|svcacct|admin)-/.exec(this.apiKey)?.[0] ?? 'sk-';
      return (
        `\n\nOpenAI rejected the key this app sent: type "${prefix}", ${this.apiKey.length} characters.` +
        `\nA full key is ~51 chars (sk-…) or ~164 chars (sk-proj-…) — a much shorter one is truncated.` +
        `\nCheck OPENAI_API_KEY in your .env: one line, no quotes, no trailing spaces, defined only once.` +
        `\nThe startup log prints the same shape, and warns if a shell variable is shadowing the file.`
      );
    }
    if (status === 429) {
      return '\n\nRate limited or out of quota — check your billing at https://platform.openai.com/usage.';
    }
    if (status === 404) {
      return `\n\nModel "${this.model}" is not available to this key. Set OPENAI_MODEL to one you have access to.`;
    }
    return '';
  }
}
