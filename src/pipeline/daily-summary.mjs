/**
 * End-to-end daily summary pipeline.
 *
 * Raw inputs -> metrics -> summary, with provenance on every value.
 *
 * THREE RULES THIS PIPELINE ENFORCES, all from the project brief:
 *
 *  1. Nothing is silently substituted (spec section 9). A metric whose inputs are
 *     missing yields an `unavailable` with a reason, never a zero, a null or a
 *     quietly-defaulted estimate. If you want a population heuristic you pass it
 *     in deliberately and it is marked `confidence: low` in the output.
 *
 *  2. Nothing loses its origin (spec section 11). Every value carries source,
 *     method, algorithm version and confidence, so a consumer can filter to only
 *     what it is willing to trust.
 *
 *  3. Only published definitions run here. Anything unvalidated lives outside
 *     src/ and can be applied, if at all, only by an explicit opt-in layer.
 *     A test enforces that src/ never imports from experimental/.
 */

import {
  measurement, unavailable, provenance, UNIT, SOURCE, CONFIDENCE, isMeasurement,
} from '../model/measurement.mjs';
import { SCHEMA_VERSION } from '../model/records.mjs';

import { rmssd, filterEctopic } from '../metrics/rmssd.mjs';
import { respiratoryRateFromRsa } from '../metrics/respiratory.mjs';
import { sleepEfficiency, sleepPerformance, totalSleepTime } from '../metrics/sleep.mjs';
import { heartRateReserveSeries } from '../metrics/heart-rate-reserve.mjs';
import { banisterTrimpSeries, accumulateZoneTime, zonesFromMaxHr, edwardsTrimp } from '../metrics/training-load.mjs';

/** Algorithm versions. Bump when a computation changes, so stored results stay interpretable. */
export const ALGORITHM_VERSIONS = Object.freeze({
  rmssd: '1.0.0',
  respiratoryRate: '1.0.0',
  sleepEfficiency: '1.0.0',
  sleepPerformance: '1.0.0',
  cardiovascularLoad: '1.0.0',
  zoneTime: '1.0.0',
});

const CITE = {
  rmssd: 'Task Force ESC/NASPE, Circulation 93(5):1043-1065, 1996',
  rsa: 'Schafer & Kratky, Ann Biomed Eng 36(3), 2008',
  aasm: 'AASM Manual for the Scoring of Sleep and Associated Events',
  banister: 'Banister EW, Physiological Testing of Elite Athletes, 1991',
  edwards: 'Edwards S, The Heart Rate Monitor Book, 1993',
};

/**
 * @param {object} input
 * @param {object} input.profile userProfile record
 * @param {object} [input.rr] rrSeries record (overnight, for HRV and respiratory rate)
 * @param {object} [input.hr] heartRateSeries record (the day, for load and zones)
 * @param {object} [input.sleep] sleepSession record
 * @param {number} [input.sleepNeedMin] required for sleep performance; NOT defaulted
 * @param {string} input.date ISO date label for the summary
 */
