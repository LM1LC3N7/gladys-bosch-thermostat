// -----------------------------------------------------------------------------
// Modes and setpoints: behind the option, decided on a fresh read, bounded
// (hot water 65 °C at most, room 5-30 °C), success only on a read showing
// the value.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/store.js';
import { CONFIG, OTHER_UUID } from './fixtures/km.js';
import { DEVICE, F, SECOND, last, setup } from './helpers/app.js';

const ALLOW = { ...CONFIG, allow_commands: true };
const HIGH = '/dhwCircuits/dhw1/temperatureLevels/high';
const TEMPORARY = '/heatingCircuits/hc1/temporaryRoomSetpoint';
const HC_MODE = '/heatingCircuits/hc1/operationMode';
const puts = (t) => t.dev.puts();

test('the option is off by default: modes and setpoints refused, nothing sent nor read', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  const before = t.dev.requests.length;
  for (const [role, value] of [
    ['hc1-mode', 'manual'],
    ['dhw1-mode', 'low'],
    ['dhw1-setpoint', 50],
    ['hc1-setpoint', 20],
  ]) {
    const ack = await t.command(role, value);
    assert.equal(ack.success, false);
    assert.match(ack.error, /Les commandes sont désactivées/, role);
  }
  assert.equal(t.dev.requests.length, before, 'not even a read');
});

test('read-only features and unknown modes refuse any command', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  for (const role of [
    'outdoor-temperature',
    'hc1-temperature',
    'dhw1-temperature',
    'status',
    'system-pressure',
  ]) {
    const ack = await t.command(role, 1);
    assert.match(ack.error, /lecture seule/, role);
  }
  for (const value of ['toggle', 'OFF', 42, 'Always_Off']) {
    const ack = await t.command('dhw1-mode', value);
    assert.match(ack.error, /n’est pas un de ceux que liste ce circuit/, String(value));
  }
  assert.equal(puts(t).length, 0);
});

test('a mode with the option: a fresh read, the mode written, success once read back', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  const before = t.dev.requests.length;
  const ack = await t.command('hc1-mode', 'manual');
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(
    t.dev.requests.slice(before).map((r) => `${r.method} ${r.path}`),
    ['GET /gateway/uuid', `GET ${HC_MODE}`, `PUT ${HC_MODE}`, `GET ${HC_MODE}`],
  );
  assert.equal(puts(t)[0].value, 'manual');
  assert.equal(puts(t)[0].headers, undefined, 'headers are set by the transport only');
  await t.wait(6 * SECOND);
  assert.equal(last(t.gladys, 'hc1-mode'), 'manual');
});

test('the mode already set and no stop of ours: nothing sent', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  assert.deepEqual(await t.command('hc1-mode', 'auto'), { success: true });
  assert.equal(puts(t).length, 0);
});

test('room setpoint: written where the mode writes it (auto: temporary), half degrees, 5-30 °C', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  assert.deepEqual(await t.command('hc1-setpoint', 21.5), { success: true });
  assert.deepEqual(
    puts(t).map((r) => [r.path, r.value]),
    [[TEMPORARY, 21.5]],
  );
  assert.match((await t.command('hc1-setpoint', 21.3)).error, /Demi-degrés seulement/);
  assert.match((await t.command('hc1-setpoint', 31)).error, /de 5 à 30 °C/);
  assert.match((await t.command('hc1-setpoint', 4.5)).error, /de 5 à 30 °C/);
  assert.match((await t.command('hc1-setpoint', '')).error, /Ce n’est pas un nombre/);
  assert.match((await t.command('hc1-setpoint', null)).error, /Ce n’est pas un nombre/);
  // Manual mode: the manual setpoint.
  t.dev.paths[HC_MODE].value = 'manual';
  assert.deepEqual(await t.command('hc1-setpoint', 19), { success: true });
  assert.equal(puts(t).at(-1).path, '/heatingCircuits/hc1/manualRoomSetpoint');
  await t.wait(6 * SECOND);
  assert.equal(last(t.gladys, 'hc1-setpoint'), 19);
});

test('room setpoint within the bounds the gateway gives (10-25 here), high bound rounded down', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  Object.assign(t.dev.paths[TEMPORARY], { minValue: 10.2, maxValue: 25.4 });
  assert.match((await t.command('hc1-setpoint', 26)).error, /de 10\.5 à 25 °C/);
  assert.match((await t.command('hc1-setpoint', 25.5)).error, /de 10\.5 à 25 °C/);
  assert.match((await t.command('hc1-setpoint', 10)).error, /de 10\.5 à 25 °C/);
  assert.deepEqual(await t.command('hc1-setpoint', 25), { success: true });
});

