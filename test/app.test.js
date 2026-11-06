// -----------------------------------------------------------------------------
// The reads, the device, the failures, /data, the configuration, against the
// SDK's fake Gladys and a fake KM gateway on a virtual clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/store.js';
import { identityKey } from '../src/model.js';
import { deriveKey } from '../src/km/crypto.js';
import { CONFIG, OTHER_UUID, PASSWORD, TOKEN, UUID } from './fixtures/km.js';
import { DEVICE, F, HOUR, MINUTE, SECOND, last, setup } from './helpers/app.js';

const statusText = (t) => t.gladys.fake.connectionStatus?.message?.fr ?? '';
const reads = (t) => t.dev.count('/gateway/uuid');

test('discovery, then the states of the created device', async () => {
  const t = await setup();
  await t.connect();
  const device = t.gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
  assert.ok(device, 'discovered');
  assert.equal(device.name, 'Passerelle Buderus KM');
  assert.deepEqual(device.params, [{ name: 'firmware', value: '04.08.02' }]);
  const roles = device.features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(roles, [
    'outdoor-temperature',
    'supply-temperature',
    'system-pressure',
    'hc1-temperature',
    'hc1-setpoint',
    'hc1-mode',
    'dhw1-temperature',
    'dhw1-setpoint',
    'dhw1-mode',
    'status',
  ]);
  // No switch nor binary: a "turn everything off" never reaches the boiler.
  assert.ok(device.features.every((f) => !['switch', 'binary'].includes(f.category)));
  assert.ok(device.features.every((f) => f.type !== 'binary'));
  const byRole = (role) => device.features.find((f) => f.external_id === F(role));
  assert.equal(byRole('hc1-setpoint').category, 'thermostat');
  assert.equal(byRole('dhw1-setpoint').category, 'water-heater');
  assert.equal(byRole('dhw1-setpoint').max, 65);
  assert.equal(byRole('dhw1-temperature').type, 'probe');
  assert.equal(byRole('system-pressure').unit, 'bar');
  assert.deepEqual(
    byRole('dhw1-mode').supported_options.map((o) => [o.value, o.label]),
    [
      ['Off', 'Arrêt'],
      ['high', 'Confort'],
      ['low', 'Réduit'],
      ['eco', 'Éco'],
      ['ownprogram', 'Programme personnel'],
    ],
  );
  // The uuid (the serial of the gateway) is never published.
  assert.ok(!JSON.stringify(t.gladys.fake.discoveredDevices).includes(UUID));
  await t.create();
  assert.equal(last(t.gladys, 'outdoor-temperature'), 4.5);
  assert.equal(last(t.gladys, 'system-pressure'), 1.6);
  assert.equal(last(t.gladys, 'hc1-temperature'), 20.5);
  assert.equal(last(t.gladys, 'hc1-setpoint'), 21);
  assert.equal(last(t.gladys, 'hc1-mode'), 'auto');
  assert.equal(last(t.gladys, 'dhw1-temperature'), 52.3);
  assert.equal(last(t.gladys, 'dhw1-setpoint'), 60);
  assert.equal(last(t.gladys, 'dhw1-mode'), 'high');
  assert.equal(last(t.gladys, 'status'), 'OK');
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
  assert.match(statusText(t), /Connecté à la passerelle \(micrologiciel 04\.08\.02\)/);
  assert.equal(t.dev.peak, 1, 'one connection at a time');
  // The header the gateway expects, accepted for this integration.
  assert.ok(t.dev.requests.every((r) => r.method === 'GET'));
  assert.deepEqual(t.gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: 'local',
  });
});

test('a sensor not fitted (-3276.8), a wrong unit, a text: never a measurement', async () => {
  const t = await setup();
  t.dev.paths['/system/sensors/temperatures/outdoor_t1'].value = -3276.8;
  t.dev.paths['/system/sensors/temperatures/supply_t1'].unitOfMeasure = 'F';
  t.dev.paths['/heatSources/systemPressure'].value = '1.6';
  await t.connect();
  await t.create();
  assert.equal(last(t.gladys, 'outdoor-temperature'), undefined);
  assert.equal(last(t.gladys, 'supply-temperature'), undefined);
  assert.equal(last(t.gladys, 'system-pressure'), undefined);
  for (const s of t.gladys.fake.states) {
    if (/:(hc1-mode|dhw1-mode|status)$/.test(s.device_feature_external_id)) {
      assert.equal(typeof s.text, 'string');
      assert.equal(s.state, undefined);
    }
  }
});

