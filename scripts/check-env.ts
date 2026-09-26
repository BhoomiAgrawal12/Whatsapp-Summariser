/**
 * Config doctor: `npm run check-env`
 *
 * Loads configuration exactly the way the app does and reports what it got,
 * WITHOUT printing any secret. Use this when a provider rejects a credential —
 * it answers "which value is actually being used, and is it well-formed?",
 * which the provider's 401 cannot tell you.
 *
 * Output is safe to paste into a bug report or share with someone helping you:
 * secrets are reduced to a type prefix and a character count.
 */

import { loadConfig } from '../src/config.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('✕ Configuration is invalid:\n');
    console.error(`  ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  console.log('Configuration loaded\n');
  console.log(`  LLM provider     ${config.llmProvider}`);
  if (config.llmProvider === 'openai') {
    const shape = config.credentialShape;
    console.log(`  OpenAI key       type "${shape?.prefix}", ${shape?.length} characters`);
    console.log(`  OpenAI model     ${config.openaiModel}`);
    console.log(`  OpenAI base URL  ${config.openaiBaseUrl}`);
    console.log('\n  Expected key length: ~51 for sk-…, ~164 for sk-proj-…');
    console.log('  A much shorter key is truncated — re-copy it from');
    console.log('  https://platform.openai.com/api-keys (keys are shown only once).');
  } else {
    console.log(`  Ollama           ${config.ollamaModel} at ${config.ollamaUrl}`);
  }
  console.log(`\n  Dashboard        http://${config.dashboardHost}:${config.dashboardPort}`);
  console.log(`  Public URL       ${config.publicUrl || '(not set — citations in WhatsApp have no links)'}`);
  console.log(`  Data directory   ${config.dataDir}`);

  if (config.warnings.length > 0) {
    console.log(`\n⚠  ${config.warnings.length} problem(s) that likely explain a wrong value:\n`);
    for (const warning of config.warnings) console.log(`  • ${warning}`);
    console.log('');
    process.exit(1);
  }
  console.log('\n✓ No configuration problems detected.');
  console.log('  If the key is still rejected, it is wrong or revoked at the provider —');
  console.log('  create a new one and make sure it is on a single unquoted line.\n');
}

main();
