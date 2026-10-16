/**
 * Detrended Fluctuation Analysis of RR intervals, and HRV-derived thresholds.
 *
 * PUBLISHED METHOD. Not patent-derived.
 *   Peng C-K et al., "Mosaic organization of DNA nucleotides", Phys Rev E 49(2),
 *     1994 - the DFA scaling exponent.
 *   Rogers B, Giles D, Draper N, Hoos O, Gronwald T, "A new detection method
 *     defining the aerobic threshold for endurance exercise and training
 *     prescription based on fractal correlation properties of HRV",
 *     Front Physiol 11:596567, 2021 - DFA-alpha1 = 0.75 at the first threshold.
 *   Rogers B et al., Eur J Appl Physiol, 2022 - 0.75 and 0.50 against VT1/VT2.
 *
 * DFA-alpha1 falls as exercise intensity rises: near 1.0 at rest, through 0.75
 * around the first ventilatory threshold, toward 0.50 and below at higher work
 * rates. Crossings of those values give HRVT1 and HRVT2.
 *
 * EVIDENCE QUALITY: the supporting studies are small (15-26 participants) and
 * largely from one research group. Agreement with gas-exchange thresholds was
 * good, but large independent replication was not found. Treat the thresholds as
 * useful estimates with real uncertainty, not as gold-standard measurements.
 */

/** Canonical crossing values from the literature. */
export const HRVT_ALPHA = Object.freeze({ FIRST_THRESHOLD: 0.75, SECOND_THRESHOLD: 0.50 });

/**
 * DFA scaling exponent over a range of box sizes.
 * alpha1 conventionally uses short-scale boxes of 4 to 16 beats.
 *
 * @param {number[]} series RR intervals (ms) or any evenly-ordered series
 * @param {{minBox?:number, maxBox?:number}} [opts]
 * @returns {number} the scaling exponent alpha
 */
export function dfaAlpha(series, { minBox = 4, maxBox = 16 } = {}) {
  if (!Array.isArray(series)) throw new TypeError('series must be an array');
  if (!Number.isInteger(minBox) || !Number.isInteger(maxBox) || minBox < 3 || maxBox <= minBox) {
    throw new RangeError('require integer box sizes with 3 <= minBox < maxBox');
  }
  const N = series.length;
  if (N < maxBox * 4) throw new RangeError('series too short for the requested box range');
  for (const v of series) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError('series must contain numbers');
  }

  // 1. integrate the mean-removed series
  const mean = series.reduce((a, b) => a + b, 0) / N;
  const y = new Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) { acc += series[i] - mean; y[i] = acc; }

  // 2. fluctuation at each box size
  const logN = [];
  const logF = [];
  for (let n = minBox; n <= maxBox; n++) {
    const boxes = Math.floor(N / n);
    if (boxes < 1) continue;
    let sumSq = 0;
    let count = 0;
    for (let b = 0; b < boxes; b++) {
      const start = b * n;
      // least-squares line over the box, x = 0..n-1
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let k = 0; k < n; k++) {
        const x = k, v = y[start + k];
        sx += x; sy += v; sxx += x * x; sxy += x * v;
      }
      const denom = n * sxx - sx * sx;
      const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
      const intercept = (sy - slope * sx) / n;
      for (let k = 0; k < n; k++) {
        const resid = y[start + k] - (slope * k + intercept);
        sumSq += resid * resid;
        count++;
      }
    }
    const F = Math.sqrt(sumSq / count);
    if (F > 0) { logN.push(Math.log(n)); logF.push(Math.log(F)); }
  }
  if (logN.length < 2) throw new RangeError('insufficient fluctuation data to fit a slope');

  // 3. slope of log F against log n
  return linearSlope(logN, logF);
}

/** alpha1: the short-scale exponent, boxes 4..16 beats. */
export function dfaAlpha1(rrMs) {
  return dfaAlpha(rrMs, { minBox: 4, maxBox: 16 });
}

/**
 * Locate the heart rate at which DFA-alpha1 crosses a target value.
 *
 * @param {{hr:number, alpha1:number}[]} points one per analysis window, in
 *   increasing intensity order
 * @param {number} targetAlpha e.g. 0.75 for HRVT1, 0.50 for HRVT2
 * @returns {{hr:number|null, bracketed:boolean, reason?:string}}
 *   hr is linearly interpolated between the bracketing points. Returns null when
 *   the target is never crossed, rather than extrapolating.
 */
export function thresholdFromDfa(points, targetAlpha) {
  if (!Array.isArray(points) || points.length < 2) throw new RangeError('need at least 2 points');
  if (typeof targetAlpha !== 'number' || Number.isNaN(targetAlpha)) {
    throw new TypeError('targetAlpha must be a number');
  }
  for (const p of points) {
    if (typeof p?.hr !== 'number' || typeof p?.alpha1 !== 'number') {
      throw new TypeError('each point needs numeric hr and alpha1');
    }
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const crossesDown = a.alpha1 >= targetAlpha && b.alpha1 < targetAlpha;
    const crossesUp = a.alpha1 <= targetAlpha && b.alpha1 > targetAlpha;
    if (crossesDown || crossesUp) {
      const span = b.alpha1 - a.alpha1;
      const w = span === 0 ? 0 : (targetAlpha - a.alpha1) / span;
      return { hr: a.hr + w * (b.hr - a.hr), bracketed: true };
    }
  }
  const all = points.map((p) => p.alpha1);
  return {
    hr: null,
    bracketed: false,
    reason: Math.min(...all) > targetAlpha
      ? 'alpha1 never fell to the target; intensity range too low'
      : 'alpha1 never rose to the target; intensity range too high',
  };
}

function linearSlope(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
