/**
 * Respiratory rate from respiratory sinus arrhythmia (RSA).
 *
 * PUBLISHED METHOD. Not patent-derived.
 *   Task Force of the ESC/NASPE, Circulation 93(5):1043-1065, 1996 - the HF band
 *     (0.15-0.40 Hz) of heart rate variability is respiration-mediated.
 *   Schafer A, Kratky KW, "Estimation of breathing rate from respiratory sinus
 *     arrhythmia: comparison of various methods", Ann Biomed Eng 36(3), 2008.
 *
 * Breathing modulates heart rate, so the dominant spectral peak of the RR-interval
 * series inside the respiratory band estimates breathing frequency. This is an
 * ESTIMATE from an indirect signal, not a measured airflow rate.
 *
 * Vendors report respiratory rate from proprietary methods. Nothing establishes that
 * WHOOP uses this method, and its preprocessing is undisclosed.
 */

/**
 * Resample an RR-interval series onto a uniform time grid (a "tachogram").
 * RR intervals are irregularly spaced by construction, so spectral analysis
 * requires interpolation first.
 *
 * @param {number[]} rrMs successive RR intervals, milliseconds
 * @param {number} fsHz output sampling rate
 * @returns {{values:number[], fsHz:number}} uniformly sampled RR series (ms)
 */
export function resampleTachogram(rrMs, fsHz) {
  if (!Array.isArray(rrMs) || rrMs.length < 3) throw new RangeError('need at least 3 RR intervals');
  if (!(fsHz > 0)) throw new RangeError('fsHz must be positive');
  // beat times: each RR interval is located at its own end time
  const t = [];
  let acc = 0;
  for (const rr of rrMs) {
    if (typeof rr !== 'number' || Number.isNaN(rr) || rr <= 0) {
      throw new TypeError('rrMs must be positive numbers');
    }
    acc += rr / 1000;
    t.push(acc);
  }
  const t0 = t[0], tEnd = t[t.length - 1];
  const n = Math.floor((tEnd - t0) * fsHz) + 1;
  if (n < 4) throw new RangeError('record too short to resample at this rate');
  const values = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t0 + i / fsHz;
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    const t1 = t[j], t2 = t[j + 1];
    const v1 = rrMs[j], v2 = rrMs[j + 1];
    const w = t2 === t1 ? 0 : (ti - t1) / (t2 - t1);
    values[i] = v1 + (v2 - v1) * w;
  }
  return { values, fsHz };
}

/** Hann window, applied before the transform to limit spectral leakage. */
function hann(n) {
  const w = new Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/**
 * Power at a single frequency by direct evaluation of the DFT sum.
 * Evaluating only the frequencies of interest is cheaper than a full transform
 * here, and avoids pulling in an FFT dependency.
 */
function powerAt(signal, fsHz, freqHz) {
  let re = 0, im = 0;
  const n = signal.length;
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * freqHz * i) / fsHz;
    re += signal[i] * Math.cos(ang);
    im -= signal[i] * Math.sin(ang);
  }
  return (re * re + im * im) / (n * n);
}

/**
 * Estimate breathing rate from an RR-interval series.
 *
 * @param {number[]} rrMs RR intervals, milliseconds
 * @param {object} [opts]
 * @param {number} [opts.fsHz=4] resampling rate
 * @param {number} [opts.bandLowHz=0.15] lower edge of the respiratory band
 * @param {number} [opts.bandHighHz=0.40] upper edge
 * @param {number} [opts.resolutionHz=0.002] search step
 * @returns {{breathsPerMin:number, peakHz:number, power:number}}
 */
export function respiratoryRateFromRsa(rrMs, {
  fsHz = 4, bandLowHz = 0.15, bandHighHz = 0.40, resolutionHz = 0.002,
} = {}) {
  if (!(bandHighHz > bandLowHz && bandLowHz > 0)) throw new RangeError('invalid respiratory band');
  if (bandHighHz >= fsHz / 2) throw new RangeError('band exceeds Nyquist for this fsHz');
  const { values } = resampleTachogram(rrMs, fsHz);

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const w = hann(values.length);
  const detrended = values.map((v, i) => (v - mean) * w[i]);

  let best = { peakHz: NaN, power: -Infinity };
  for (let f = bandLowHz; f <= bandHighHz + 1e-12; f += resolutionHz) {
    const p = powerAt(detrended, fsHz, f);
    if (p > best.power) best = { peakHz: f, power: p };
  }
  return { breathsPerMin: best.peakHz * 60, peakHz: best.peakHz, power: best.power };
}
