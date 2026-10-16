import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHeartRateMeasurement, toHex, fromHex, RR_UNITS_PER_SECOND,
} from '../src/ble/heart-rate-measurement.mjs';
import {
  openStore, ingestHeartRateMeasurement, readObservations, verifyIntegrity, OBSERVATION_SOURCE,
} from '../src/store/observation-store.mjs';

// Test vectors are constructed from the Heart Rate Measurement field layout in the
// Bluetooth SIG GATT Specification Supplement. None of them came from a WHOOP band.

// ---- parser ----

test('hrm: UINT8 heart rate, no optional fields', () => {
  const p = parseHeartRateMeasurement([0x00, 0x48]);
  assert.equal(p.heartRateBpm, 72);
  assert.equal(p.heartRateFormat, 'uint8');
  assert.equal(p.sensorContact, 'unsupported');
  assert.equal(p.energyExpendedKj, null);
  assert.deepEqual(p.rrMs, []);
});

test('hrm: UINT16 heart rate is little-endian', () => {
  assert.equal(parseHeartRateMeasurement([0x01, 0x48, 0x00]).heartRateBpm, 72);
  assert.equal(parseHeartRateMeasurement([0x01, 0x2c, 0x01]).heartRateBpm, 300); // 0x012C
});

test('hrm: sensor contact states', () => {
  assert.equal(parseHeartRateMeasurement([0x06, 60]).sensorContact, 'detected');      // bits 1,2
  assert.equal(parseHeartRateMeasurement([0x04, 60]).sensorContact, 'not-detected');  // bit 2 only
  assert.equal(parseHeartRateMeasurement([0x02, 60]).sensorContact, 'unsupported');   // bit 1 without 2
});

test('hrm: energy expended field', () => {
  assert.equal(parseHeartRateMeasurement([0x08, 0x48, 0x10, 0x00]).energyExpendedKj, 16);
});

test('hrm: RR intervals convert from 1/1024 s exactly', () => {
  // 1024 units = exactly one second = 1000 ms
  const p = parseHeartRateMeasurement([0x10, 0x3c, 0x00, 0x04, 0x00, 0x04]);
  assert.equal(p.heartRateBpm, 60);
  assert.deepEqual(p.rrRaw, [1024, 1024]);
  assert.deepEqual(p.rrMs, [1000, 1000]);
  assert.equal(RR_UNITS_PER_SECOND, 1024);
});

test('hrm: all fields together, in order', () => {
  // flags 0x1F: uint16 HR, contact supported+detected, energy, RR
  const p = parseHeartRateMeasurement([0x1f, 0x50, 0x00, 0x20, 0x00, 0x00, 0x03]);
  assert.equal(p.heartRateBpm, 80);
  assert.equal(p.sensorContact, 'detected');
  assert.equal(p.energyExpendedKj, 32);
  assert.deepEqual(p.rrRaw, [768]);
  assert.equal(p.rrMs[0], 750); // 768 * 1000 / 1024
});

test('hrm: malformed payloads are rejected, not guessed at', () => {
  assert.throws(() => parseHeartRateMeasurement([0x00]), RangeError);                 // no HR byte
  assert.throws(() => parseHeartRateMeasurement([0x01, 0x48]), RangeError);           // UINT16 truncated
  assert.throws(() => parseHeartRateMeasurement([0x08, 0x48, 0x10]), RangeError);     // energy truncated
  assert.throws(() => parseHeartRateMeasurement([0x10, 0x48]), RangeError);           // RR flag, no RR
  assert.throws(() => parseHeartRateMeasurement([0x10, 0x48, 0x00]), RangeError);     // odd RR bytes
  assert.throws(() => parseHeartRateMeasurement([0x00, 0x48, 0x99]), RangeError);     // trailing bytes
  assert.throws(() => parseHeartRateMeasurement([0x00, 256]), RangeError);            // not a byte
});

test('hrm: reserved flag bits are surfaced, not silently dropped', () => {
  assert.equal(parseHeartRateMeasurement([0xe0, 60]).reservedFlagBits, 0xe0);
});

test('hex round-trips exactly', () => {
  const bytes = Uint8Array.from([0x1f, 0x50, 0x00, 0xff, 0x0a]);
  assert.deepEqual(fromHex(toHex(bytes)), bytes);
  assert.throws(() => fromHex('abc'), RangeError);
  assert.throws(() => fromHex('zz'), RangeError);
});

