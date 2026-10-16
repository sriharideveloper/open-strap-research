#!/usr/bin/env node
/**
 * End-to-end demonstration: BLE notification bytes -> parsed -> persisted ->
 * integrity-checked -> read back -> daily summary.
 *
 * USES FIXTURE DATA, NOT A BAND. Every row is written with source = 'fixture',
 * so nothing produced here can later be mistaken for real device data. The bytes
 * are spec-conformant Heart Rate Measurement (0x2A37) notifications constructed
 * for this demo; no WHOOP band was available when this was written.
 *
 * Usage:  node tools/demo-end-to-end.mjs [path/to/db]
 *         default database: data/demo.db  (gitignored)
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  openStore, ingestHeartRateMeasurement, readObservations, verifyIntegrity, OBSERVATION_SOURCE,
} from '../src/store/observation-store.mjs';
import { rrSeries, heartRateSeries, userProfile } from '../src/model/records.mjs';
import { buildDailySummary } from '../src/pipeline/daily-summary.mjs';
import { isMeasurement } from '../src/model/measurement.mjs';

const dbPath = process.argv[2] ?? 'data/demo.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = openStore(dbPath);

// 1. Synthesize five minutes of notifications: ~1 s apart, HR + one RR each,
//    with breathing-rate modulation at 15 breaths/min so RSA has something to find.
const start = Date.parse('2026-10-16T06:00:00-04:00');
let t = 0;
let ingested = 0;
let duplicates = 0;
while (t < 300) {
  const rrMs = 1000 + 55 * Math.sin(2 * Math.PI * (15 / 60) * t);
  const rrUnits = Math.round((rrMs * 1024) / 1000);
  const bpm = Math.round(60000 / rrMs);
  // flags 0x16 = sensor contact supported + detected, RR present, UINT8 HR
  const payload = [0x16, bpm, rrUnits & 0xff, (rrUnits >> 8) & 0xff];
  const at = new Date(start + t * 1000).toISOString().replace('Z', '+00:00');
  const r = ingestHeartRateMeasurement(db, {
    source: OBSERVATION_SOURCE.FIXTURE, deviceAddress: 'fixture:demo', receivedAt: at, payload,
  });
  if (r.inserted) ingested++; else duplicates++;
  t += rrMs / 1000;
}

// 2. Re-ingesting is idempotent: replay the first notification.
const rows = readObservations(db, { deviceAddress: 'fixture:demo' });
const replay = ingestHeartRateMeasurement(db, {
  source: OBSERVATION_SOURCE.FIXTURE, deviceAddress: 'fixture:demo',
  receivedAt: rows[0].received_at, payload: Buffer.from(rows[0].raw_hex, 'hex'),
});

// 3. Integrity: re-derive every row from its stored raw bytes.
const integrity = verifyIntegrity(db);

// 4. Build records from what was persisted, and run the production pipeline.
const all = readObservations(db, { deviceAddress: 'fixture:demo' });
const rr = rrSeries({ startedAt: all[0].received_at, rrMs: all.flatMap((r) => r.rr_ms) });
const hr = heartRateSeries({ startedAt: all[0].received_at, sampleSeconds: 1, bpm: all.map((r) => r.hr_bpm) });
const summary = buildDailySummary({
  profile: userProfile({ restingHr: 55, maxHr: 190 }), rr, hr, date: '2026-10-16',
});

const show = (m) => (isMeasurement(m)
  ? `${m.value.toFixed(2)} ${m.unit}  [${m.provenance.confidence}, ${m.provenance.method} v${m.provenance.algorithmVersion}]`
  : `UNAVAILABLE - ${m.reason}`);

console.log(`database            ${dbPath}`);
console.log(`notifications       ${ingested} ingested, ${duplicates} duplicate(s) skipped`);
console.log(`replay of row 1     inserted=${replay.inserted} (expected false: idempotent)`);
console.log(`integrity           ${integrity.checked} rows checked, ${integrity.mismatches.length} mismatch(es)`);
console.log(`source of all rows  ${[...new Set(all.map((r) => r.source))].join(', ')}`);
console.log('');
for (const [k, v] of Object.entries(summary.metrics)) console.log(`${k.padEnd(20)}${show(v)}`);
console.log('');
console.log(`coverage            ${summary.coverage.available}/${summary.coverage.total} metrics available`);
db.close();
