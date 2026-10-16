/**
 * Durable, idempotent store for raw device observations.
 *
 * Uses Node's built-in node:sqlite, so there are no dependencies.
 *
 * Spec section 9 requires preserving original values, timestamps, units and
 * source metadata, and synchronization that is idempotent and resistant to
 * duplicates. So:
 *   - the original payload bytes are stored verbatim (raw_hex) next to the
 *     parsed fields, and the parser version is recorded, so a parser bug can be
 *     fixed later and every observation re-derived from its raw bytes;
 *   - timestamps are stored as ISO 8601 with offset AND as epoch milliseconds;
 *   - a uniqueness constraint makes re-ingesting the same notification a no-op;
 *   - the `source` column distinguishes real device data from test fixtures, so
 *     fixture rows can never be mistaken for band data.
 */

import { DatabaseSync } from 'node:sqlite';
import { instant } from '../model/measurement.mjs';
import {
  parseHeartRateMeasurement, toHex, fromHex, PARSER_VERSION, HEART_RATE_MEASUREMENT_UUID,
} from '../ble/heart-rate-measurement.mjs';

export const STORE_SCHEMA_VERSION = 1;

/** Where an observation came from. 'fixture' rows are synthetic, never real data. */
export const OBSERVATION_SOURCE = Object.freeze({ DEVICE: 'device', FIXTURE: 'fixture' });
const SOURCES = new Set(Object.values(OBSERVATION_SOURCE));

export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source              TEXT    NOT NULL CHECK (source IN ('device','fixture')),
      device_address      TEXT    NOT NULL,
      device_model     TEXT    NOT NULL,
      characteristic_uuid TEXT    NOT NULL,
      received_at         TEXT    NOT NULL,
      received_epoch_ms   INTEGER NOT NULL,
      raw_hex             TEXT    NOT NULL,
      parser_version      TEXT    NOT NULL,
      hr_bpm              INTEGER,
      energy_kj           INTEGER,
      rr_ms_json          TEXT,
      sensor_contact      TEXT,
      UNIQUE (device_address, received_epoch_ms, raw_hex)
    );
    CREATE INDEX IF NOT EXISTS obs_time ON observations (device_address, received_epoch_ms);
  `);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(STORE_SCHEMA_VERSION));
  return db;
}

/**
 * Parse and persist one Heart Rate Measurement notification.
 * @returns {{inserted:boolean, id:number|null, parsed:object}}
 */
export function ingestHeartRateMeasurement(db, {
  source, deviceAddress, deviceModel = 'unknown', receivedAt, payload,
}) {
  if (!SOURCES.has(source)) throw new RangeError('source must be device or fixture');
  if (typeof deviceAddress !== 'string' || !deviceAddress) throw new TypeError('deviceAddress is required');
  const t = instant(receivedAt); // rejects timestamps without an offset
  // Parse the ORIGINAL payload first: converting to Uint8Array beforehand would
  // silently wrap out-of-range values and bypass the parser's byte validation.
  const parsed = parseHeartRateMeasurement(payload); // throws on malformed input, before anything is written
  const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);

  const r = db.prepare(`
    INSERT OR IGNORE INTO observations
      (source, device_address, device_model, characteristic_uuid, received_at, received_epoch_ms,
       raw_hex, parser_version, hr_bpm, energy_kj, rr_ms_json, sensor_contact)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source, deviceAddress, deviceModel, HEART_RATE_MEASUREMENT_UUID, t.iso, t.epochMs,
    toHex(bytes), PARSER_VERSION, parsed.heartRateBpm, parsed.energyExpendedKj,
    JSON.stringify(parsed.rrMs), parsed.sensorContact,
  );
  const inserted = Number(r.changes) === 1;
  return { inserted, id: inserted ? Number(r.lastInsertRowid) : null, parsed };
}

/** Read observations back, oldest first. */
export function readObservations(db, { deviceAddress, source } = {}) {
  const where = [];
  const args = [];
  if (deviceAddress) { where.push('device_address = ?'); args.push(deviceAddress); }
  if (source) { where.push('source = ?'); args.push(source); }
  const sql = 'SELECT * FROM observations' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY received_epoch_ms, id';
  return db.prepare(sql).all(...args).map((row) => ({ ...row, rr_ms: JSON.parse(row.rr_ms_json ?? '[]') }));
}

/**
 * Re-derive parsed fields from stored raw bytes and report any row whose stored
 * parse no longer matches. This is what preserving raw_hex buys: integrity can be
 * checked, and a fixed parser can be re-applied, without re-collecting data.
 */
export function verifyIntegrity(db) {
  const mismatches = [];
  for (const row of db.prepare('SELECT * FROM observations').all()) {
    const p = parseHeartRateMeasurement(fromHex(row.raw_hex));
    const same = p.heartRateBpm === row.hr_bpm
      && (p.energyExpendedKj ?? null) === (row.energy_kj ?? null)
      && JSON.stringify(p.rrMs) === row.rr_ms_json
      && p.sensorContact === row.sensor_contact;
    if (!same) mismatches.push(row.id);
  }
  return { checked: db.prepare('SELECT COUNT(*) c FROM observations').get().c, mismatches };
}
