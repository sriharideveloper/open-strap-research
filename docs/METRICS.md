# Metrics reference

Every metric in `src/` implements a published, citable definition. Each computes the
standard quantity exactly from its inputs; none reproduces any vendor's proprietary
score, and none should be labelled as one.

## Heart-rate variability

| Function | Definition | Source |
|---|---|---|
| `rmssd(rrMs)` | √( Σ(RRᵢ₊₁ − RRᵢ)² / (N − 1) ) | Task Force of the ESC/NASPE, *Circulation* 93(5):1043–1065, 1996 |
| `filterEctopic(rrMs, maxRelDiff)` | drop intervals differing from the previous kept one by more than a fraction (default 20%) | common practice; threshold is explicit, not a standard |
| `dfaAlpha(series, {minBox, maxBox})` | slope of log F(n) vs log n from detrended fluctuation analysis | Peng et al., *Phys Rev E* 49(2), 1994 |
| `dfaAlpha1(rrMs)` | DFA over 4–16 beat boxes | as above |
| `thresholdFromDfa(points, alpha)` | heart rate at which α₁ crosses a target (0.75 ≈ first, 0.50 ≈ second ventilatory threshold) | Rogers et al., *Front Physiol* 11:596567, 2021; *Eur J Appl Physiol*, 2022 |

**Evidence note on DFA-α₁ thresholds:** supporting studies are small (15–26
participants) and largely from one group. Useful estimates, not gold-standard
measurements.

## Respiration

| Function | Definition | Source |
|---|---|---|
| `resampleTachogram(rrMs, fsHz)` | linear resampling of irregular RR intervals onto a uniform grid | prerequisite for spectral HRV |
| `respiratoryRateFromRsa(rrMs, opts)` | dominant spectral peak of the Hann-windowed tachogram within 0.15–0.40 Hz, × 60 | Task Force 1996 (HF band); Schäfer & Kratky, *Ann Biomed Eng* 36(3), 2008 |

An estimate from heart-rate modulation, not a measured airflow rate.

## Heart-rate reserve and training load

| Function | Definition | Source |
|---|---|---|
| `heartRateReserveFraction(hr, rhr, max)` | (HR − RHR) / (HRmax − RHR), unclamped | Karvonen et al., *Ann Med Exp Biol Fenn* 35(3), 1957 |
| `banisterTrimp(D, ΔHR, b)` | D · ΔHR · 0.64 · e^(b·ΔHR) | Banister, *Physiological Testing of Elite Athletes*, 1991 |
| `banisterTrimpSeries(hrr, {sampleSeconds, coefficient})` | sample-wise integration of the above | — |
| `accumulateZoneTime(hr, bounds, s)` | seconds per heart-rate zone; conserves total time | — |
| `zonesFromMaxHr(max, pct)` | zone lower bounds at 50/60/70/80/90% of max by default | Edwards, *The Heart Rate Monitor Book*, 1993 |
| `edwardsTrimp(zoneSeconds, w)` | Σ(zone minutes × zone weight), weights 1–5 by default | Edwards, 1993 |

The Banister exponent `b` is a required argument; the published cohort values are
exported as `BANISTER_COEFFICIENTS` so the choice stays visible.

## Sleep

| Function | Definition | Source |
|---|---|---|
| `sleepEfficiency(tst, tib)` | 100 · TST / TIB | AASM Manual for the Scoring of Sleep |
| `sleepPerformance(tst, need)` | 100 · TST / sleep need; not clamped at 100 | — |
| `wakeAfterSleepOnset({...})` | TIB − TST − sleep-onset latency − time after final awakening | AASM |
| `totalSleepTime(intervals)` / `stageFractions(intervals)` | aggregation of scored stage intervals | AASM stage terminology |
| `sleepRegularityIndex(epochs, perDay)` | −100 + 200 · P(same sleep/wake state 24 h apart) | Phillips et al., *Sci Rep* 7:3216, 2017 |

Sleep need is personal and is **never defaulted**; without it, sleep performance is
reported as `unavailable`.

## Baselines

| Function | Definition |
|---|---|
| `rollingMean` / `rollingStd` | trailing window statistics; SD is Bessel-corrected |
| `zScore(v, mean, sd)` | (v − mean) / sd; 0 when sd is 0 |
| `percentileRank(v, history)` | midrank convention for ties, 0–100 |
| `learnBaseline(samples, {windowSize, isEligible})` | windowed mean and SD with an optional eligibility filter; returns `sufficient: false` rather than a number when fewer than two samples qualify |

## Provenance and confidence

Every computed value is `{ value, unit, provenance }` where provenance records
`source`, `method`, `algorithmVersion`, `confidence`, `inputs` and a `citation`.
Confidence levels are `confirmed` (standard definition, adequate inputs),
`candidate`, `interpretive` and `low`. Production metrics in `src/` are all
`confirmed`. Use `atConfidence(summary, ['confirmed'])` to filter.