test('a value the gateway does not have (404) is left out, never a failure', async () => {
  const t = await setup();
  delete t.dev.paths['/heatSources/systemPressure'];
  t.dev.route = (path) =>
    path === '/system/sensors/temperatures/supply_t1' ? { status: 403, body: '' } : undefined;
  await t.connect();
  await t.create();
  assert.equal(t.app.session.online, true);
  assert.equal(last(t.gladys, 'outdoor-temperature'), 4.5);
  assert.equal(last(t.gladys, 'hc1-mode'), 'auto');
  assert.equal(last(t.gladys, 'status'), 'OK');
});

test('a circuit listed but not fitted (no mode) gives no feature', async () => {
  const t = await setup();
  await t.connect();
  const device = t.gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
  assert.ok(!device.features.some((f) => f.external_id.includes(':hc2-')));
  assert.equal(t.dev.count('/heatingCircuits/hc2/operationMode'), 1);
});

test('reads every interval, measured from the start of the read before', async () => {
  const t = await setup({ latency: 200 });
  await t.connect();
  const first = reads(t);
  await t.wait(50 * SECOND);
  assert.equal(reads(t), first);
  await t.wait(11 * SECOND);
  assert.equal(reads(t), first + 1);
  await t.wait(60 * SECOND);
  assert.equal(reads(t), first + 2);
});

test('a restart never reads sooner than the interval after the last read (in /data)', async () => {
  const store = memoryStore();
  const a = await setup({ store });
  await a.connect();
  assert.equal(reads(a), 1);
  await a.app.stop();
  await a.wait(20 * SECOND);
  const b = await setup({ store, clock: a.clock });
  await b.connect();
  assert.equal(reads(b), 0, 'not at once');
  await b.wait(41 * SECOND);
  assert.equal(reads(b), 1);
});

test('a date of /data in the future is invalid: read at once', async () => {
  const store = memoryStore({ lastReadAt: Date.UTC(2030, 0, 1) });
  const t = await setup({ store });
  await t.connect();
  assert.equal(reads(t), 1);
});

test('getConfig() failing at the start is tried again without end, then the reads begin', async () => {
  // Call 1 is the SDK's own resynchronization (it reconnects when that one
  // fails); calls 2 to 4 are those of the integration, made to fail.
  let calls = 0;
  const t = await setup({
    getConfig: async () => {
      calls += 1;
      if (calls >= 2 && calls <= 4) {
        throw new Error('HTTP 502');
      }
      return CONFIG;
    },
  });
  await t.connect();
  assert.equal(t.dev.requests.length, 0);
  assert.match(statusText(t), /Configuration non lue depuis Gladys ; nouvel essai dans 5 s/);
  await t.wait(5 * SECOND);
  assert.match(statusText(t), /nouvel essai dans 10 s/);
  await t.wait(10 * SECOND);
  assert.match(statusText(t), /nouvel essai dans 30 s/);
  assert.equal(t.dev.requests.length, 0);
  await t.wait(30 * SECOND);
  assert.equal(calls, 5);
  assert.equal(reads(t), 1);
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
});

test('getConfig() failing in `connected` after a reconnection: the session goes on, retried, then resynced', async () => {
  let fail = false;
  const t = await setup({
    getConfig: async () => {
      if (fail) {
        fail = false;
        throw new Error('down');
      }
      return CONFIG;
    },
  });
  await t.connect();
  await t.create();
  fail = true;
  await t.app.connected(() => t.gladys.getConfig());
  assert.ok(t.app.session, 'the session in place goes on');
  assert.ok(t.logger.lines.some((l) => /Reading the configuration failed/.test(l)));
  await t.wait(5 * SECOND + 100);
  assert.equal(t.app.configRetry.step, 0, 'read again and applied');
  assert.match(statusText(t), /Connecté/);
});

