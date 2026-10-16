/**
 * Sleep interval metrics.
 *
 * PUBLISHED STANDARD DEFINITIONS. Not patent-derived.
 * Terminology follows the AASM Manual for the Scoring of Sleep and Associated
 * Events (American Academy of Sleep Medicine), and Iber C et al., 2007.
 *
 * All durations are in minutes unless named otherwise. These compute the
 * standard quantities exactly; they do NOT reproduce WHOOP's reported figures,
 * whose staging and preprocessing are undisclosed.
 */

/**
 * Sleep efficiency: total sleep time as a percentage of time in bed.
 *   SE = 100 * TST / TIB
 */
export function sleepEfficiency(totalSleepMin, timeInBedMin) {
  req({ totalSleepMin, timeInBedMin });
  if (timeInBedMin <= 0) throw new RangeError('timeInBedMin must be positive');
  if (totalSleepMin < 0) throw new RangeError('totalSleepMin must be non-negative');
  if (totalSleepMin > timeInBedMin) throw new RangeError('totalSleepMin cannot exceed timeInBedMin');
  return 100 * (totalSleepMin / timeInBedMin);
}

/**
 * Sleep performance: achieved sleep as a percentage of required sleep.
 *   SP = 100 * TST / sleepNeed
 *
 * Not clamped at 100: sleeping beyond need is meaningful and callers may want it.
 */
export function sleepPerformance(totalSleepMin, sleepNeedMin) {
  req({ totalSleepMin, sleepNeedMin });
  if (sleepNeedMin <= 0) throw new RangeError('sleepNeedMin must be positive');
  if (totalSleepMin < 0) throw new RangeError('totalSleepMin must be non-negative');
  return 100 * (totalSleepMin / sleepNeedMin);
}

/**
 * Wake after sleep onset: wakefulness between sleep onset and final awakening.
 *   WASO = TIB - TST - sleepOnsetLatency - (time after final awakening)
 */
export function wakeAfterSleepOnset({
  timeInBedMin, totalSleepMin, sleepOnsetLatencyMin, afterFinalAwakeningMin = 0,
}) {
  req({ timeInBedMin, totalSleepMin, sleepOnsetLatencyMin, afterFinalAwakeningMin });
  const waso = timeInBedMin - totalSleepMin - sleepOnsetLatencyMin - afterFinalAwakeningMin;
  if (waso < 0) throw new RangeError('components exceed time in bed; inputs are inconsistent');
  return waso;
}

/**
 * Total sleep time from scored stage intervals.
 * @param {{stage:string, minutes:number}[]} intervals
 * @param {string[]} [sleepStages] stages counted as sleep
 */
export function totalSleepTime(intervals, sleepStages = ['light', 'deep', 'rem', 'sws', 'n1', 'n2', 'n3']) {
  if (!Array.isArray(intervals)) throw new TypeError('intervals must be an array');
  const set = new Set(sleepStages.map((s) => s.toLowerCase()));
  let total = 0;
  for (const { stage, minutes } of intervals) {
    if (typeof minutes !== 'number' || Number.isNaN(minutes)) throw new TypeError('minutes must be a number');
    if (minutes < 0) throw new RangeError('minutes must be non-negative');
    if (set.has(String(stage).toLowerCase())) total += minutes;
  }
  return total;
}

/** Fraction of total sleep time spent in each stage. Sums to 1 over sleep stages. */
export function stageFractions(intervals, sleepStages) {
  const tst = totalSleepTime(intervals, sleepStages);
  if (tst <= 0) throw new RangeError('no scored sleep in intervals');
  const out = {};
  const set = new Set((sleepStages ?? ['light', 'deep', 'rem', 'sws', 'n1', 'n2', 'n3']).map((s) => s.toLowerCase()));
  for (const { stage, minutes } of intervals) {
    const k = String(stage).toLowerCase();
    if (!set.has(k)) continue;
    out[k] = (out[k] ?? 0) + minutes / tst;
  }
  return out;
}

function req(obj) {
  for (const [n, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError(n + ' must be a number');
  }
}
