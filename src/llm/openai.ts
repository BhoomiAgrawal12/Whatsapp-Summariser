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
      throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices[0]?.message.content;
    if (!text) throw new Error('OpenAI returned an empty completion');
    return text;
  }
}