test('a wrong password: answers not opened, stopped, persisted, no automatic retry; the button lifts it', async () => {
  const store = memoryStore();
  const t = await setup({ store, config: { ...CONFIG, password: 'wrong' } });
  await t.connect();
  assert.equal(store.data.refused, true);
  assert.match(store.data.fp, /^[0-9a-f]{2}$/);
  assert.match(statusText(t), /ne s’ouvrent pas avec ce code d’accès/);
  const before = reads(t);
  await t.wait(2 * HOUR);
  assert.equal(reads(t), before, 'no automatic retry');
  // The password set in the app changed to the typed one: the button tries.
  t.dev.rekey(TOKEN, 'wrong');
  const answer = await t.during(t.app.testConnection());
  assert.match(answer.value, /Connecté/);
  assert.equal(store.data.refused, false);
  assert.equal(store.data.fp, '');
});

test('other credentials saved lift the refusal at once; a restart with the same keeps it', async () => {
  const store = memoryStore();
  const t = await setup({ store, config: { ...CONFIG, password: 'wrong' } });
  await t.connect();
  assert.equal(store.data.refused, true);
  const again = await setup({ store, config: { ...CONFIG, password: 'wrong' }, clock: t.clock });
  await again.connect();
  assert.equal(reads(again), 0, 'the same credentials: no read');
  await again.during(again.gladys.fake.configUpdated(CONFIG));
  assert.equal(store.data.refused, false);
  assert.equal(reads(again), 1);
});

test('the 8-bit print of refused credentials cannot test a password', async () => {
  const store = memoryStore();
  const t = await setup({ store, config: { ...CONFIG, password: 'wrong' } });
  await t.connect();
  const { refusalPrint } = await import('../src/store.js');
  // 8 bits: 400 guesses fall on the 256 prints, each print fits many passwords.
  const prints = new Set();
  for (let i = 0; i < 400; i += 1) {
    const guess = { host: '192.168.1.50', port: 80, token: 'Ab12Cd34Ef56Gh78', password: `p${i}` };
    prints.add(refusalPrint(store.data.salt, guess));
  }
  assert.match(store.data.fp, /^[0-9a-f]{2}$/);
  assert.ok(prints.size > 150 && prints.size <= 256);
});

test('HTTP 429/5xx: a pause persisted in /data, no read during it', async () => {
  const store = memoryStore();
  const t = await setup({ store });
  await t.connect();
  t.dev.route = () => ({ status: 503, body: '' });
  await t.wait(61 * SECOND);
  assert.ok(store.data.pausedUntil > 0);
  assert.match(statusText(t), /demande de ralentir/);
  t.dev.route = undefined;
  const before = reads(t);
  await t.wait(50 * SECOND);
  assert.equal(reads(t), before);
  await t.wait(2 * MINUTE);
  assert.ok(reads(t) > before);
});

test('unreachable: backoff never sooner than the interval; status says so', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  t.dev.route = () => 'refuse';
  await t.wait(61 * SECOND);
  assert.match(statusText(t), /Passerelle non lue \(unreachable\)/);
  assert.equal(last(t.gladys, 'status'), 'Passerelle injoignable');
  assert.deepEqual(t.gladys.fake.transports.at(-1).transport, 'unreachable');
  const unsent = t.dev.unsent;
  await t.wait(50 * SECOND);
  assert.equal(t.dev.unsent, unsent);
});

test('another gateway at the address: its values never go to the created device', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  t.dev.paths['/gateway/uuid'].value = OTHER_UUID;
  t.dev.paths['/system/sensors/temperatures/outdoor_t1'].value = 30;
  await t.wait(61 * SECOND);
  assert.equal(last(t.gladys, 'outdoor-temperature'), 4.5);
  assert.equal(last(t.gladys, 'status'), 'Une autre passerelle KM répond à cette adresse');
  const other = identityKey(OTHER_UUID);
  assert.ok(t.gladys.fake.discoveredDevices.some((d) => d.external_id.endsWith(other)));
});