export function buildDailySummary({
  profile, rr = null, hr = null, sleep = null,
  sleepNeedMin = null,
  date,
}) {
  if (!profile || profile.kind !== 'userProfile') throw new TypeError('a userProfile record is required');
  if (typeof date !== 'string' || !date) throw new TypeError('a date label is required');

  const metrics = {};
  const notes = [];

  // ---- HRV ----
  if (rr) {
    const { kept, rejected } = filterEctopic([...rr.rrMs]);
    if (kept.length < 2) {
      metrics.hrvRmssd = unavailable('all RR intervals rejected as artifact', { method: 'rmssd' });
    } else {
      metrics.hrvRmssd = measurement(rmssd(kept), UNIT.MILLISECONDS, provenance({
        source: SOURCE.DERIVED, method: 'rmssd', algorithmVersion: ALGORITHM_VERSIONS.rmssd,
        confidence: CONFIDENCE.CONFIRMED, inputs: [rr.startedAt.iso], citation: CITE.rmssd,
        note: rejected ? rejected + ' interval(s) rejected as artifact' : undefined,
      }));
      if (rejected) notes.push(`${rejected} RR interval(s) rejected as artifact`);
    }
  } else {
    metrics.hrvRmssd = unavailable('no RR interval series supplied', { method: 'rmssd' });
  }

  // ---- respiratory rate ----
  if (rr) {
    try {
      const r = respiratoryRateFromRsa([...rr.rrMs]);
      metrics.respiratoryRate = measurement(r.breathsPerMin, UNIT.BREATHS_PER_MIN, provenance({
        source: SOURCE.DERIVED, method: 'rsa-spectral-peak',
        algorithmVersion: ALGORITHM_VERSIONS.respiratoryRate,
        confidence: CONFIDENCE.CONFIRMED, inputs: [rr.startedAt.iso], citation: CITE.rsa,
        note: 'estimated from heart rate modulation, not measured airflow',
      }));
    } catch (e) {
      metrics.respiratoryRate = unavailable('RSA estimation failed: ' + e.message, { method: 'rsa-spectral-peak' });
    }
  } else {
    metrics.respiratoryRate = unavailable('no RR interval series supplied', { method: 'rsa-spectral-peak' });
  }

  // ---- sleep ----
  if (sleep) {
    const tst = totalSleepTime(sleep.stages.map((s) => ({ stage: s.stage, minutes: s.minutes })));
    metrics.totalSleepMin = measurement(tst, UNIT.MINUTES, provenance({
      source: SOURCE.DERIVED, method: 'stage-aggregation', algorithmVersion: ALGORITHM_VERSIONS.sleepEfficiency,
      confidence: CONFIDENCE.CONFIRMED, inputs: [sleep.id], citation: CITE.aasm,
    }));

    if (tst > sleep.timeInBedMin) {
      metrics.sleepEfficiency = unavailable(
        'scored sleep exceeds time in bed; inputs are inconsistent', { method: 'sleep-efficiency' },
      );
      notes.push('scored sleep exceeded session bounds');
    } else {
      metrics.sleepEfficiency = measurement(
        sleepEfficiency(tst, sleep.timeInBedMin), UNIT.PERCENT, provenance({
          source: SOURCE.DERIVED, method: 'sleep-efficiency',
          algorithmVersion: ALGORITHM_VERSIONS.sleepEfficiency,
          confidence: CONFIDENCE.CONFIRMED, inputs: [sleep.id], citation: CITE.aasm,
        }),
      );
    }

    if (sleep.unscoredMin > 1) {
      notes.push(`${sleep.unscoredMin.toFixed(1)} min of the session was not stage-scored`);
    }

    // Sleep performance needs sleep need, which this pipeline does NOT invent.
    if (typeof sleepNeedMin === 'number' && sleepNeedMin > 0) {
      metrics.sleepPerformance = measurement(
        sleepPerformance(tst, sleepNeedMin), UNIT.PERCENT, provenance({
          source: SOURCE.DERIVED, method: 'sleep-performance',
          algorithmVersion: ALGORITHM_VERSIONS.sleepPerformance,
          confidence: CONFIDENCE.CONFIRMED, inputs: [sleep.id], citation: CITE.aasm,
        }),
      );
    } else {
      metrics.sleepPerformance = unavailable(
        'sleep need not supplied; it is personal and is not defaulted', { method: 'sleep-performance' },
      );
    }
  } else {
    for (const k of ['totalSleepMin', 'sleepEfficiency', 'sleepPerformance']) {
      metrics[k] = unavailable('no sleep session supplied', { method: k });
    }
  }

  // ---- cardiovascular load and zones ----
  if (hr) {
    const hrr = heartRateReserveSeries([...hr.bpm], profile.restingHr, profile.maxHr);
    const clamped = hrr.map((v) => Math.min(1, Math.max(0, v)));

    metrics.cardiovascularLoad = measurement(
      banisterTrimpSeries(clamped, { sampleSeconds: hr.sampleSeconds, coefficient: 1.92 }),
      UNIT.DIMENSIONLESS, provenance({
        source: SOURCE.DERIVED, method: 'banister-trimp',
        algorithmVersion: ALGORITHM_VERSIONS.cardiovascularLoad,
        confidence: CONFIDENCE.CONFIRMED, inputs: [hr.startedAt.iso], citation: CITE.banister,
        note: 'published training-load model; NOT a reconstruction of WHOOP Strain',
      }),
    );

    const zones = accumulateZoneTime([...hr.bpm], zonesFromMaxHr(profile.maxHr), hr.sampleSeconds);
    metrics.zoneTimeSeconds = measurement(
      zones.zoneSeconds.reduce((a, b) => a + b, 0), UNIT.SECONDS, provenance({
        source: SOURCE.DERIVED, method: 'zone-accumulation', algorithmVersion: ALGORITHM_VERSIONS.zoneTime,
        confidence: CONFIDENCE.CONFIRMED, inputs: [hr.startedAt.iso], citation: CITE.edwards,
      }),
    );
    metrics.edwardsTrimp = measurement(
      edwardsTrimp(zones.zoneSeconds), UNIT.DIMENSIONLESS, provenance({
        source: SOURCE.DERIVED, method: 'edwards-trimp', algorithmVersion: ALGORITHM_VERSIONS.zoneTime,
        confidence: CONFIDENCE.CONFIRMED, inputs: [hr.startedAt.iso], citation: CITE.edwards,
      }),
    );

  } else {
    for (const k of ['cardiovascularLoad', 'zoneTimeSeconds', 'edwardsTrimp']) {
      metrics[k] = unavailable('no heart rate series supplied', { method: k });
    }
  }

  return Object.freeze({
    kind: 'dailySummary', schemaVersion: SCHEMA_VERSION, date,
    metrics: Object.freeze(metrics),
    notes: Object.freeze(notes),
    coverage: Object.freeze(summarizeCoverage(metrics)),
  });
}

/** How much of the summary is actually populated, and at what confidence. */
export function summarizeCoverage(metrics) {
  const keys = Object.keys(metrics);
  const available = keys.filter((k) => isMeasurement(metrics[k]));
  const byConfidence = {};
  for (const k of available) {
    const c = metrics[k].provenance.confidence;
    byConfidence[c] = (byConfidence[c] ?? 0) + 1;
  }
  return {
    total: keys.length,
    available: available.length,
    unavailable: keys.length - available.length,
    byConfidence,
  };
}

/** Filter a summary to metrics at or above a confidence level. */
export function atConfidence(summary, accepted) {
  const set = new Set(accepted);
  const out = {};
  for (const [k, v] of Object.entries(summary.metrics)) {
    if (isMeasurement(v) && set.has(v.provenance.confidence)) out[k] = v;
  }
  return out;
}