test('hot water: 65 °C at most whatever the gateway allows (80 here), whole degrees', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  assert.match((await t.command('dhw1-setpoint', 66)).error, /de 20 à 65 °C/);
  assert.match((await t.command('dhw1-setpoint', 70)).error, /de 20 à 65 °C/);
  assert.match((await t.command('dhw1-setpoint', 64.5)).error, /Degrés entiers seulement/);
  assert.deepEqual(await t.command('dhw1-setpoint', 65), { success: true });
  assert.deepEqual(
    puts(t).map((r) => [r.path, r.value]),
    [[HIGH, 65]],
  );
  await t.wait(6 * SECOND);
  assert.equal(last(t.gladys, 'dhw1-setpoint'), 65);
});

test('hot water: the configured ceiling and a lower maximum of the gateway win', async () => {
  const t = await setup({ config: { ...ALLOW, max_dhw: 55 } });
  await t.connect();
  assert.match((await t.command('dhw1-setpoint', 56)).error, /de 20 à 55 °C/);
  t.dev.paths[HIGH].maxValue = 50;
  assert.match((await t.command('dhw1-setpoint', 52)).error, /de 30 à 50 °C/);
  assert.deepEqual(await t.command('dhw1-setpoint', 50), { success: true });
  // A ceiling typed above 65 is 65.
  const u = await setup({ config: { ...ALLOW, max_dhw: 90 } });
  await u.connect();
  assert.match((await u.command('dhw1-setpoint', 70)).error, /de 20 à 65 °C/);
});

test('hot water in the "low" mode: its own level is written', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.paths['/dhwCircuits/dhw1/operationMode'].value = 'low';
  assert.deepEqual(await t.command('dhw1-setpoint', 50), { success: true });
  assert.equal(puts(t)[0].path, '/dhwCircuits/dhw1/temperatureLevels/low');
});

test('a mode without its own setpoint (a schedule, a mode not mapped): refused, nothing sent', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.paths['/dhwCircuits/dhw1/operationMode'].value = 'ownprogram';
  assert.match(
    (await t.command('dhw1-setpoint', 50)).error,
    /n’a pas de consigne à changer : rien envoyé/,
  );
  t.dev.paths['/dhwCircuits/dhw1/operationMode'].value = 'eco';
  // eco maps to temperatureLevels/eco, absent on this gateway (404).
  assert.match((await t.command('dhw1-setpoint', 50)).error, /n’a pas de consigne|ne donne pas/);
  assert.equal(puts(t).length, 0);
});

test('a setpoint without bounds, or read only: refused, nothing sent', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  delete t.dev.paths[HIGH].maxValue;
  assert.match((await t.command('dhw1-setpoint', 50)).error, /ne donne pas cette valeur/);
  t.dev.paths[HIGH].maxValue = 80;
  t.dev.paths[HIGH].writeable = 0;
  assert.match((await t.command('dhw1-setpoint', 50)).error, /en lecture seule : rien envoyé/);
  assert.equal(puts(t).length, 0);
});

test('the same value: nothing sent', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  assert.deepEqual(await t.command('dhw1-setpoint', 60), { success: true });
  assert.equal(puts(t).length, 0);
});

test('applied late: "not applied yet", then the follow-up reads publish it', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  t.dev.applyDelay = 3 * SECOND;
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /Envoyée et acceptée, pas encore appliquée/);
  await t.wait(6 * SECOND);
  assert.equal(last(t.gladys, 'dhw1-setpoint'), 50);
});

test('a write answered but never applied: "not applied yet", never success', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.ignoreWrites = true;
  assert.match((await t.command('hc1-mode', 'manual')).error, /pas encore appliquée/);
  assert.match((await t.command('dhw1-setpoint', 50)).error, /pas encore appliquée/);
});

test('the option turned off while the command waits: nothing sent', async () => {
  const t = await setup({ config: ALLOW, latency: 200 });
  await t.connect();
  const ack = t.command('dhw1-setpoint', 50);
  await t.wait(300);
  void t.gladys.fake.configUpdated({ ...CONFIG, allow_commands: false });
  assert.match((await ack).error, /désactivées/);
  assert.equal(puts(t).length, 0);
});

