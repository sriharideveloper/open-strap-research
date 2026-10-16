import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enforces the promotion rule mechanically rather than by convention:
// production code in src/ may never import patent-derived code from experimental/.
// If someone wires a candidate into production, this fails before review does.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.mjs') || p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('src/ never imports from experimental/', () => {
  const offenders = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const imports = [...text.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1] ?? m[2]);
    for (const spec of imports) {
      if (/(^|\/)experimental\//.test(spec)) offenders.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, [], 'production code imports experimental code:\n' + offenders.join('\n'));
});

test('every experimental module declares its provenance or opt-in status', (t) => {
  const dir = join(ROOT, 'experimental', 'patent-candidates');
  // A public export may omit experimental/ entirely; that is fine, not a failure.
  try { statSync(dir); } catch { t.skip('experimental/ not present in this checkout'); return; }
  for (const file of walk(dir)) {
    if (file.endsWith('.test.mjs')) continue;
    const text = readFileSync(file, 'utf8');
    assert.match(text, /NOT PRODUCTION|CANDIDATE/, `${file} lacks a candidate/not-production marker`);
  }
});
