/**
 * TRIMP-family cardiovascular load and heart-rate zone accumulation.
 *
 * PUBLISHED STANDARD DEFINITIONS. Not patent-derived.
 *   Banister EW, "Modeling elite athletic performance", in Physiological Testing
 *     of Elite Athletes, Human Kinetics, 1991.
 *   Edwards S, The Heart Rate Monitor Book, Polar Electro Oy, 1993.
 *   Lucia A et al., Med Sci Sports Exerc 31(9):1344-1350, 1999.
 *
 * These are published reference models of training load. They are NOT
 * reconstructions of any vendor's proprietary strain or load score, and nothing
 * here should be labelled as such.
 */

/**
 * Banister exponential TRIMP:
 *   TRIMP = D * dHR * 0.64 * e^(b * dHR)
 * where D is duration in minutes and dHR is the heart-rate-reserve fraction.
 *
 * The exponent b is a population-level constant from the original literature.
 * It is a required argument rather than a default so the choice stays visible.
 */
export const BANISTER_COEFFICIENTS = Object.freeze({
  /** published value used for male cohorts in the original work */
  MALE_COHORT: 1.92,
  /** published value used for female cohorts in the original work */
  FEMALE_COHORT: 1.67,
});

export function banisterTrimp(durationMin, hrrFraction, coefficient) {
  num({ durationMin, hrrFraction, coefficient });
  if (durationMin < 0) throw new RangeError('durationMin must be non-negative');
  if (hrrFraction < 0) throw new RangeError('hrrFraction must be non-negative');
  return durationMin * hrrFraction * 0.64 * Math.exp(coefficient * hrrFraction);
}

/**
 * Banister TRIMP over a sampled HRR series, integrating sample by sample
 * instead of using a single session average. Equivalent for constant HRR,
 * and strictly more faithful for interval work because the model is convex.
 */
export function banisterTrimpSeries(hrrSeries, { sampleSeconds, coefficient }) {
  if (!Array.isArray(hrrSeries)) throw new TypeError('hrrSeries must be an array');
  num({ sampleSeconds, coefficient });
  if (!(sampleSeconds > 0)) throw new RangeError('sampleSeconds must be positive');
  const minutes = sampleSeconds / 60;
  let total = 0;
  for (const h of hrrSeries) total += banisterTrimp(minutes, h, coefficient);
  return total;
}

/**
 * Accumulate time spent in each heart-rate zone.
 * @param {number[]} hrSeries heart rate samples
 * @param {number[]} boundaries ascending zone lower bounds, same units as hrSeries
 * @param {number} sampleSeconds duration each sample represents
 * @returns {{zoneSeconds:number[], belowFirstZoneSeconds:number, totalSeconds:number}}
 *   zoneSeconds[i] covers [boundaries[i], boundaries[i+1]); the last zone is open-ended.
 */
export function accumulateZoneTime(hrSeries, boundaries, sampleSeconds) {
  if (!Array.isArray(hrSeries)) throw new TypeError('hrSeries must be an array');
  if (!Array.isArray(boundaries) || boundaries.length === 0) {
    throw new TypeError('boundaries must be a non-empty array');
  }
  for (let i = 1; i < boundaries.length; i++) {
    if (!(boundaries[i] > boundaries[i - 1])) throw new RangeError('boundaries must strictly ascend');
  }
  num({ sampleSeconds });
  if (!(sampleSeconds > 0)) throw new RangeError('sampleSeconds must be positive');

  const zoneSeconds = new Array(boundaries.length).fill(0);
  let belowFirstZoneSeconds = 0;
  for (const hr of hrSeries) {
    if (typeof hr !== 'number' || Number.isNaN(hr)) throw new TypeError('hrSeries must be numbers');
    if (hr < boundaries[0]) { belowFirstZoneSeconds += sampleSeconds; continue; }
    let z = 0;
    for (let i = 0; i < boundaries.length; i++) if (hr >= boundaries[i]) z = i;
    zoneSeconds[z] += sampleSeconds;
  }
  return {
    zoneSeconds,
    belowFirstZoneSeconds,
    totalSeconds: hrSeries.length * sampleSeconds,
  };
}

/** Zone lower bounds as percentages of max HR, for a given HRmax. */
export function zonesFromMaxHr(maxHr, percentages = [0.5, 0.6, 0.7, 0.8, 0.9]) {
  num({ maxHr });
  if (maxHr <= 0) throw new RangeError('maxHr must be positive');
  return percentages.map((p) => maxHr * p);
}

/**
 * Edwards TRIMP: summed zone minutes weighted 1..n by zone index.
 * The classic form uses five zones at 50/60/70/80/90% of HRmax with weights 1-5.
 */
export function edwardsTrimp(zoneSeconds, weights) {
  if (!Array.isArray(zoneSeconds)) throw new TypeError('zoneSeconds must be an array');
  const w = weights ?? zoneSeconds.map((_, i) => i + 1);
  if (w.length !== zoneSeconds.length) throw new RangeError('weights length must match zoneSeconds');
  let total = 0;
  for (let i = 0; i < zoneSeconds.length; i++) total += (zoneSeconds[i] / 60) * w[i];
  return total;
}

function num(obj) {
  for (const [n, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError(n + ' must be a number');
  }
}
