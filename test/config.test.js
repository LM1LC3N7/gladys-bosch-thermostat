import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionKey,
  dhwCeilingOf,
  normalizeConfig,
  numberOf,
  parseAddress,
  tokenOf,
} from '../src/config.js';

const OK = { address: '192.168.1.50', token: 'Ab12-Cd34-Ef56-Gh78', password: 'x' };

test('addresses: host or host:port, http only, no special address', () => {
  assert.deepEqual(parseAddress('192.168.1.50'), { host: '192.168.1.50', port: 80 });
  assert.deepEqual(parseAddress(' http://192.168.1.50:8080/ '), {
    host: '192.168.1.50',
    port: 8080,
  });
  assert.deepEqual(parseAddress('KM200.local'), { host: 'km200.local', port: 80 });
  for (const [raw, problem] of [
    ['', 'noAddress'],
    [undefined, 'noAddress'],
    ['https://192.168.1.50', 'https'],
    ['192.168.1.50:0', 'badAddress'],
    ['192.168.1.50:70000', 'badAddress'],
    ['192.168.001.50', 'badAddress'],
    ['192.168.1', 'badAddress'],
    ['[::1]', 'badAddress'],
    ['a b', 'badAddress'],
    ['host/path', 'badAddress'],
    ['u:p@host', 'badAddress'],
    ['0.0.0.0', 'specialAddress'],
    ['255.255.255.255', 'specialAddress'],
    ['192.168.1.255', 'specialAddress'],
    ['192.168.1.0', 'specialAddress'],
    ['224.0.0.1', 'specialAddress'],
    ['host\r\nx', 'badAddress'],
  ]) {
    assert.equal(parseAddress(raw).problem, problem, String(raw));
  }
});

test('the access token: dashes and spaces ignored, letters and digits only', () => {
  assert.equal(tokenOf('Ab12-Cd34-Ef56-Gh78'), 'Ab12Cd34Ef56Gh78');
  assert.equal(tokenOf(' ab12 cd34 '), 'ab12cd34');
  for (const bad of ['', 'abc', 'Ab12-Cd34-Ef56-Gh78-é', 'a\r\nb12345678', 'x'.repeat(33), 42]) {
    assert.equal(tokenOf(bad), undefined, String(bad));
  }
});

test('numbers are strict; the hot water ceiling never above 65 °C', () => {
  assert.equal(numberOf(''), undefined);
  assert.equal(numberOf(null), undefined);
  assert.equal(numberOf('12abc'), undefined);
  assert.equal(numberOf(Number.NaN), undefined);
  assert.equal(numberOf(' 55 '), 55);
  assert.equal(dhwCeilingOf(90), 65);
  assert.equal(dhwCeilingOf('70'), 65);
  assert.equal(dhwCeilingOf(10), 40);
  assert.equal(dhwCeilingOf(55.9), 55);
  assert.equal(dhwCeilingOf(''), 65);
});

test('the configuration: defaults, options off unless strictly true, credentials checked', () => {
  const c = normalizeConfig({ ...OK, allow_commands: 'yes' });
  assert.equal(c.problem, undefined);
  assert.equal(c.token, 'Ab12Cd34Ef56Gh78');
  assert.equal(c.allowCommands, false);
  assert.equal(c.pollInterval, 60);
  assert.equal(c.dhwCeiling, 65);
  assert.equal(c.language, 'fr');
  assert.equal(normalizeConfig({ ...OK, allow_commands: true }).allowCommands, true);
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 30);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, 900);
  assert.equal(normalizeConfig({ ...OK, token: '' }).problem, 'noToken');
  assert.equal(normalizeConfig({ ...OK, token: 'x' }).problem, 'badToken');
  assert.equal(normalizeConfig({ ...OK, password: '' }).problem, 'noPassword');
  assert.equal(normalizeConfig({ ...OK, password: 'a\nb' }).problem, 'badPassword');
  assert.equal(normalizeConfig({ ...OK, password: 'x'.repeat(65) }).problem, 'badPassword');
  assert.equal(normalizeConfig({ ...OK, password: 'éè€' }).problem, undefined);
  assert.equal(
    normalizeConfig({ ...OK, gladys_password: 'x', password: '' }).problem,
    'noPassword',
  );
  const bad = normalizeConfig({ ...OK, address: 'x y', password: 'secret' });
  assert.equal(bad.password, '', 'never kept when unusable');
  assert.equal(bad.token, '');
  assert.notEqual(
    connectionKey(normalizeConfig(OK)),
    connectionKey(normalizeConfig({ ...OK, password: 'y' })),
  );
  assert.notEqual(
    connectionKey(normalizeConfig(OK)),
    connectionKey(normalizeConfig({ ...OK, token: 'Zz12-Cd34-Ef56-Gh78' })),
  );
});