test('a gateway without its uuid: nothing published as a device, status says so', async () => {
  const t = await setup();
  t.dev.paths['/gateway/uuid'].value = '';
  await t.connect();
  assert.equal(t.gladys.fake.discoveredDevices.length, 0);
  assert.match(statusText(t), /sans son identifiant/);
});

test('an answer that is no ciphertext (another device): a failure, never a refusal', async () => {
  const store = memoryStore();
  const t = await setup({ store });
  t.dev.route = () => ({ status: 200, body: '{"value":"x"}' });
  await t.connect();
  assert.equal(store.data.refused, false);
  assert.match(statusText(t), /Passerelle non lue \(badAnswer\)/);
});

test('a feature once seen is never lost when republished', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  delete t.dev.paths['/heatSources/systemPressure'];
  await t.wait(61 * SECOND);
  await t.app.scan();
  const device = t.gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
  assert.ok(device.features.some((f) => f.external_id === F('system-pressure')));
});

test('the options of a created mode select are kept when the gateway lists others', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  t.dev.paths['/dhwCircuits/dhw1/operationMode'].allowedValues = ['Off', 'high'];
  await t.wait(61 * SECOND);
  await t.app.scan();
  const device = t.gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
  const mode = device.features.find((f) => f.external_id === F('dhw1-mode'));
  assert.equal(mode.supported_options.length, 5);
});

