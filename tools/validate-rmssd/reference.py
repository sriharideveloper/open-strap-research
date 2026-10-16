"""Independent RMSSD references for validating src/metrics/rmssd.mjs.

Reads a JSON list of cases from argv[1]; each case has `rr_units`, RR intervals as
integers in 1/1024 s (the unit the Bluetooth Heart Rate Measurement characteristic
uses). Writes results as JSON to stdout.

Two references, deliberately different from the JavaScript implementation:

1. numpy   - a separately written vectorised formula. Same definition, different
             language and code path. Catches implementation slips, but shares the
             author's reading of the definition.
2. neurokit2 - NeuroKit2's hrv_time() (Makowski et al., Behavior Research Methods
             53:1689-1696, 2021). Independent authorship: if the definition had been
             misread here, this is the reference that would disagree.

NeuroKit2 takes beat positions, not intervals. With sampling_rate=1024 the cumulative
sums of 1/1024 s units are exact integers, so no rounding enters the comparison.
"""
import json
import os
import sys

PYLIBS = os.environ.get("WHOOP_PYLIBS", r"D:\tools\pylibs")
if os.path.isdir(PYLIBS) and PYLIBS not in sys.path:
    sys.path.insert(0, PYLIBS)

import numpy as np  # noqa: E402

try:
    import neurokit2 as nk  # noqa: E402
    NK_VERSION = nk.__version__
except Exception as exc:  # pragma: no cover - reported in output
    nk = None
    NK_VERSION = "unavailable: " + type(exc).__name__ + ": " + str(exc)[:200]


def rmssd_numpy(rr_ms):
    d = np.diff(np.asarray(rr_ms, dtype=np.float64))
    return float(np.sqrt(np.mean(d * d)))


def rmssd_neurokit(rr_units):
    peaks = np.concatenate([[0], np.cumsum(np.asarray(rr_units, dtype=np.int64))])
    out = nk.hrv_time(peaks, sampling_rate=1024, show=False)
    return float(out["HRV_RMSSD"].iloc[0])


def main():
    cases = json.load(open(sys.argv[1], encoding="utf-8"))
    results = []
    for c in cases:
        rr_ms = [u * 1000.0 / 1024.0 for u in c["rr_units"]]
        row = {"name": c["name"], "n": len(rr_ms), "numpy": rmssd_numpy(rr_ms)}
        if nk is not None:
            try:
                row["neurokit2"] = rmssd_neurokit(c["rr_units"])
            except Exception as exc:
                row["neurokit2_error"] = type(exc).__name__ + ": " + str(exc)[:200]
        results.append(row)
    json.dump({
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "neurokit2": NK_VERSION,
        "results": results,
    }, sys.stdout)


if __name__ == "__main__":
    main()
