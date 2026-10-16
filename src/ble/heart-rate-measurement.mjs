/**
 * Parser for the standard Bluetooth Heart Rate Measurement characteristic.
 *
 * PUBLISHED SPECIFICATION. Not WHOOP-proprietary, not patent-derived.
 *   Bluetooth SIG, Heart Rate Service 1.0 (HRS) and the GATT Specification
 *   Supplement: Heart Rate Measurement, characteristic UUID 0x2A37, carried by the
 *   Heart Rate service 0x180D.
 *
 * WHY THIS PATH: WHOOP's developer FAQ states that its devices can broadcast heart
 * rate over BLE to third-party listeners. That is the one vendor-
 * sanctioned route to live data that needs no API credential and no defeat of
 * authentication. Whether WHOOP uses the standard 0x180D service for it is NOT yet
 * verified against a band - this parser implements the standard and will be
 * correct for any spec-conformant device.
 *
 * Layout:
 *   byte 0      flags
 *     bit 0       heart rate format: 0 = UINT8, 1 = UINT16
 *     bit 1       sensor contact detected (meaningful only if bit 2 is set)
 *     bit 2       sensor contact feature supported
 *     bit 3       energy expended present (UINT16, kilojoules)
 *     bit 4       RR-interval(s) present (UINT16 each, units of 1/1024 s)
 *     bits 5-7    reserved for future use
 *   then        heart rate (UINT8 or UINT16, little-endian)
 *   then        energy expended (UINT16 LE), if flagged
 *   then        RR-intervals (UINT16 LE each), if flagged, to end of payload
 */

export const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
export const HEART_RATE_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';
export const PARSER_VERSION = '1.0.0';

/** RR intervals are transmitted in units of 1/1024 second. */
export const RR_UNITS_PER_SECOND = 1024;

/**
 * @param {Uint8Array|number[]} payload raw characteristic value
 * @returns {{
 *   heartRateBpm:number, heartRateFormat:'uint8'|'uint16',
 *   sensorContact:'unsupported'|'detected'|'not-detected',
 *   energyExpendedKj:number|null, rrRaw:number[], rrMs:number[],
 *   reservedFlagBits:number
 * }}
 */
export function parseHeartRateMeasurement(payload) {
  // Validate BEFORE converting: Uint8Array.from() silently wraps out-of-range
  // values (256 -> 0), which would turn corrupt input into a plausible reading.
  if (!(payload instanceof Uint8Array)) {
    if (!Array.isArray(payload)) throw new TypeError('payload must be a Uint8Array or an array of bytes');
    for (const v of payload) {
      if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError('payload must contain bytes 0..255');
    }
  }
  const b = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (b.length < 2) throw new RangeError('payload too short: need at least flags and one heart rate byte');

  const flags = b[0];
  const hr16 = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const hasEnergy = (flags & 0x08) !== 0;
  const hasRr = (flags & 0x10) !== 0;

  let i = 1;
  const need = (n, what) => {
    if (i + n > b.length) throw new RangeError(`payload truncated reading ${what}`);
  };

  let heartRateBpm;
  if (hr16) { need(2, 'UINT16 heart rate'); heartRateBpm = b[i] | (b[i + 1] << 8); i += 2; }
  else { heartRateBpm = b[i]; i += 1; }

  let energyExpendedKj = null;
  if (hasEnergy) { need(2, 'energy expended'); energyExpendedKj = b[i] | (b[i + 1] << 8); i += 2; }

  const rrRaw = [];
  if (hasRr) {
    const remaining = b.length - i;
    if (remaining === 0) throw new RangeError('RR flag set but no RR-interval bytes present');
    if (remaining % 2 !== 0) throw new RangeError('RR-interval field has an odd byte count');
    for (; i < b.length; i += 2) rrRaw.push(b[i] | (b[i + 1] << 8));
  } else if (i !== b.length) {
    throw new RangeError(`unexpected ${b.length - i} trailing byte(s) for the flags given`);
  }

  return Object.freeze({
    heartRateBpm,
    heartRateFormat: hr16 ? 'uint16' : 'uint8',
    sensorContact: !contactSupported ? 'unsupported' : (contactDetected ? 'detected' : 'not-detected'),
    energyExpendedKj,
    rrRaw: Object.freeze(rrRaw),
    rrMs: Object.freeze(rrRaw.map((v) => (v * 1000) / RR_UNITS_PER_SECOND)),
    reservedFlagBits: flags & 0xe0,
  });
}

/** Hex encoding for preserving the original bytes alongside parsed values. */
export function toHex(payload) {
  return Array.from(payload, (v) => v.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new RangeError('invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.slice(2 * k, 2 * k + 2), 16);
  return out;
}
