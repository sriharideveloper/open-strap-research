# Contributing

Thanks for helping. A few rules keep this project trustworthy.

## Ground rules

1. **No bypassing access controls.** Do not contribute code that defeats authentication, extracts credentials, or circumvents subscription or membership enforcement on any device or service.
2. **No proprietary code or data.** Do not submit vendor source code, vendor assets, or data you are not entitled to share.
3. **Never label an output as an official vendor score.** Metrics here are independent implementations of published definitions.
4. **Cite your method.** Every new metric needs a published reference in its module header and a `citation` in its provenance.
5. **No silent defaults.** If a parameter is unknown, make it a required argument that throws when omitted. A plausible guessed default is indistinguishable from a real value a few commits later.
6. **`src/` stays published-science only.** An architecture test enforces that `src/` never imports from `experimental/`.

## Tests

```bash
npm test
```

Prefer tests that can fail independently of your implementation: closed-form anchors, invariants, conservation laws, planted signals that must be recovered. A test that re-runs the function's own arithmetic proves only that the code agrees with itself.

## Most wanted

**Authorized, time-aligned reference data from a real band**: heart-rate notifications captured from your own device, the device generation, how it was captured, and (if available) the values your official app showed for the same period. Without this, nothing here can be validated against real hardware.

## Reporting a problem

Open an issue with the input that triggers it, the expected result and its source, and the actual result.
