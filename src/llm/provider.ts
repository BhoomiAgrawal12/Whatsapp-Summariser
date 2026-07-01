import type { AppConfig } from '../config.js';
import type { LlmProvider } from '../types.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiProvider } from './openai.js';

export function createProvider(config: AppConfig): LlmProvider {
  if (config.llmProvider === 'ollama') {
    return new OllamaProvider(config.ollamaUrl, config.ollamaModel);
  }
  return new OpenAiProvider(config.openaiApiKey, config.openaiModel, config.openaiBaseUrl);
}
