import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  llmProvider: 'openai' | 'ollama';
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  ollamaUrl: string;
  ollamaModel: string;
  dashboardPort: number;
  /** 127.0.0.1 by default; 0.0.0.0 exposes the (unauthenticated) dashboard on the LAN. */
  dashboardHost: string;
  /**
   * Base URL the dashboard is reachable at *from the user's phone*, e.g.
   * "http://192.168.1.20:8790". Citation footers in WhatsApp-delivered digests
   * link to `<publicUrl>/m/<messageId>`; empty disables those links.
   */
  publicUrl: string;
  dataDir: string;
  authDir: string;
  logLevel: string;
}

/** Load KEY=VALUE pairs from .env into process.env (existing env vars win). */
function loadDotEnv(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

export function loadConfig(cwd: string = process.cwd()): AppConfig {
  loadDotEnv(cwd);

  const provider = env('LLM_PROVIDER', 'openai');
  if (provider !== 'openai' && provider !== 'ollama') {
    throw new Error(`LLM_PROVIDER must be "openai" or "ollama", got "${provider}"`);
  }

  const config: AppConfig = {
    llmProvider: provider,
    openaiApiKey: env('OPENAI_API_KEY', ''),
    openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
    openaiBaseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
    ollamaModel: env('OLLAMA_MODEL', 'llama3.1:8b'),
    dashboardPort: Number(env('DASHBOARD_PORT', '8790')),
    dashboardHost: env('DASHBOARD_HOST', '127.0.0.1'),
    publicUrl: env('PUBLIC_URL', '').replace(/\/+$/, ''),
    dataDir: path.resolve(cwd, env('DATA_DIR', './data')),
    authDir: path.resolve(cwd, 'auth'),
    logLevel: env('LOG_LEVEL', 'info'),
  };

  if (config.llmProvider === 'openai' && !config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai (see .env.example)');
  }
  return config;
}