test('the option turned off while the write connects: checked right before it leaves', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.connectDelay = 300;
  t.dev.onConnect = (path, method) => {
    if (method === 'PUT') {
      void t.gladys.fake.configUpdated({ ...CONFIG, allow_commands: false });
    }
  };
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /désactivées/);
  assert.equal(puts(t).length, 0);
});

test('the ceiling lowered while the write connects: checked right before it leaves', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.connectDelay = 300;
  t.dev.onConnect = (path, method) => {
    if (method === 'PUT') {
      void t.gladys.fake.configUpdated({ ...ALLOW, max_dhw: 45 });
    }
  };
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /de 30 à 45 °C/);
  assert.equal(puts(t).length, 0);
});

test('a scene: both modes and both setpoints at once (150 ms per request), all set', async () => {
  const t = await setup({ config: ALLOW, latency: 150 });
  await t.connect();
  const device = { external_id: DEVICE };
  const send = (role, value) => t.gladys.fake.setValue(device, { external_id: F(role) }, value);
  const all = Promise.all([
    send('hc1-mode', 'manual'),
    send('hc1-setpoint', 20),
    send('dhw1-mode', 'low'),
    send('dhw1-setpoint', 50),
  ]);
  const outcome = await t.during(all, 6 * SECOND, 10);
  assert.deepEqual(outcome.value, [
    { success: true },
    { success: true },
    { success: true },
    { success: true },
  ]);
  assert.equal(t.dev.peak, 1);
});

test('a scene too slow for its budget (900 ms per request): late ones refused unsent, said so', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  t.dev.latency = 900;
  const device = { external_id: DEVICE };
  const send = (role, value) => t.gladys.fake.setValue(device, { external_id: F(role) }, value);
  const at = t.clock.monotonic();
  const outcome = await t.during(
    Promise.all([send('hc1-setpoint', 20), send('dhw1-setpoint', 50)]),
    6 * SECOND,
    10,
  );
  assert.ok(t.clock.monotonic() - at < 4_400, 'acked within 4.3 s');
  for (const ack of outcome.value) {
    assert.equal(ack.success, false);
    assert.match(ack.error, /rien envoyé|sans confirmation|pas encore appliquée/);
  }
  assert.equal(t.dev.peak, 1);
});

test('a setpoint alone on a gateway answering in 700 ms: set and confirmed', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.latency = 700;
  assert.deepEqual(await t.command('dhw1-setpoint', 50), { success: true });
});

test('a 5xx on a write: sent, without confirmation; the pause holds the next ones', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.route = (path, method) => (method === 'PUT' ? { status: 500, body: '' } : undefined);
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /Envoyée, sans confirmation \(HTTP 500\)/);
  t.dev.route = undefined;
  assert.match((await t.command('dhw1-setpoint', 51)).error, /rien envoyé pendant la pause/);
});

test('a write the gateway refuses (4xx): said, the reads go on, no refusal', async () => {
  const store = memoryStore();
  const t = await setup({ config: ALLOW, store });
  await t.connect();
  t.dev.route = (path, method) => (method === 'PUT' ? { status: 403, body: '' } : undefined);
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /La passerelle a refusé la commande \(HTTP 403\)/);
  assert.equal(store.data.refused, false);
  t.dev.route = undefined;
  await t.wait(61 * SECOND);
  assert.equal(t.app.session.online, true);
});

test('a silent gateway: "nothing sent" when the fresh read does not answer, ack within 5 s', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  t.dev.route = () => 'silent';
  const at = t.clock.monotonic();
  const ack = await t.command('dhw1-setpoint', 50);
  assert.ok(t.clock.monotonic() - at < 4_500);
  assert.match(ack.error, /n’a pas répondu à temps : rien envoyé/);
  assert.equal(puts(t).length, 0);
});

test('another gateway answers at the address: refused, nothing written', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  await t.create();
  t.dev.paths['/gateway/uuid'].value = OTHER_UUID;
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /Une autre passerelle KM répond à cette adresse/);
  t.dev.paths['/gateway/uuid'].value = '';
  assert.match(
    (await t.command('dhw1-setpoint', 50)).error,
    /identité de la passerelle n’a pas pu être lue/,
  );
  assert.equal(puts(t).length, 0);
});

