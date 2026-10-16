# open-strap-research

**An independent, open-source research toolkit for working with wearable heart-rate data — built while investigating interoperability with WHOOP® bands.**
Standard Bluetooth heart-rate parsing, an idempotent local observation store, and a tested library of published HRV, sleep and training-load metrics, with provenance attached to every value.

> **Not affiliated with, endorsed by, or connected to WHOOP, Inc.** WHOOP is a trademark of WHOOP, Inc., used here only to describe compatibility research. Nothing in this repository is, or should be presented as, an official WHOOP score.

[![tests](https://img.shields.io/badge/tests-113%20passing-brightgreen)](#testing) ![node](https://img.shields.io/badge/node-%E2%89%A522-blue) ![deps](https://img.shields.io/badge/runtime%20dependencies-0-blue) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## What this is

A local-first, dependency-free JavaScript library for heart-rate and heart-rate-variability analysis:

| Area | What you get |
|---|---|
| **Bluetooth** | Parser for the standard Heart Rate Measurement characteristic (`0x2A37`, Bluetooth SIG Heart Rate Service) — heart rate, RR intervals, energy expended, sensor contact |
| **Storage** | Idempotent SQLite store (built-in `node:sqlite`) that keeps the original bytes, timezone-aware timestamps and parser version, and can re-verify every row from its raw bytes |
| **Metrics** | RMSSD, DFA-α1, Sleep Regularity Index, respiratory rate from RSA, Karvonen heart-rate reserve, Banister and Edwards TRIMP, HR-zone time, sleep efficiency/performance, baseline statistics |
| **Provenance** | Every computed value carries its unit, method, algorithm version, confidence and literature citation; missing inputs yield an explicit `unavailable` with a reason — never a silent zero |

## What this is not

- **Not a WHOOP replacement and not a reproduction of WHOOP scores.** WHOOP's Recovery, Strain and Sleep scores are computed server-side and are not reproduced here.
- **Not tested against a WHOOP band.** No band was available during development. The data path is tested end to end on spec-conformant fixture data only. See [Status](#status).
- **No access controls or subscription checks are bypassed, and none are attempted.**

## Quick start

Requires Node.js 22 or later. No `npm install` is needed — there are no runtime dependencies.

```bash
git clone https://github.com/sriharideveloper/open-strap-research.git
cd open-strap-research
npm test
```

Run the end-to-end demonstration (notification bytes → parse → persist → integrity check → daily summary):

```bash
node tools/demo-end-to-end.mjs
```

Example output:

```
notifications       301 ingested, 0 duplicate(s) skipped
replay of row 1     inserted=false (expected false: idempotent)
integrity           301 rows checked, 0 mismatch(es)
source of all rows  fixture

hrvRmssd            54.81 ms  [confirmed, rmssd v1.0.0]
respiratoryRate     15.00 brpm  [confirmed, rsa-spectral-peak v1.0.0]
sleepEfficiency     UNAVAILABLE - no sleep session supplied
```

## Usage

### Parse a Bluetooth heart-rate notification

```js
import { parseHeartRateMeasurement } from './src/ble/heart-rate-measurement.mjs';

const m = parseHeartRateMeasurement([0x16, 0x48, 0x00, 0x04]);
// { heartRateBpm: 72, sensorContact: 'detected', rrMs: [1000], ... }
```

### Persist observations idempotently

```js
import { openStore, ingestHeartRateMeasurement, verifyIntegrity } from './src/store/observation-store.mjs';

const db = openStore('data/observations.db');
ingestHeartRateMeasurement(db, {
  source: 'device',                      // or 'fixture' for synthetic data
  deviceAddress: 'AA:BB:CC:DD:EE:FF',
  receivedAt: '2026-10-16T06:00:00-04:00', // offset required
  payload: [0x16, 0x48, 0x00, 0x04],
});
verifyIntegrity(db); // re-derives every row from its stored raw bytes
```

### Build a daily summary with provenance

```js
import { buildDailySummary, atConfidence } from './src/pipeline/daily-summary.mjs';
import { userProfile, rrSeries } from './src/model/records.mjs';

const summary = buildDailySummary({
  profile: userProfile({ restingHr: 55, maxHr: 190 }),
  rr: rrSeries({ startedAt: '2026-10-16T03:00:00-04:00', rrMs: [/* ... */] }),
  date: '2026-10-16',
});
summary.metrics.hrvRmssd;      // { value, unit: 'ms', provenance: { method, citation, ... } }
atConfidence(summary, ['confirmed']); // only standard, published-definition metrics
```

### Scan for nearby BLE heart-rate devices (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File tools\ble-scan.ps1 -Seconds 25
```

Passive only: it listens to advertisements and never connects, pairs, reads or writes.

## Status

| Item | State |
|---|---|
| Standard BLE heart-rate parser | implemented, tested against spec-layout vectors |
| Observation store | implemented, idempotent, integrity-verifiable |
| Test suite | 113 passing, closed-form and property-based checks |
| RMSSD validation | agrees with an independent NumPy implementation to 1e-9 relative ([evidence](evidence/rmssd-validation.json)) |
| Data from a real WHOOP band | **not demonstrated** — no hardware was available |
| Whether WHOOP's heart-rate broadcast uses the standard service, includes RR intervals, or needs enabling in the official app | **unverified** |
| Agreement with any WHOOP-reported value | **not tested** — needs authorized reference data |

## How it was built

The method, including what was tried and what failed, is in [docs/PROCESS.md](docs/PROCESS.md). Metric definitions and citations are in [docs/METRICS.md](docs/METRICS.md).

## Testing

```bash
npm test
```

Tests favour properties that can fail independently of the implementation — RMSSD of a constant series is exactly 0, the Sleep Regularity Index of a perfectly regular pattern is exactly 100, DFA of white noise is ≈ 0.5 and of a random walk ≈ 1.5, zone accumulation conserves time — over re-running the code's own arithmetic. An architecture test ensures production code in `src/` never imports experimental code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable contribution right now is **authorized, time-aligned test data from a real band**, with the device generation and how it was captured.

## License

[MIT](LICENSE). The license covers this repository's code only. It grants no rights in any third party's patents or trademarks.

---

*Keywords: WHOOP band, Bluetooth heart rate, BLE 0x180D 0x2A37, heart rate variability, HRV, RMSSD, DFA alpha1, sleep regularity index, respiratory rate, TRIMP, training load, open source wearable, quantified self, Node.js, SQLite.*