// ---- store ----

const FIX = {
  source: OBSERVATION_SOURCE.FIXTURE, deviceAddress: 'fixture:00:00:00:00:00:01',
  deviceModel: 'unknown', receivedAt: '2026-10-16T09:00:00-04:00',
  payload: [0x16, 0x48, 0x00, 0x04],
};

test('store: persists parsed fields and the original bytes', () => {
  const db = openStore();
  const r = ingestHeartRateMeasurement(db, FIX);
  assert.equal(r.inserted, true);
  const [row] = readObservations(db);
  assert.equal(row.hr_bpm, 72);
  assert.equal(row.raw_hex, '16480004');
  assert.deepEqual(row.rr_ms, [1000]);
  assert.equal(row.sensor_contact, 'detected');
  assert.equal(row.received_at, '2026-10-16T09:00:00-04:00');
  assert.equal(row.source, 'fixture');
  assert.ok(row.parser_version);
});

test('store: re-ingesting the same notification is a no-op', () => {
  const db = openStore();
  assert.equal(ingestHeartRateMeasurement(db, FIX).inserted, true);
  assert.equal(ingestHeartRateMeasurement(db, FIX).inserted, false);
  assert.equal(readObservations(db).length, 1);
});

test('store: out-of-order arrival is read back in time order', () => {
  const db = openStore();
  ingestHeartRateMeasurement(db, { ...FIX, receivedAt: '2026-10-16T09:00:02-04:00', payload: [0x00, 62] });
  ingestHeartRateMeasurement(db, { ...FIX, receivedAt: '2026-10-16T09:00:00-04:00', payload: [0x00, 60] });
  ingestHeartRateMeasurement(db, { ...FIX, receivedAt: '2026-10-16T09:00:01-04:00', payload: [0x00, 61] });
  assert.deepEqual(readObservations(db).map((r) => r.hr_bpm), [60, 61, 62]);
});

test('store: a timestamp without an offset is refused', () => {
  const db = openStore();
  assert.throws(() => ingestHeartRateMeasurement(db, { ...FIX, receivedAt: '2026-10-16T09:00:00' }), RangeError);
  assert.equal(readObservations(db).length, 0);
});

test('store: a malformed payload writes nothing', () => {
  const db = openStore();
  assert.throws(() => ingestHeartRateMeasurement(db, { ...FIX, payload: [0x10, 0x48] }), RangeError);
  assert.equal(readObservations(db).length, 0);
});

test('store: an out-of-range byte is refused, not wrapped to a plausible value', () => {
  // Uint8Array.from([0x00, 256]) would become [0x00, 0x00] - a "valid" 0 bpm row.
  const db = openStore();
  assert.throws(() => ingestHeartRateMeasurement(db, { ...FIX, payload: [0x00, 256] }), RangeError);
  assert.equal(readObservations(db).length, 0);
});

test('store: fixture rows are separable from device rows', () => {
  const db = openStore();
  ingestHeartRateMeasurement(db, FIX);
  assert.equal(readObservations(db, { source: 'device' }).length, 0);
  assert.equal(readObservations(db, { source: 'fixture' }).length, 1);
  assert.throws(() => ingestHeartRateMeasurement(db, { ...FIX, source: 'guess' }), RangeError);
});

test('store: integrity check re-derives from raw bytes and catches tampering', () => {
  const db = openStore();
  ingestHeartRateMeasurement(db, FIX);
  assert.deepEqual(verifyIntegrity(db), { checked: 1, mismatches: [] });
  db.prepare('UPDATE observations SET hr_bpm = 999').run();
  const v = verifyIntegrity(db);
  assert.equal(v.mismatches.length, 1, 'a parsed field that disagrees with its raw bytes must be reported');
});

test('store: schema rejects an invalid source at the database layer too', () => {
  const db = openStore();
  assert.throws(() => db.prepare(`INSERT INTO observations
    (source, device_address, device_model, characteristic_uuid, received_at, received_epoch_ms, raw_hex, parser_version)
    VALUES ('made-up','a','b','c','d',1,'00','1')`).run());
});