test('refused credentials: commands refused at once, nothing read', async () => {
  const t = await setup({ config: { ...ALLOW, password: 'bad' } });
  await t.connect();
  const before = t.dev.requests.length;
  const ack = await t.command('dhw1-setpoint', 50);
  assert.match(ack.error, /n’ouvre pas les réponses de la passerelle/);
  assert.equal(t.dev.requests.length, before);
});

test('/data unreadable: modes and setpoints refused, nothing written', async () => {
  const t = await setup({ config: ALLOW, store: memoryStore(null, { unreadable: true }) });
  await t.connect();
  for (const [role, value] of [
    ['dhw1-setpoint', 50],
    ['hc1-mode', 'manual'],
  ]) {
    const ack = await t.command(role, value);
    assert.match(ack.error, /\/data ne peut être lu ou écrit/, role);
  }
  assert.equal(puts(t).length, 0);
});

test('more than 4 commands waiting: refused at once', async () => {
  const t = await setup({ config: ALLOW, latency: 400 });
  await t.connect();
  const device = { external_id: DEVICE };
  const send = (v) => t.gladys.fake.setValue(device, { external_id: F('dhw1-setpoint') }, v);
  const waiting = [send(50), send(51), send(52), send(53)];
  const full = await t.during(send(54), 100);
  assert.match(full.value.error, /Trop de commandes en attente/);
  await t.during(Promise.all(waiting), 10 * SECOND);
});

test('a read begun before a write is never applied after it', async () => {
  const t = await setup({ config: ALLOW });
  t.dev.paths[HC_MODE].value = 'manual';
  await t.connect();
  await t.create();
  assert.equal(last(t.gladys, 'hc1-mode'), 'manual');
  // Changed on the controller: the next periodic read sees "auto".
  t.dev.paths[HC_MODE].value = 'auto';
  t.dev.latency = 100;
  const device = { external_id: DEVICE };
  let ack;
  let mark;
  // The periodic read gets the mode of hc1 ("auto"), then the command
  // writes "manual" before that read ends.
  t.dev.onConnect = (path, method) => {
    if (!ack && path === HC_MODE && method === 'GET' && t.app.session.running) {
      mark = t.gladys.fake.states.length;
      ack = t.gladys.fake.setValue(device, { external_id: F('hc1-mode') }, 'manual');
    }
  };
  await t.wait(61 * SECOND);
  assert.ok(ack, 'the command came during the read');
  assert.deepEqual((await t.during(ack, 6 * SECOND)).value, { success: true });
  await t.wait(2 * SECOND);
  assert.equal(t.app.session.running, undefined, 'the read has ended');
  // Its values (hc1 "auto", read before the write) were dropped, never published.
  const stale = t.gladys.fake.states
    .slice(mark)
    .filter((s) => s.device_feature_external_id === F('hc1-mode'));
  assert.deepEqual(stale, []);
  // The follow-up read, begun after the write, shows it.
  await t.wait(5 * SECOND);
  assert.equal(last(t.gladys, 'hc1-mode'), 'manual');
});

test('the option off: every command of a burst refused as such, none queued', async () => {
  const t = await setup();
  await t.connect();
  await t.create();
  const device = { external_id: DEVICE };
  const send = (v) => t.gladys.fake.setValue(device, { external_id: F('dhw1-setpoint') }, v);
  const acks = await t.during(Promise.all([50, 51, 52, 53, 54, 55].map(send)), 6 * SECOND);
  for (const ack of acks.value) {
    assert.match(ack.error, /Les commandes sont désactivées/);
  }
});

test('hot water: a ceiling above 65 in memory still gives 65 at most (both guards)', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  // A normalization gone wrong: the hard bounds still stop at 65 °C.
  t.app.config.dhwCeiling = 70;
  assert.match((await t.command('dhw1-setpoint', 66)).error, /de 20 à 65 °C/);
  // Hard bounds gone wrong too: the final guard right before sending.
  t.app.hardBounds = () => ({ low: 20, high: 90 });
  assert.match((await t.command('dhw1-setpoint', 70)).error, /de 30 à 65 °C/);
  assert.equal(puts(t).length, 0);
});

test('a value out of the bounds is refused even when the gateway already shows it', async () => {
  const t = await setup({ config: ALLOW });
  await t.connect();
  // The level is at 60 (set elsewhere), above the maximum the gateway gives now.
  t.dev.paths[HIGH].maxValue = 50;
  const ack = await t.command('dhw1-setpoint', 60);
  assert.match(ack.error, /de 30 à 50 °C/);
});
