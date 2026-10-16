#!/usr/bin/env node
/**
 * Validate src/metrics/rmssd.mjs against two independent references.
 *
 * Usage: node tools/validate-rmssd/run.mjs
 * Writes: evidence/rmssd-validation.json
 *
 * Cases are generated deterministically as integer RR intervals in 1/1024 s, the
 * unit delivered by the Bluetooth Heart Rate Measurement characteristic. The
 * JavaScript implementation receives them in milliseconds, exactly as the
 * production pipeline would.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rmssd } from '../../src/metrics/rmssd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; };
}
const toUnits = (ms) => Math.max(1, Math.round((ms * 1024) / 1000));

function cases() {
  const out = [];
  // 1. respiratory-modulated resting rhythm, 5 min
  { const u = []; let t = 0;
    while (t < 300) { const ms = 1000 + 55 * Math.sin(2 * Math.PI * 0.25 * t); u.push(toUnits(ms)); t += ms / 1000; }
    out.push({ name: 'rsa-modulated-rest-5min', rr_units: u }); }
  // 2. noisy physiological rhythm around 70 bpm
  { const r = lcg(7); const u = [];
    for (let i = 0; i < 400; i++) u.push(toUnits(857 + (r() - 0.5) * 120));
    out.push({ name: 'noisy-70bpm-400beats', rr_units: u }); }
  // 3. exercise-like low variability around 150 bpm
  { const r = lcg(11); const u = [];
    for (let i = 0; i < 600; i++) u.push(toUnits(400 + (r() - 0.5) * 12));
    out.push({ name: 'exercise-150bpm-600beats', rr_units: u }); }
  // 4. high variability, slow rhythm around 50 bpm
  { const r = lcg(23); const u = [];
    for (let i = 0; i < 300; i++) u.push(toUnits(1200 + (r() - 0.5) * 300));
    out.push({ name: 'high-variability-50bpm-300beats', rr_units: u }); }
  // 5. alternating, closed form: RMSSD equals the alternation step
  { const u = []; for (let i = 0; i < 200; i++) u.push(i % 2 ? 1024 + 51 : 1024);
    out.push({ name: 'alternating-closed-form', rr_units: u }); }
  return out;
}

const cs = cases();
const tmp = join(tmpdir(), 'rmssd-cases-' + process.pid + '.json');
writeFileSync(tmp, JSON.stringify(cs));

const py = execFileSync('python', ['-I', join(HERE, 'reference.py'), tmp], { encoding: 'utf8' });
const ref = JSON.parse(py);

const TOL = 1e-9; // relative
const rows = cs.map((c, i) => {
  const js = rmssd(c.rr_units.map((u) => (u * 1000) / 1024));
  const r = ref.results[i];
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
  return {
    name: c.name, beats: c.rr_units.length, js,
    numpy: r.numpy, relErrVsNumpy: rel(js, r.numpy),
    neurokit2: r.neurokit2 ?? null,
    relErrVsNeurokit2: r.neurokit2 != null ? rel(js, r.neurokit2) : null,
    neurokit2Error: r.neurokit2_error ?? null,
  };
});

const passNumpy = rows.every((r) => r.relErrVsNumpy < TOL);
const nkRows = rows.filter((r) => r.neurokit2 != null);
const passNk = nkRows.length === rows.length && nkRows.every((r) => r.relErrVsNeurokit2 < TOL);

const report = {
  metric: 'RMSSD',
  implementation: 'src/metrics/rmssd.mjs',
  definition: 'Task Force ESC/NASPE, Circulation 93(5):1043-1065, 1996',
  ranAt: new Date().toISOString(),
  environment: { node: process.version, python: ref.python, numpy: ref.numpy, neurokit2: ref.neurokit2 },
  toleranceRelative: TOL,
  verdict: {
    agreesWithNumpy: passNumpy,
    agreesWithNeurokit2: nkRows.length ? passNk : 'not run: neurokit2 unavailable',
  },
  scope: 'Validates that the implementation computes the published RMSSD definition correctly. '
    + 'It does NOT validate agreement with WHOOP-reported HRV, which is a windowed, preprocessed '
    + 'value; that requires authorized reference observations (blocker B3).',
  cases: rows,
};
mkdirSync(join(ROOT, 'evidence'), { recursive: true });
writeFileSync(join(ROOT, 'evidence', 'rmssd-validation.json'), JSON.stringify(report, null, 2) + '\n');

for (const r of rows) {
  console.log(`${r.name.padEnd(34)} n=${String(r.beats).padStart(3)}  js=${r.js.toFixed(9)}  `
    + `numpy=${r.numpy.toFixed(9)}  nk2=${r.neurokit2 == null ? 'n/a' : r.neurokit2.toFixed(9)}`);
}
console.log('');
console.log('agrees with numpy     ', passNumpy);
console.log('agrees with neurokit2 ', report.verdict.agreesWithNeurokit2);
console.log('neurokit2 version     ', ref.neurokit2);
process.exit(passNumpy && (nkRows.length ? passNk : true) ? 0 : 1);
