/**
 * Measurement and provenance value types.
 *
 * Spec section 9 requires that original values, timestamps, units and source
 * metadata are preserved, and section 11 that "every visible metric must be
 * traceable to a source record or an explicitly identified estimation process".
 *
 * Provenance is therefore part of the value, not metadata attached beside it.
 * A bare number cannot travel through this pipeline: if you have a number you
 * have its unit, its origin and its confidence, or you do not have a value.
 */

/** Units are explicit and closed. A typo becomes an error, not a silent rescale. */
export const UNIT = Object.freeze({
  MILLISECONDS: 'ms',
  SECONDS: 's',
  MINUTES: 'min',
  HOURS: 'h',
  BPM: 'bpm',
  BREATHS_PER_MIN: 'brpm',
  PERCENT: '%',
  FRACTION: 'fraction',
  CELSIUS: 'degC',
  DIMENSIONLESS: 'dimensionless',
  SCORE_0_21: 'score[0..21]',
  SCORE_0_100: 'score[0..100]',
  WEIGHT_SECONDS: 'weight*s',
});
const UNITS = new Set(Object.values(UNIT));

/**
 * Where a value came from. These are deliberately distinct: a number read off
 * the device and a number this software inferred must never be indistinguishable
 * downstream.
 */
export const SOURCE = Object.freeze({
  /** read from the device or its packets */
  DEVICE: 'device',
  /** returned by an authorized external API */
  EXTERNAL: 'external',
  /** computed here from device or external inputs */
  DERIVED: 'derived',
  /** inferred where inputs were insufficient for direct computation */
  ESTIMATED: 'estimated',
  /** supplied by the user */
  USER: 'user',
});
const SOURCES = new Set(Object.values(SOURCE));

/**
 * How much the value can bear. Mirrors the evidence ledger's vocabulary so that
 * a metric's confidence and its underlying finding's confidence cannot drift.
 */
export const CONFIDENCE = Object.freeze({
  /** standard published definition computed exactly from adequate inputs */
  CONFIRMED: 'confirmed',
  /** patent-derived or otherwise unvalidated against reference data */
  CANDIDATE: 'candidate',
  /** rests on an interpretation this project asserted (e.g. a mapping not stated by its source) */
  INTERPRETIVE: 'interpretive',
  /** population heuristic, not individualized */
  LOW: 'low',
});
const CONFIDENCES = new Set(Object.values(CONFIDENCE));

/**
 * @typedef {object} Provenance
 * @property {string} source one of SOURCE
 * @property {string} method short identifier, e.g. 'rmssd', 'dfa-alpha1'
 * @property {string} algorithmVersion
 * @property {string} confidence one of CONFIDENCE
 * @property {string[]} [inputs] identifiers of the records this was computed from
 * @property {string} [citation] literature reference for a published method
 * @property {string} [evidenceRef] evidence identifier, e.g. a ledger finding id
 * @property {string} [note]
 */

export function provenance({
  source, method, algorithmVersion, confidence, inputs = [], citation, evidenceRef, note,
}) {
  if (!SOURCES.has(source)) throw new RangeError('unknown source: ' + source);
  if (typeof method !== 'string' || method.length === 0) throw new TypeError('method is required');
  if (typeof algorithmVersion !== 'string' || algorithmVersion.length === 0) {
    throw new TypeError('algorithmVersion is required; an unversioned metric cannot be reproduced');
  }
  if (!CONFIDENCES.has(confidence)) throw new RangeError('unknown confidence: ' + confidence);
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  return Object.freeze({
    source, method, algorithmVersion, confidence,
    inputs: Object.freeze([...inputs]),
    ...(citation ? { citation } : {}),
    ...(evidenceRef ? { evidenceRef } : {}),
    ...(note ? { note } : {}),
  });
}

/**
 * A value with its unit and provenance. Immutable.
 */
export function measurement(value, unit, prov) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError('measurement value must be a number; use unavailable() when it is not');
  }
  if (!UNITS.has(unit)) throw new RangeError('unknown unit: ' + unit);
  if (!prov || typeof prov.source !== 'string') throw new TypeError('provenance is required');
  return Object.freeze({ kind: 'measurement', value, unit, provenance: prov });
}

/**
 * The explicit absence of a value, with the reason.
 *
 * Spec section 9 forbids silently replacing missing data with estimates. A
 * summary field is therefore never null or zero when the input was missing - it
 * holds one of these, and anything consuming it has to deal with that.
 */
export function unavailable(reason, { method, evidenceRef } = {}) {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new TypeError('a reason is required; unexplained absence is not acceptable');
  }
  return Object.freeze({
    kind: 'unavailable', reason,
    ...(method ? { method } : {}),
    ...(evidenceRef ? { evidenceRef } : {}),
  });
}

export const isMeasurement = (x) => x?.kind === 'measurement';
export const isUnavailable = (x) => x?.kind === 'unavailable';

/** Read a value, or throw. Use when a caller genuinely cannot proceed without it. */
export function requireValue(x, label = 'value') {
  if (!isMeasurement(x)) {
    throw new RangeError(label + ' is unavailable: ' + (x?.reason ?? 'not computed'));
  }
  return x.value;
}

/** Read a value, or a fallback, making the substitution explicit at the call site. */
export function valueOr(x, fallback) {
  return isMeasurement(x) ? x.value : fallback;
}

/**
 * Timezone-aware instant. Spec section 11 requires timezone-aware timestamps;
 * a bare local time is ambiguous across DST and travel, both of which matter for
 * sleep and for day boundaries.
 */
export function instant(iso) {
  if (typeof iso !== 'string') throw new TypeError('instant must be an ISO 8601 string');
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(iso)) {
    throw new RangeError('instant must carry an explicit offset or Z: ' + iso);
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError('unparseable instant: ' + iso);
  return Object.freeze({ kind: 'instant', iso, epochMs: ms });
}

export const isInstant = (x) => x?.kind === 'instant';
