// -----------------------------------------------------------------------------
// The answers of the gateway, checked and reduced (pure). Untrusted input:
// own keys only (`Object.hasOwn`), strict types, bounded lists, a value out
// of its plausible range (a sensor not fitted reads -3276.8 or 3276.7) is no
// measurement.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { KINDS, LIMITS, MODE_VALUE, OFF_MODES } from './constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/** A printable text of at most `max` characters, else undefined. */
export function textOf(value, max = LIMITS.nameLength) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim();
  return clean === '' ? undefined : clean.slice(0, max);
}

const UUID = /^[\x21-\x7e]{1,64}$/;

/**
 * The stable key of a gateway, from its uuid (its serial number): a hash,
 * the uuid itself is never published.
 */
export const identityKey = (uuid) =>
  createHash('sha256').update(`bosch-km:${uuid}`).digest('hex').slice(0, 16);

/** /gateway/uuid -> the key of the gateway, or undefined (unknown, never "another one"). */
export function keyOf(answer) {
  const value = own(answer, 'value');
  const text = Number.isSafeInteger(value) && value > 0 ? String(value) : value;
  return typeof text === 'string' && UUID.test(text) ? identityKey(text) : undefined;
}

/** /gateway/versionFirmware -> a short text, or undefined. */
export const firmwareOf = (answer) =>
  /^[0-9A-Za-z._-]{1,20}$/.test(String(own(answer, 'value') ?? ''))
    ? own(answer, 'value')
    : undefined;

/** A finite number of the answer (never a text, a boolean, null or ''). */
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * A floatValue in `units` and within [min, max], rounded to 0.1, else
 * undefined. The gateway gives temperatures in "C".
 */
export function measureOf(answer, { min, max, units }) {
  if (own(answer, 'type') !== 'floatValue') {
    return undefined;
  }
  const value = finite(own(answer, 'value'));
  if (value === undefined || value < min || value > max) {
    return undefined;
  }
  if (!units.includes(own(answer, 'unitOfMeasure'))) {
    return undefined;
  }
  return Math.round(value * 10) / 10;
}

export const CELSIUS = ['C', '°C'];

/**
 * A setpoint path -> { value, min, max, writable } (value within its own
 * bounds, °C), or undefined when any of them is missing or implausible.
 */
export function setpointOf(answer) {
  if (own(answer, 'type') !== 'floatValue' || !CELSIUS.includes(own(answer, 'unitOfMeasure'))) {
    return undefined;
  }
  const value = finite(own(answer, 'value'));
  const min = finite(own(answer, 'minValue'));
  const max = finite(own(answer, 'maxValue'));
  if (
    value === undefined ||
    min === undefined ||
    max === undefined ||
    min > max ||
    min < 0 ||
    max > 100
  ) {
    return undefined;
  }
  const writeable = own(answer, 'writeable');
  return { value, min, max, writable: writeable === undefined ? true : writeable === 1 };
}

/**
 * An operationMode path -> { value, allowed } (the current mode and the
 * modes it lists, checked, unique, bounded), or undefined.
 */
export function modeOf(answer) {
  if (own(answer, 'type') !== 'stringValue') {
    return undefined;
  }
  const value = own(answer, 'value');
  if (typeof value !== 'string' || !MODE_VALUE.test(value)) {
    return undefined;
  }
  const list = own(answer, 'allowedValues');
  const allowed = [];
  if (Array.isArray(list)) {
    for (const item of list.slice(0, 32)) {
      if (
        typeof item === 'string' &&
        MODE_VALUE.test(item) &&
        !allowed.includes(item) &&
        allowed.length < LIMITS.modes
      ) {
        allowed.push(item);
      }
    }
  }
  const writeable = own(answer, 'writeable');
  return { value, allowed, writable: writeable === undefined ? true : writeable === 1 };
}

/** The "off" value a circuit lists, else undefined. */
export const offModeOf = (allowed) => (allowed ?? []).find((m) => OFF_MODES.has(m));

/**
 * A folder (/heatingCircuits, /dhwCircuits) -> the circuit names it lists
 * (hc1, dhw1...), in order, unique, bounded; undefined when it is no
 * reference list.
 */
export function circuitsOf(answer, kind) {
  if (own(answer, 'type') !== 'refEnum') {
    return undefined;
  }
  const list = own(answer, 'references');
  if (!Array.isArray(list)) {
    return undefined;
  }
  const { folder, name, max } = KINDS[kind];
  const names = [];
  for (const ref of list.slice(0, LIMITS.references)) {
    const id = own(ref, 'id');
    if (typeof id !== 'string' || !id.startsWith(`${folder}/`)) {
      continue;
    }
    const circuit = id.slice(folder.length + 1);
    if (name.test(circuit) && !names.includes(circuit) && names.length < max) {
      names.push(circuit);
    }
  }
  return names;
}
