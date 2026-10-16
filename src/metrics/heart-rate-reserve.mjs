/**
 * Heart rate reserve (HRR).
 *
 * PUBLISHED STANDARD DEFINITION. Not patent-derived.
 * Karvonen MJ, Kentala E, Mustala O, "The effects of training on heart rate:
 * a longitudinal study", Annales Medicinae Experimentalis et Biologiae
 * Fenniae 35(3):307-315, 1957.
 *
 *   HRRfraction(HR) = (HR - RHR) / (HRmax - RHR)
 */

/**
 * @param {number} hr instantaneous heart rate, bpm
 * @param {number} restingHr resting heart rate, bpm
 * @param {number} maxHr maximum heart rate, bpm
 * @returns {number} HRR as a fraction. Normally [0,1]; values outside occur
 *   when hr is below rest or above the assumed max, and are NOT clamped here
 *   because clamping is a policy decision for the caller.
 */
export function heartRateReserveFraction(hr, restingHr, maxHr) {
  for (const [n, v] of Object.entries({ hr, restingHr, maxHr })) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError(n + ' must be a number');
  }
  if (maxHr <= restingHr) throw new RangeError('maxHr must exceed restingHr');
  return (hr - restingHr) / (maxHr - restingHr);
}

/** Map a heart rate series to an HRR series. */
export function heartRateReserveSeries(hrSeries, restingHr, maxHr) {
  if (!Array.isArray(hrSeries)) throw new TypeError('hrSeries must be an array');
  return hrSeries.map((hr) => heartRateReserveFraction(hr, restingHr, maxHr));
}
