import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

/** A syntactically valid, obviously fake project key of realistic length. */
const FAKE_KEY = 'sk-proj-' + 'a'.repeat(156);

describe('config loading', () => {
  let dir: string;
  /** Env vars each test may set; restored afterwards so tests cannot leak into each other. */
  const MANAGED = ['OPENAI_API_KEY', 'LLM_PROVIDER', 'OPENAI_MODEL', 'PUBLIC_URL', 'DASHBOARD_HOST'];
  let saved: Record<string, string | undefined>;

  const write = async (contents: string): Promise<void> =>
    writeFile(path.join(dir, '.env'), contents, 'utf8');

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wa-config-'));
    saved = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]));
    for (const k of MANAGED) delete process.env[k];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a plain key', async () => {
    await write(`OPENAI_API_KEY=${FAKE_KEY}\n`);
    const config = loadConfig(dir);
    assert.equal(config.openaiApiKey, FAKE_KEY);
    assert.deepEqual(config.warnings, []);
    assert.deepEqual(config.credentialShape, { prefix: 'sk-proj-', length: FAKE_KEY.length });
  });

  it('strips surrounding double and single quotes', async () => {
    await write(`OPENAI_API_KEY="${FAKE_KEY}"\n`);
    assert.equal(loadConfig(dir).openaiApiKey, FAKE_KEY);

    delete process.env.OPENAI_API_KEY;
    await write(`OPENAI_API_KEY='${FAKE_KEY}'\n`);
    assert.equal(loadConfig(dir).openaiApiKey, FAKE_KEY);
  });

  it('strips a trailing comment and surrounding spaces', async () => {
    await write(`OPENAI_API_KEY = ${FAKE_KEY}   # production key\n`);
    assert.equal(loadConfig(dir).openaiApiKey, FAKE_KEY);
  });

  it('accepts an "export" prefix and CRLF line endings', async () => {
    await write(`export LLM_PROVIDER=openai\r\nexport OPENAI_API_KEY=${FAKE_KEY}\r\n`);
    const config = loadConfig(dir);
    assert.equal(config.openaiApiKey, FAKE_KEY);
    assert.equal(config.llmProvider, 'openai');
  });

  it('uses the LAST definition when a key is repeated, and says so', async () => {
    const stale = 'sk-' + 'b'.repeat(48);
    await write(`OPENAI_API_KEY=${stale}\nOPENAI_API_KEY=${FAKE_KEY}\n`);
    const config = loadConfig(dir);
    // Appending a fresh key below an old one is the common way people rotate it.
    assert.equal(config.openaiApiKey, FAKE_KEY);
    assert.equal(config.warnings.length, 1);
    assert.match(config.warnings[0]!, /OPENAI_API_KEY is defined more than once; using the one on line 2/);
  });

  it('warns when a shell variable shadows the file', async () => {
    process.env.OPENAI_API_KEY = FAKE_KEY;
    await write(`OPENAI_API_KEY=sk-proj-${'c'.repeat(156)}\n`);
    const config = loadConfig(dir);
    assert.equal(config.openaiApiKey, FAKE_KEY, 'the environment must still win');
    assert.match(config.warnings[0]!, /environment wins, so the file's value is being IGNORED/);
    assert.match(config.warnings[0]!, /unset OPENAI_API_KEY/);
  });

  it('warns about a value wrapped onto a second line', async () => {
    // An editor hard-wrapping a long secret: the first line is what gets used.
    await write(`OPENAI_API_KEY=sk-proj-${'d'.repeat(60)}\n${'e'.repeat(96)}\n`);
    const config = loadConfig(dir);
    assert.equal(config.warnings.length, 1);
    assert.match(config.warnings[0]!, /line 2 has no "="/);
    assert.match(config.warnings[0]!, /TRUNCATED/);
  });

  it('rejects a key containing whitespace', async () => {
    await write(`OPENAI_API_KEY="sk-proj-${'f'.repeat(80)} ${'g'.repeat(76)}"\n`);
    assert.throws(() => loadConfig(dir), /contains a space or line break/);
  });

  it('rejects a truncated key with its actual length', async () => {
    await write(`OPENAI_API_KEY=sk-proj-abc123\n`);
    assert.throws(() => loadConfig(dir), /only 14 characters — it is truncated/);
  });

  it('rejects a key that is not an OpenAI key at all', async () => {
    await write(`OPENAI_API_KEY=${'x'.repeat(60)}\n`);
    assert.throws(() => loadConfig(dir), /does not start with "sk-"/);
  });

  it('does not require an OpenAI key when using ollama', async () => {
    await write('LLM_PROVIDER=ollama\n');
    const config = loadConfig(dir);
    assert.equal(config.llmProvider, 'ollama');
    assert.equal(config.credentialShape, null);
  });

  it('trims a trailing slash from PUBLIC_URL', async () => {
    await write(`LLM_PROVIDER=ollama\nPUBLIC_URL=http://192.168.1.5:8790/\n`);
    assert.equal(loadConfig(dir).publicUrl, 'http://192.168.1.5:8790');
  });
});
