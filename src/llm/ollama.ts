import type { LlmProvider } from '../types.js';

interface OllamaChatResponse {
  message: { content: string };
}

/** Local Ollama driver — free and fully private, weaker than API models. */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';

  constructor(
    private readonly url: string,
    private readonly model: string
  ) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    if (!data.message.content) throw new Error('Ollama returned an empty completion');
    return data.message.content;
  }
}
