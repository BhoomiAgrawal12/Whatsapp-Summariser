import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function apiVersionIn(relativePath: string): number {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  const match = /^const API_VERSION = (\d+);/m.exec(source);
  assert.ok(match, `no API_VERSION declaration found in ${relativePath}`);
  return Number(match[1]);
}

describe('dashboard/server API version', () => {
  it('is declared identically on both sides', () => {
    // The server keeps the routes it booted with while the HTML is re-read from
    // disk, so the dashboard checks this number to tell the user to restart
    // rather than failing with a bare "not found". If the two drift, that check
    // either never fires or fires forever.
    const server = apiVersionIn('src/web/server.ts');
    const client = apiVersionIn('src/web/public/index.html');
    assert.equal(
      client,
      server,
      'API_VERSION in src/web/public/index.html must match src/web/server.ts — ' +
        'bump both when adding an endpoint the dashboard depends on'
    );
  });
});
