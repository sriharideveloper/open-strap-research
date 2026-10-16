/**
 * Typed domain records.
 *
 * Constructors validate and freeze. Spec section 9 requires a durable, versioned
 * model preserving original values, timestamps, units and source metadata, so
 * every record carries its schema version and the raw inputs are never mutated
 * in place by the pipeline.
 */

import { instant, isInstant } from './measurement.mjs';

export const SCHEMA_VERSION = '0.1.0';

/** Sleep stage vocabulary. Matches the AASM terms used in src/metrics/sleep.mjs. */
export const STAGE = Object.freeze({
  AWAKE: 'awake', LIGHT: 'light', SWS: 'sws', REM: 'rem',
});
const STAGES = new Set(Object.values(STAGE));

/**
 * Device identity. `model` is a free-form label supplied by whoever captured the
 * data (for example the advertised device name). 'unknown' is permitted and is
 * not an error - an unidentified device is a fact worth recording, not a reason
 * to refuse data.
 */
export function deviceIdentity({ model = 'unknown', serial = null, firmwareVersion = null } = {}) {
  if (typeof model !== 'string' || model.trim() === '') throw new TypeError('model must be a non-empty string');
  return Object.freeze({
    kind: 'deviceIdentity', schemaVersion: SCHEMA_VERSION, model, serial, firmwareVersion,
  });
}

/**
 * Evenly sampled heart rate series.
 * @param {{startedAt:string, sampleSeconds:number, bpm:number[], deviceId?:string}} o
 */
export function heartRateSeries({ startedAt, sampleSeconds, bpm, deviceId = null }) {
  const start = instant(startedAt);
  if (!(sampleSeconds > 0)) throw new RangeError('sampleSeconds must be positive');
  if (!Array.isArray(bpm) || bpm.length === 0) throw new RangeError('bpm must be a non-empty array');
  for (const v of bpm) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError('bpm must contain numbers');
    if (v <= 0 || v > 300) throw new RangeError('implausible heart rate: ' + v);
  }
  return Object.freeze({
    kind: 'heartRateSeries', schemaVersion: SCHEMA_VERSION,
    startedAt: start, sampleSeconds, bpm: Object.freeze([...bpm]), deviceId,
    durationSeconds: bpm.length * sampleSeconds,
  });
}

/**
 * Beat-to-beat intervals. Kept separate from heartRateSeries because they are a
 * different measurement with different uses: HRV and DFA need intervals, not an
 * averaged rate, and conflating them silently degrades both.
 */
export function rrSeries({ startedAt, rrMs, deviceId = null }) {
  const start = instant(startedAt);
  if (!Array.isArray(rrMs) || rrMs.length < 2) throw new RangeError('rrMs needs at least 2 intervals');
  for (const v of rrMs) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError('rrMs must contain numbers');
    if (v <= 0 || v > 3000) throw new RangeError('implausible RR interval: ' + v);
  }
  return Object.freeze({
    kind: 'rrSeries', schemaVersion: SCHEMA_VERSION,
    startedAt: start, rrMs: Object.freeze([...rrMs]), deviceId,
    beatCount: rrMs.length,
  });
}

/** One scored stage interval. */
export function stageInterval({ stage, minutes }) {
  if (!STAGES.has(stage)) throw new RangeError('unknown sleep stage: ' + stage);
  if (typeof minutes !== 'number' || Number.isNaN(minutes) || minutes < 0) {
    throw new RangeError('minutes must be a non-negative number');
  }
  return Object.freeze({ kind: 'stageInterval', stage, minutes });
}

/**
 * A sleep session. timeInBedMin is taken from the session bounds rather than
 * recomputed from stages, so that a stage-scoring gap shows up as a discrepancy
 * instead of being hidden by construction.
 */
export function sleepSession({ id, startedAt, endedAt, stages = [], nap = false, deviceId = null }) {
  if (typeof id !== 'string' || !id) throw new TypeError('sleep session needs an id');
  const start = instant(startedAt);
  const end = instant(endedAt);
  if (end.epochMs <= start.epochMs) throw new RangeError('sleep session must end after it starts');
  const iv = stages.map((s) => (s?.kind === 'stageInterval' ? s : stageInterval(s)));
  const timeInBedMin = (end.epochMs - start.epochMs) / 60000;
  const scoredMin = iv.reduce((a, b) => a + b.minutes, 0);
  return Object.freeze({
    kind: 'sleepSession', schemaVersion: SCHEMA_VERSION,
    id, startedAt: start, endedAt: end, nap, deviceId,
    stages: Object.freeze(iv), timeInBedMin, scoredMin,
    /** positive when stage scoring does not cover the whole session */
    unscoredMin: timeInBedMin - scoredMin,
  });
}

/** A workout or activity session. */
export function workout({ id, startedAt, endedAt, sport = 'unknown', deviceId = null }) {
  if (typeof id !== 'string' || !id) throw new TypeError('workout needs an id');
  const start = instant(startedAt);
  const end = instant(endedAt);
  if (end.epochMs <= start.epochMs) throw new RangeError('workout must end after it starts');
  return Object.freeze({
    kind: 'workout', schemaVersion: SCHEMA_VERSION,
    id, startedAt: start, endedAt: end, sport, deviceId,
    durationMin: (end.epochMs - start.epochMs) / 60000,
  });
}

/** Personal physiological constants needed by several metrics. */
export function userProfile({ restingHr, maxHr, thresholds = null }) {
  if (typeof restingHr !== 'number' || typeof maxHr !== 'number') {
    throw new TypeError('restingHr and maxHr are required');
  }
  if (!(maxHr > restingHr)) throw new RangeError('maxHr must exceed restingHr');
  if (thresholds !== null) {
    const { at, cpt } = thresholds;
    if (!(at > 0 && cpt > at && cpt <= 1)) throw new RangeError('require 0 < at < cpt <= 1');
  }
  return Object.freeze({
    kind: 'userProfile', schemaVersion: SCHEMA_VERSION,
    restingHr, maxHr, thresholds: thresholds ? Object.freeze({ ...thresholds }) : null,
  });
}

export { instant, isInstant };