test('secrets: never in /data, the logs, the statuses, the states', async () => {
  const store = memoryStore();
  const t = await setup({ store });
  await t.connect();
  await t.create();
  await t.command('dhw1-mode', 'Off');
  await t.during(t.gladys.fake.configUpdated({ ...CONFIG, password: 'other-secret' }));
  await t.wait(61 * SECOND);
  const key = deriveKey(TOKEN, PASSWORD);
  const everything = JSON.stringify([
    store.data,
    t.logger.lines,
    t.gladys.fake.connectionStatuses,
    t.gladys.fake.states,
    t.gladys.fake.discoveredDevices,
  ]);
  for (const secret of [
    PASSWORD,
    'other-secret',
    TOKEN,
    TOKEN.replace(/-/g, ''),
    UUID,
    key.toString('hex'),
    key.toString('base64'),
  ]) {
    assert.ok(!everything.includes(secret), `leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(store.data).sort(), [
    'fp',
    'lastReadAt',
    'pausedUntil',
    'refused',
    'salt',
    'stops',
  ]);
  assert.ok(!Object.keys(t.app.session.client).includes('key'), 'the key is not enumerable');
});

test('/data unreadable: never written over; said in the status', async () => {
  const store = memoryStore({ lastReadAt: 1 }, { unreadable: true });
  const t = await setup({ store });
  await t.connect();
  await t.wait(2 * MINUTE);
  assert.equal(store.saves, 0);
  assert.deepEqual(store.data, { lastReadAt: 1 });
  assert.match(statusText(t), /\/data illisible/);
  assert.equal(reads(t), 3, 'the reads go on');
});

test('/data stuck at the start: never waited on for more than 1.5 s, counted as unreadable', async () => {
  const store = memoryStore();
  store.frozen = true;
  const t = await setup({ store });
  await t.connect();
  assert.equal(reads(t), 1, 'read after 1.5 s');
  assert.match(statusText(t), /\/data illisible/);
  store.thaw();
});

test('the configuration: problems shown, never a read', async () => {
  for (const [config, text] of [
    [{}, /Saisissez l’adresse/],
    [{ ...CONFIG, address: 'https://192.168.1.50' }, /sans https/],
    [{ ...CONFIG, address: '192.168.1.255' }, /diffusion/],
    [{ ...CONFIG, address: '0.0.0.0' }, /diffusion/],
    [{ ...CONFIG, address: '192.168.1.50/km' }, /Adresse non valide/],
    [{ ...CONFIG, token: '' }, /un mot de passe seul est refusé/],
    [{ ...CONFIG, token: 'abc' }, /Code d’accès non valide/],
    [{ ...CONFIG, password: '' }, /Saisissez le mot de passe/],
    [{ ...CONFIG, password: 'a\r\nX-Evil: 1' }, /Mot de passe non valide/],
  ]) {
    const t = await setup({ config });
    await t.connect();
    assert.match(statusText(t), text, JSON.stringify(config));
    assert.equal(t.dev.requests.length, 0);
  }
});

test('configurations saved back to back apply one at a time, the last one wins', async () => {
  const t = await setup();
  await t.connect();
  const a = t.gladys.fake.configUpdated({ ...CONFIG, address: '192.168.1.60' });
  const b = t.gladys.fake.configUpdated({ ...CONFIG, address: '192.168.1.70' });
  await t.during(Promise.all([a, b]));
  assert.equal(t.app.config.host, '192.168.1.70');
  assert.equal(t.dev.peak, 1);
});

test('the button never reads sooner than the interval', async () => {
  const t = await setup();
  await t.connect();
  const answer = await t.during(t.app.testConnection());
  assert.match(answer.value, /prochain essai possible dans/);
  assert.equal(reads(t), 1);
});

test('values older than two intervals are never published as new', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  t.dev.route = (path) => (path === '/heatingCircuits' ? 'silent' : undefined);
  await t.wait(4 * MINUTE);
  assert.notEqual(last(t.gladys, 'status'), 'OK');
  assert.equal(t.app.freshData(), undefined);
});

test('the button during a pause reads nothing, even past the interval', async () => {
  const t = await setup();
  await t.connect();
  t.dev.route = () => ({ status: 429, body: '' });
  await t.wait(61 * SECOND);
  t.dev.route = undefined;
  const before = reads(t);
  await t.wait(61 * SECOND - 1);
  await t.during(t.app.testConnection());
  assert.ok(reads(t) <= before + 1);
  assert.ok(t.app.pauseLeft() >= 0);
});

test('a refusal kept without a readable print is never lifted by a restart', async () => {
  const store = memoryStore({ refused: true, fp: 'zz', salt: '0'.repeat(32) });
  const t = await setup({ store });
  await t.connect();
  assert.equal(reads(t), 0);
  assert.equal(store.data?.refused ?? true, true);
});

test('with our key, an answer cut short or with a byte that is no UTF-8: never a refusal, the reads go on', async () => {
  const store = memoryStore();
  const t = await setup({ store });
  await t.connect();
  await t.create();
  const OUTDOOR = '/system/sensors/temperatures/outdoor_t1';
  // The value cut after 48 bytes (a close-delimited answer cut on a block).
  t.dev.route = (path, method) =>
    method === 'GET' && path === OUTDOOR
      ? { status: 200, body: t.dev.sealed(200, t.dev.paths[OUTDOOR]).body.slice(0, 64) }
      : undefined;
  await t.wait(61 * SECOND);
  assert.equal(store.data.refused, false);
  assert.equal(t.app.session.online, true, 'a value left out');
  // The uuid itself cut short: a failed read, never a refusal.
  t.dev.route = (path, method) =>
    method === 'GET' && path === '/gateway/uuid'
      ? { status: 200, body: t.dev.sealed(200, t.dev.paths['/gateway/uuid']).body.slice(0, 24) }
      : undefined;
  await t.wait(61 * SECOND);
  assert.equal(store.data.refused, false);
  assert.match(statusText(t), /Passerelle non lue \(badAnswer\)/);
  t.dev.route = undefined;
  const before = reads(t);
  await t.wait(2 * MINUTE);
  assert.ok(reads(t) > before, 'the reads go on');
});

test('another gateway at the address: the status of the integration says it too', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  t.dev.paths['/gateway/uuid'].value = OTHER_UUID;
  await t.wait(61 * SECOND);
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(statusText(t), /Une autre passerelle KM répond à cette adresse/);
});

test('the button never reads sooner than the interval (60 s), even 20 s after a read', async () => {
  const t = await setup();
  await t.connect();
  await t.wait(20 * SECOND);
  const answer = await t.during(t.app.testConnection());
  assert.match(answer.value, /prochain essai possible dans 40 s/);
  assert.equal(reads(t), 1);
});
