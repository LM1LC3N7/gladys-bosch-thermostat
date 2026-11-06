// -----------------------------------------------------------------------------
// The encryption (the test vector of the reference), and the answers checked
// and reduced: identity hashed, numbers strict and plausible, lists bounded.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { decrypt, deriveKey, encrypt } from '../src/km/crypto.js';
import {
  circuitsOf,
  firmwareOf,
  identityKey,
  keyOf,
  measureOf,
  modeOf,
  offModeOf,
  setpointOf,
} from '../src/model.js';

test('the key of the reference test vector (tests/test_aes.py) opens its ciphertext', () => {
  const key = deriveKey('abc1abc2abc3abc4', 'passworddddd');
  const d = createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(false);
  const plain = Buffer.concat([
    d.update(Buffer.from('TTZEYuh9QQoc0fjUgElBwA==', 'base64')),
    d.final(),
  ]);
  assert.equal(plain.toString('utf8').replace(/\0+$/, ''), 'super_secret');
  // Dashes of the token printed on the gateway are ignored.
  assert.deepEqual(deriveKey('abc1-abc2-abc3-abc4', 'passworddddd'), key);
});

test('encrypt then decrypt: zero padding, base64; another key: garbled; no ciphertext: malformed', () => {
  const key = deriveKey('Ab12Cd34Ef56Gh78', 'pw');
  for (const value of [{ value: 'Off' }, { value: 21.5 }, { a: 'x'.repeat(16) }]) {
    const body = encrypt(key, value);
    assert.match(body, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(Buffer.from(body, 'base64').length % 16, 0);
    assert.deepEqual(decrypt(key, `${body}\r\n`).json, value);
  }
  const other = deriveKey('Ab12Cd34Ef56Gh78', 'other');
  assert.deepEqual(decrypt(other, encrypt(key, { value: 1 })), { garbled: true });
  for (const body of ['', '{"value":1}', 'abc', Buffer.from('short').toString('base64'), null]) {
    assert.deepEqual(decrypt(key, body), { malformed: true }, String(body));
  }
});

test('identity: the uuid hashed, unknown when missing (never another gateway)', () => {
  assert.equal(keyOf({ value: '123456789' }), identityKey('123456789'));
  assert.equal(keyOf({ value: 123456789 }), identityKey('123456789'));
  assert.match(identityKey('123456789'), /^[0-9a-f]{16}$/);
  for (const value of ['', null, undefined, ' ', 'a b', 0, -1, 1.5, 'x'.repeat(65)]) {
    assert.equal(keyOf({ value }), undefined, String(value));
  }
  assert.equal(keyOf(JSON.parse('{"__proto__":{"value":"1"}}')), undefined);
  assert.equal(firmwareOf({ value: '04.08.02' }), '04.08.02');
  assert.equal(firmwareOf({ value: '<script>' }), undefined);
});

test('measures: floatValue in its unit and range only, never a text as 0', () => {
  const r = { min: -50, max: 60, units: ['C', '°C'] };
  const f = (value, extra = {}) => ({ type: 'floatValue', value, unitOfMeasure: 'C', ...extra });
  assert.equal(measureOf(f(4.46), r), 4.5);
  for (const bad of [
    f(-3276.8),
    f(3276.7),
    f('4.5'),
    f(null),
    f(''),
    f(true),
    f(4.5, { unitOfMeasure: 'F' }),
    f(4.5, { unitOfMeasure: undefined }),
    f(4.5, { type: 'stringValue' }),
  ]) {
    assert.equal(measureOf(bad, r), undefined, JSON.stringify(bad));
  }
});

test('setpoints: value and bounds required, writeable read', () => {
  const s = (extra) => ({
    type: 'floatValue',
    value: 21,
    minValue: 5,
    maxValue: 30,
    unitOfMeasure: 'C',
    writeable: 1,
    ...extra,
  });
  assert.deepEqual(setpointOf(s()), { value: 21, min: 5, max: 30, writable: true });
  assert.equal(setpointOf(s({ writeable: 0 })).writable, false);
  for (const bad of [
    s({ minValue: undefined }),
    s({ maxValue: '30' }),
    s({ minValue: 40 }),
    s({ maxValue: 300 }),
    s({ value: null }),
    s({ unitOfMeasure: 'F' }),
  ]) {
    assert.equal(setpointOf(bad), undefined, JSON.stringify(bad));
  }
});

test('modes: value checked, allowed values unique and bounded, the "off" found', () => {
  const m = modeOf({
    type: 'stringValue',
    value: 'high',
    writeable: 1,
    allowedValues: ['Off', 'high', 'high', 'bad value', 7, 'x'.repeat(40), 'low'],
  });
  assert.deepEqual(m, { value: 'high', allowed: ['Off', 'high', 'low'], writable: true });
  assert.equal(offModeOf(m.allowed), 'Off');
  assert.equal(offModeOf(['manual', 'auto']), undefined);
  assert.equal(modeOf({ type: 'stringValue', value: 'a b' }), undefined);
  assert.equal(modeOf({ type: 'floatValue', value: 1 }), undefined);
  const many = modeOf({
    type: 'stringValue',
    value: 'm0',
    allowedValues: Array.from({ length: 40 }, (_, i) => `m${i}`),
  });
  assert.equal(many.allowed.length, 12);
});

test('circuits: the references of the folder, names checked, bounded', () => {
  const refs = (ids) => ({ type: 'refEnum', references: ids.map((id) => ({ id })) });
  assert.deepEqual(
    circuitsOf(
      refs([
        '/heatingCircuits/hc1',
        '/heatingCircuits/hc1',
        '/heatingCircuits/hc2',
        '/heatingCircuits/../x',
        '/dhwCircuits/dhw1',
        '/heatingCircuits/hc9',
        '/heatingCircuits/hc3',
        '/heatingCircuits/hc4',
        '/heatingCircuits/hc5',
      ]),
      'hc',
    ),
    ['hc1', 'hc2', 'hc3', 'hc4'],
  );
  assert.deepEqual(circuitsOf(refs(['/dhwCircuits/dhw1', '/dhwCircuits/dhw2']), 'dhw'), [
    'dhw1',
    'dhw2',
  ]);
  assert.equal(circuitsOf({ type: 'stringValue' }, 'hc'), undefined);
  assert.equal(circuitsOf({ type: 'refEnum', references: 'x' }, 'hc'), undefined);
});

test('a refusal only when the first block does not open: a broken answer with our key is malformed', () => {
  const key = deriveKey('Ab12Cd34Ef56Gh78', 'pw');
  const answer = {
    id: '/system/sensors/temperatures/outdoor_t1',
    type: 'floatValue',
    value: 4.5,
    unitOfMeasure: 'C',
  };
  const full = encrypt(key, answer);
  // Cut on a block boundary (close-delimited, no Content-Length): 48 bytes.
  assert.deepEqual(decrypt(key, full.slice(0, 64)), { malformed: true });
  // A byte that is no UTF-8 (Latin-1 "é") in a text, our key.
  const plain = Buffer.from(JSON.stringify({ ...answer, name: 'Aussen_X' }), 'utf8');
  plain[plain.indexOf('X')] = 0xe9;
  const padded = Buffer.alloc(Math.ceil(plain.length / 16) * 16);
  plain.copy(padded);
  const c = createCipheriv('aes-256-ecb', key, null);
  c.setAutoPadding(false);
  const latin = Buffer.concat([c.update(padded), c.final()]).toString('base64');
  assert.deepEqual(decrypt(key, latin), { malformed: true });
  // A short answer: its zero padding inside the first block is fine.
  assert.deepEqual(decrypt(key, encrypt(key, { a: 1 })).json, { a: 1 });
  // Another key, and a ciphertext of junk: refused.
  assert.deepEqual(decrypt(deriveKey('Ab12Cd34Ef56Gh78', 'other'), full), { garbled: true });
  assert.deepEqual(decrypt(key, Buffer.alloc(32, 7).toString('base64')), { garbled: true });
});
