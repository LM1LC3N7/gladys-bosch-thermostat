// -----------------------------------------------------------------------------
// The app on the REAL clock (sped up 20 times: performance.now, Date.now and
// the timers move by themselves) and a real local HTTP server playing the
// KM gateway (answers sealed with its key): the reads come at the measured
// interval, never sooner; a stop cuts a stuck read and leaves at once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { KmApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { identityKey } from '../src/model.js';
import { decrypt, deriveKey, encrypt } from '../src/km/crypto.js';
import { PASSWORD, TOKEN, UUID, initialPaths } from './fixtures/km.js';
import { httpServer, measurePeriod, realClock, reply, spyOn } from './kit/index.mjs';

const SPEED = 20;
const INTERVAL = 30_000;
const KEY = deriveKey(TOKEN, PASSWORD);
const DHW_MODE = '/dhwCircuits/dhw1/operationMode';
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

async function boot(t, { stuck } = {}) {
  const paths = initialPaths();
  const routes = {};
  for (const path of Object.keys(paths)) {
    routes[`GET ${path}`] = () =>
      stuck?.(path) ? 'silent' : reply(200, encrypt(KEY, paths[path]));
  }
  routes[`PUT ${DHW_MODE}`] = (request) => {
    const value = decrypt(KEY, request.body).json?.value;
    if (paths[DHW_MODE].allowedValues.includes(value)) {
      paths[DHW_MODE].value = value;
      return reply(204, '');
    }
    return reply(400, '');
  };
  const srv = await httpServer({ latencyMs: 5, routes });
  const clock = realClock({ speed: SPEED });
  const gladys = createFakeGladys({ selector: 'bosch-km-test', config: {} });
  await gladys.connect();
  const app = new KmApp({
    gladys,
    logger: quiet,
    store: memoryStore(),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
  });
  // After connect(): the commands reach the app, the start is the test's.
  registerHandlers(gladys, app, quiet);
  t.after(async () => {
    await app.stop();
    clock.close();
    await srv.close();
  });
  const config = {
    address: `127.0.0.1:${srv.port}`,
    token: TOKEN,
    password: PASSWORD,
    poll_interval: INTERVAL / 1000,
  };
  return { srv, clock, gladys, app, config, paths };
}

test('real clock x20: a read at once, then every interval (measured), timers bounded', async (t) => {
  const { clock, app, config, gladys } = await boot(t);
  const spy = spyOn(app, 'read', clock);
  await app.connected(async () => config);
  const gaps = await measurePeriod(spy, { count: 4, period: INTERVAL });
  assert.equal(gaps.length, 3);
  assert.ok(clock.timersSet < 60, `${clock.timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('real clock x20: "Off" cuts a stuck read and is sent at once', async (t) => {
  let stuck = false;
  const { srv, clock, app, config, gladys, paths } = await boot(t, {
    stuck: (path) => stuck && path === '/heatingCircuits',
  });
  await app.connected(async () => config);
  stuck = true;
  // The next read gets stuck on the list of the heating circuits.
  await clock.sleep(INTERVAL + 1000);
  assert.equal(app.session.client.busy, true);
  stuck = false;
  const key = identityKey(UUID);
  const started = performance.now();
  const ack = await gladys.fake.setValue(
    { external_id: `ext:bosch-km-test:bosch-km:${key}` },
    { external_id: `ext:bosch-km-test:bosch-km:${key}:dhw1-mode` },
    'Off',
  );
  const elapsed = (performance.now() - started) * SPEED;
  assert.equal(srv.count(`PUT ${DHW_MODE}`), 1, JSON.stringify(ack));
  assert.ok(elapsed < 4500, `acked after ${Math.round(elapsed)} ms (simulated)`);
  assert.deepEqual(ack, { success: true });
  assert.equal(paths[DHW_MODE].value, 'Off');
  assert.equal(app.session.failures, 0, 'the cut read is no failure');
});
