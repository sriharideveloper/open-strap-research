/**
 * RMSSD - root mean square of successive differences between NN intervals.
 *
 * PUBLISHED STANDARD DEFINITION. Not patent-derived, not WHOOP-specific.
 * Task Force of the European Society of Cardiology and the North American
 * Society of Pacing and Electrophysiology, "Heart rate variability: standards
 * of measurement, physiological interpretation, and clinical use",
 * Circulation 93(5):1043-1065, 1996.
 *
 *   RMSSD = sqrt( (1/(N-1)) * sum_{i=1}^{N-1} (RR_{i+1} - RR_i)^2 )
 *
 * This computes RMSSD exactly. It does NOT reproduce WHOOP's reported HRV,
 * which is a windowed, preprocessed value whose preprocessing is undisclosed
 * (see docs/metric-derivation.md).
 */

/**
 * @param {number[]} rrMs successive RR (NN) intervals in milliseconds
 * @returns {number} RMSSD in milliseconds
 */
export function rmssd(rrMs) {
  if (!Array.isArray(rrMs)) throw new TypeError('rrMs must be an array');
  if (rrMs.length < 2) throw new RangeError('RMSSD needs at least 2 intervals');
  let sumSq = 0;
  for (let i = 0; i < rrMs.length - 1; i++) {
    const a = rrMs[i], b = rrMs[i + 1];
    if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) {
      throw new TypeError('rrMs must contain only numbers');
    }
    const diff = b - a;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (rrMs.length - 1));
}

/**
 * Artifact rejection before RMSSD. Ectopic beats and missed detections inflate
 * successive differences badly, so filtering is near-mandatory on real data.
 * This uses the common relative-difference rule; the threshold is a choice, not
 * a standard, so it is explicit.
 *
 * @param {number[]} rrMs
 * @param {number} maxRelDiff reject an interval differing from the previous by
 *   more than this fraction (0.2 = 20%, a widely used default)
 * @returns {{kept: number[], rejected: number}}
 */
export function filterEctopic(rrMs, maxRelDiff = 0.2) {
  if (maxRelDiff <= 0) throw new RangeError('maxRelDiff must be positive');
  const kept = [];
  let rejected = 0;
  for (const rr of rrMs) {
    if (kept.length === 0) { kept.push(rr); continue; }
    const prev = kept[kept.length - 1];
    if (Math.abs(rr - prev) / prev > maxRelDiff) { rejected++; continue; }
    kept.push(rr);
  }
  return { kept, rejected };
}
