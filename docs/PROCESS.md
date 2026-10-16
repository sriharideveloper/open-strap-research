# How this was built

A record of the method, including the corrections — because the corrections are
where most of the useful lessons are.

## Goal and constraints

The starting brief was an independent client for WHOOP hardware the user owns.
Two constraints governed everything:

- **Interoperability only.** No defeating authentication, extracting credentials,
  or bypassing membership enforcement.
- **No unearned claims.** Every finding is labelled CONFIRMED, STRONGLY INFERRED,
  TENTATIVE, UNKNOWN or BLOCKED, and nothing is presented as an official score.

## Environment

- Windows 11, Node.js 24 (built-in `node:test` and `node:sqlite`, so no runtime
  dependencies), Python 3.14 with NumPy for cross-checks.
- All tooling installed to a secondary drive; the system drive had about 1 GB free.

## What the investigation established (summary)

1. **Where the numbers come from.** The headline scores (recovery, strain, sleep)
   are computed by the vendor's servers, not by the phone app. The app receives
   finished values and display layout. Reproducing those scores from app code is
   therefore not possible — the logic is not in the app.
2. **The official developer API** is documented, OAuth-based, read-only and free
   to use, but every user whose data flows through it needs an active membership.
   It cannot underpin a subscription-free tool.
3. **The one vendor-sanctioned, credential-free path** is the band's documented
   ability to broadcast heart rate over Bluetooth to third-party receivers. This
   repository implements the standard Bluetooth Heart Rate profile for that reason.
   Whether the band uses the standard profile, includes RR intervals, or needs
   the official app to enable broadcasting is **not yet verified**.
4. **No band was available.** A passive Bluetooth scan on the development machine
   found three unrelated devices and nothing advertising the heart-rate service.

## Engineering choices

- **Provenance is part of the value.** A computed number cannot exist here without
  its unit, method, algorithm version, confidence and citation.
- **Absence is explicit.** Missing inputs produce `unavailable` with a reason.
- **Raw bytes are kept.** Stored observations retain the original payload, so any
  parser fix can be re-applied and integrity re-checked without re-collecting data.
- **Unknown parameters throw.** Where a published method leaves a constant
  unspecified, it is a required argument, never a plausible default.
- **Production and experiment are separated mechanically.** A test fails if `src/`
  ever imports from `experimental/`, and it was checked by planting a forbidden
  import and confirming the failure.

## Validation approach

Tests assert properties that can fail independently of the implementation:
closed-form anchors (RMSSD of a constant series is exactly 0), invariants (Sleep
Regularity Index stays within ±100), known theoretical values (DFA of white noise
≈ 0.5, of a random walk ≈ 1.5, and integrating raises the exponent by one),
conservation (zone time sums to total time) and planted signals (a breathing rate
injected into synthetic data must be recovered — it was, to within 0.04 breaths/min,
and again after a round trip through the Bluetooth byte format and SQLite).

RMSSD was additionally checked against a separately written NumPy implementation
on five datasets, agreeing to 1e-9 relative. An attempt to also check against a
third-party HRV library failed to install under Python 3.14 and is still to do;
the NumPy check is weaker because it shares this project's reading of the
definition.

## Corrections made along the way

| What was claimed | What was wrong | How it was caught |
|---|---|---|
| A patent was listed as the vendor's | Its front page named a different assignee | Reading the front page instead of trusting a search result |
| A second patent looked like independent evidence | It shared a provisional and specification with another, so it was the same evidence twice | Checking priority data |
| Litigation was stated as fact | It came from secondary summaries; the docket was never read | User review; four attempts to read the primary record were blocked and the claim was downgraded |
| An equation was taken from a text extraction | The tool had reconstructed it from surrounding prose | Re-reading the original page image |
| A device family was "missing" | The search pattern could not match its naming | Returning to primary evidence |
| A byte value of 256 was rejected | `Uint8Array.from` silently wrapped it to 0 before validation | A test that expected an error |

The common thread: a summary of a source is not the source.

## What remains

- Capture from a real band, with its generation recorded.
- Authorized reference values to compare against.
- A third-party reference for the RMSSD cross-check.
