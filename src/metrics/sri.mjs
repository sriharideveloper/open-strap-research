/**
 * SRI - Sleep Regularity Index.
 *
 * PUBLISHED STANDARD DEFINITION. Not patent-derived, not WHOOP-specific.
 * Phillips AJK et al., "Irregular sleep/wake patterns are associated with poorer
 * academic performance and delayed circadian and sleep/wake timing",
 * Scientific Reports 7:3216, 2017.
 *
 * SRI is the percentage probability of being in the same state (asleep or awake)
 * at two time points exactly 24 hours apart, rescaled to [-100, 100]:
 *
 *   SRI = -100 + 200 * P(same state 24h apart)
 *
 * so perfectly regular = 100, random = 0, perfectly inverted = -100.
 */

/**
 * @param {(0|1|boolean)[]} epochs binary sleep state per epoch, contiguous and
 *   evenly spaced, ordered in time. 1/true = asleep.
 * @param {number} epochsPerDay number of epochs spanning exactly 24 hours
 * @returns {number} SRI in [-100, 100]
 */
export function sleepRegularityIndex(epochs, epochsPerDay) {
  if (!Array.isArray(epochs)) throw new TypeError('epochs must be an array');
  if (!Number.isInteger(epochsPerDay) || epochsPerDay <= 0) {
    throw new RangeError('epochsPerDay must be a positive integer');
  }
  if (epochs.length <= epochsPerDay) {
    throw new RangeError('need more than 24 hours of epochs to compare across days');
  }
  const state = epochs.map((e) => {
    if (e === true || e === 1) return 1;
    if (e === false || e === 0) return 0;
    throw new TypeError('epochs must be 0/1 or boolean');
  });
  let matches = 0;
  const pairs = state.length - epochsPerDay;
  for (let i = 0; i < pairs; i++) {
    if (state[i] === state[i + epochsPerDay]) matches++;
  }
  return -100 + 200 * (matches / pairs);
}
