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
  /**
   * Problems found while loading configuration that are not fatal but very
   * likely wrong (a shadowed or duplicated key, a wrapped value). Logged at
   * startup by `index.ts` — never silently swallowed.
   */
  warnings: string[];
  /**
   * Non-secret description of the credential in use, e.g.
   * `{ prefix: 'sk-proj-', length: 164 }`. Logged so a rejected key can be
   * compared against the one in the provider's dashboard without printing it.
   */
  credentialShape: { prefix: string; length: number } | null;
}

/**
 * Load KEY=VALUE pairs from the dotenv file into process.env.
 *
 * A real environment variable still wins over the file (needed for systemd /
 * Docker / CI), but every case where the file's value is NOT what ends up being
 * used gets reported — a silently-wrong secret is painful to debug, because the
 * request just fails with 401 while the file looks perfectly correct.
 *
 * Handles what people actually write in these files:
 *   KEY=value          KEY = value         export KEY=value
 *   KEY="value"        KEY='value'         KEY=value  # trailing comment
 * plus CRLF line endings.
 *
 * @returns human-readable warnings about anything suspicious in the file.
 */
function loadDotEnv(cwd: string): string[] {
  const filePath = path.join(cwd, '.env');
  if (!existsSync(filePath)) return [];

  const warnings: string[] = [];
  const seen = new Set<string>();
  // Snapshot what the real environment had BEFORE we touch it. Without this,
  // the shadowing check below would see this loader's own write from an earlier
  // line and refuse to overwrite it — making the FIRST of two duplicate
  // definitions win, which is the opposite of what appending a new key means.
  const preExisting = new Set(Object.keys(process.env));

  readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const lineNo = index + 1;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const eq = trimmed.indexOf('=');
      if (eq <= 0) {
        // A non-comment line with no "=". The usual cause is a long secret that
        // wrapped onto a second line — which means the value ABOVE it is
        // truncated, and a truncated key looks exactly like an invalid one.
        warnings.push(
          `line ${lineNo} has no "=" (${trimmed.length} chars). If a long value wrapped onto ` +
            `this line, the value above it is TRUNCATED — keep each KEY=VALUE on a single line.`
        );
        return;
      }

      const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
      const value = parseValue(trimmed.slice(eq + 1));

      if (seen.has(key)) {
        // Last definition wins below, which is what appending a fresh key implies.
        warnings.push(`${key} is defined more than once; using the one on line ${lineNo}.`);
      }
      seen.add(key);

      if (preExisting.has(key) && process.env[key] !== value) {
        warnings.push(
          `${key} is set both in the environment and in the file, with different values. ` +
            `The environment wins, so the file's value is being IGNORED — run \`unset ${key}\` ` +
            `(or remove it from your shell profile) to use the file.`
        );
        return;
      }
      process.env[key] = value;
    });

  return warnings;
}

/** Strip surrounding quotes and any unquoted trailing comment from a raw value. */
function parseValue(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.length > 1 && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    // Only double quotes carry escapes, matching shell and dotenv conventions.
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner;
  }
  // Unquoted: whitespace followed by "#" starts a comment. A bare "#" does not,
  // since it is a legal character inside a value.
  return trimmed.split(/\s+#/)[0]!.trim();
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

/**
 * Reject a credential that cannot possibly work, with a message that names the
 * actual defect. Returns a non-secret shape summary for logging.
 *
 * Deliberately not length-strict: OpenAI has shipped several key formats and
 * will ship more. Only shapes that are certainly broken are rejected.
 */
function inspectApiKey(key: string): { prefix: string; length: number } {
  if (/\s/.test(key)) {
    throw new Error(
      'OPENAI_API_KEY contains a space or line break. The value was probably pasted across ' +
        'two lines, or wrapped by an editor — put the whole key on one line, unquoted.'
    );
  }
  if (key.startsWith('"') || key.startsWith("'")) {
    throw new Error('OPENAI_API_KEY still has a quote character in it — remove the quotes.');
  }
  if (!key.startsWith('sk-')) {
    throw new Error(
      `OPENAI_API_KEY does not start with "sk-" (it starts with "${key.slice(0, 4)}"). ` +
        'Copy the key from https://platform.openai.com/api-keys.'
    );
  }
  if (key.length < 40) {
    throw new Error(
      `OPENAI_API_KEY is only ${key.length} characters — it is truncated. A full key is ~51 ` +
        '(sk-…) or ~164 (sk-proj-…) characters. Re-copy it; keys are shown once, so if you ' +
        'no longer have it, create a new one.'
    );
  }
  // The prefix identifies the key TYPE and is identical for every key of that
  // type, so it is safe to log; it lets a rejected key be compared to the
  // dashboard without ever printing the secret.
  const prefix = /^sk-(proj|svcacct|admin)-/.exec(key)?.[0] ?? 'sk-';
  return { prefix, length: key.length };
}

export function loadConfig(cwd: string = process.cwd()): AppConfig {
  const warnings = loadDotEnv(cwd);

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
    warnings,
    credentialShape: null,
  };

  if (config.llmProvider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai (see .env.example)');
    }
    config.credentialShape = inspectApiKey(config.openaiApiKey);
  }
  return config;
}
