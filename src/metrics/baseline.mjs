/**
 * Personal baseline learning over a historical window.
 *
 * GENERIC STATISTICS. Not patent-derived.
 *
 * Physiological metrics are usually interpreted against an individual's own
 * normal range, learned over a historical window. These are ordinary rolling
 * estimators. Rules such as "rest days only" are applied by the caller through
 * an eligibility predicate rather than hardcoded here.
 */

/** Trailing rolling mean. out[i] uses the window ending at i. */
export function rollingMean(series, windowSize) {
  checkWindow(series, windowSize);
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const w = series.slice(Math.max(0, i - windowSize + 1), i + 1);
    out.push(w.reduce((a, b) => a + b, 0) / w.length);
  }
  return out;
}

/**
 * Trailing rolling sample standard deviation (Bessel-corrected, n-1).
 * A window holding a single point has undefined sample SD and yields 0.
 */
export function rollingStd(series, windowSize) {
  checkWindow(series, windowSize);
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const w = series.slice(Math.max(0, i - windowSize + 1), i + 1);
    if (w.length < 2) { out.push(0); continue; }
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const ss = w.reduce((a, b) => a + (b - m) * (b - m), 0);
    out.push(Math.sqrt(ss / (w.length - 1)));
  }
  return out;
}

/**
 * Standard score against a baseline.
 * Returns 0 when sd is 0: every observation equals the baseline, so no deviation
 * is measurable. Callers needing to distinguish that case should test sd first.
 */
export function zScore(value, baselineMean, baselineStd) {
  num({ value, baselineMean, baselineStd });
  if (baselineStd < 0) throw new RangeError('baselineStd must be non-negative');
  if (baselineStd === 0) return 0;
  return (value - baselineMean) / baselineStd;
}

/**
 * Percentile rank of a value within a historical sample, midrank convention:
 * ties contribute one half each.
 * @returns {number} 0..100
 */
export function percentileRank(value, history) {
  if (!Array.isArray(history) || history.length === 0) throw new RangeError('history must be non-empty');
  num({ value });
  let below = 0, equal = 0;
  for (const h of history) {
    if (typeof h !== 'number' || Number.isNaN(h)) throw new TypeError('history must contain numbers');
    if (h < value) below++;
    else if (h === value) equal++;
  }
  return (100 * (below + 0.5 * equal)) / history.length;
}

/**
 * Build a baseline from a historical window, optionally restricted to eligible
 * samples. The eligibility predicate is how a caller applies a rule such as
 * "rest days only" without that rule being hardcoded here.
 *
 * Returns sufficient:false rather than a number when too few samples qualify,
 * so an under-determined baseline cannot be mistaken for a real one.
 */
export function learnBaseline(samples, { windowSize, isEligible } = {}) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  if (!Number.isInteger(windowSize) || windowSize < 2) {
    throw new RangeError('windowSize must be an integer >= 2');
  }
  const recent = samples.slice(-windowSize);
  const eligible = typeof isEligible === 'function' ? recent.filter(isEligible) : recent;
  if (eligible.length < 2) {
    return { mean: null, std: null, n: eligible.length, sufficient: false };
  }
  const values = eligible.map((s) => (typeof s === 'number' ? s : s.value));
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError('samples must be numbers or {value}');
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return { mean, std: Math.sqrt(ss / (values.length - 1)), n: values.length, sufficient: true };
}

function checkWindow(series, windowSize) {
  if (!Array.isArray(series)) throw new TypeError('series must be an array');
  if (!Number.isInteger(windowSize) || windowSize < 1) throw new RangeError('windowSize must be a positive integer');
  for (const v of series) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError('series must contain numbers');
  }
}

function num(obj) {
  for (const [n, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError(n + ' must be a number');
  }
}
