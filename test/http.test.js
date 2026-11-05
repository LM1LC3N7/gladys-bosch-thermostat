// -----------------------------------------------------------------------------
// The real transport (node:http) and the client against local servers: the
// TeleHeater header, an encrypted PUT, nothing written when beforeSend
// refuses, size cap before the end, deadlines, one connection at a time, a
// stop that cuts a stuck read, the answers our key does not open.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { httpRequest } from '../src/km/http.js';
import { KmClient } from '../src/km/client.js';
import { decrypt, deriveKey, encrypt } from '../src/km/crypto.js';
import { CODES } from '../src/km/errors.js';
import { PASSWORD, TOKEN } from './fixtures/km.js';
import { blackhole, httpServer, refusePort, reply } from './kit/index.mjs';

const KEY = deriveKey(TOKEN, PASSWORD);
const sealed = (value) => reply(200, encrypt(KEY, value), { 'content-type': 'application/json' });

const base = (port, extra = {}) => ({
  host: '127.0.0.1',
  port,
  path: '/gateway/uuid',
  timeout: 2000,
  maxBytes: 64 * 1024,
  ...extra,
});

const failure = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('resolved');
};

test('a GET with the TeleHeater header, no keep-alive', async (t) => {
  const srv = await httpServer({ routes: { '/gateway/uuid': sealed({ value: '1' }) } });
  t.after(() => srv.close());
  const answer = await httpRequest(base(srv.port));
  assert.equal(answer.status, 200);
  assert.deepEqual(decrypt(KEY, answer.body).json, { value: '1' });
  const [request] = srv.requests;
  assert.equal(request.headers['user-agent'], 'TeleHeater');
  assert.equal(request.headers.connection, 'close');
  assert.equal(request.headers.authorization, undefined);
});

test('a PUT sends the encrypted { value } and nothing else', async (t) => {
  const srv = await httpServer({
    routes: { 'PUT /dhwCircuits/dhw1/operationMode': reply(204, '') },
  });
  t.after(() => srv.close());
  const client = new KmClient({
    host: '127.0.0.1',
    port: srv.port,
    token: TOKEN,
    password: PASSWORD,
  });
  await client.put('/dhwCircuits/dhw1/operationMode', 'Off');
  const [request] = srv.requests;
  assert.equal(request.method, 'PUT');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['user-agent'], 'TeleHeater');
  assert.deepEqual(decrypt(KEY, request.body).json, { value: 'Off' });
  assert.ok(!request.body.includes('Off'), 'never in clear');
  client.close();
});

test('beforeSend refusing: not one byte written', async (t) => {
  const hole = await blackhole();
  t.after(() => hole.close());
  const err = await failure(
    httpRequest(
      base(hole.port, {
        method: 'PUT',
        body: 'abc',
        beforeSend: () => {
          throw new Error('option off');
        },
      }),
    ),
  );
  assert.equal(err.message, 'option off');
  assert.equal(err.beforeSend, true);
  assert.equal(err.sent, false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(hole.received, 0);
  assert.equal(hole.open, 0, 'the socket closed');
});

test('an answer larger than allowed is cut before its end', async (t) => {
  const srv = await httpServer({ routes: { '/gateway/uuid': { value: 1 } }, bigBody: 200_000 });
  t.after(() => srv.close());
  const err = await failure(httpRequest(base(srv.port)));
  assert.equal(err.code, CODES.TOO_LARGE);
  assert.equal(err.sent, true);
  const declared = await httpServer({
    routes: { '/gateway/uuid': reply(200, 'x', { 'content-length': '999999' }) },
  });
  t.after(() => declared.close());
  assert.equal((await failure(httpRequest(base(declared.port)))).code, CODES.TOO_LARGE);
});

test('a silent gateway: timeout, sent; a refused port: unreachable, not sent', async (t) => {
  const hole = await blackhole();
  t.after(() => hole.close());
  const err = await failure(httpRequest(base(hole.port, { timeout: 200 })));
  assert.equal(err.code, CODES.TIMEOUT);
  assert.equal(err.sent, true);
  assert.equal(hole.open, 0, 'closed before settling');
  const port = await refusePort();
  const refused = await failure(httpRequest(base(port)));
  assert.equal(refused.code, CODES.UNREACHABLE);
  assert.equal(refused.sent, false);
});

test('an abort settles once the socket is closed', async (t) => {
  const hole = await blackhole();
  t.after(() => hole.close());
  const controller = new AbortController();
  const pending = failure(httpRequest(base(hole.port, { signal: controller.signal })));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(hole.open, 1);
  controller.abort();
  const err = await pending;
  assert.equal(err.code, CODES.ABORTED);
  assert.equal(err.sent, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hole.open, 0);
});

test('the client: one connection at a time, the stop first, a stuck read cut', async (t) => {
  let open = 0;
  let peak = 0;
  const seen = [];
  const server = createServer((req, res) => {
    open += 1;
    peak = Math.max(peak, open);
    res.on('close', () => {
      open -= 1;
    });
    seen.push(`${req.method} ${req.url}`);
    req.resume();
    if (req.url === '/heatingCircuits') {
      return; // stuck: never answers
    }
    setTimeout(() => {
      if (req.method === 'PUT') {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(encrypt(KEY, { value: '1' }));
    }, 20);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.on('connection', (socket) => t.after(() => socket.destroy()));
  const client = new KmClient({
    host: '127.0.0.1',
    port: server.address().port,
    token: TOKEN,
    password: PASSWORD,
  });
  const a = client.get('/gateway/uuid');
  const b = failure(client.get('/heatingCircuits'));
  const c = client.get('/gateway/uuid');
  await a;
  await new Promise((resolve) => setTimeout(resolve, 50));
  // The read is stuck; c waits behind it; the stop cuts it and leaves first.
  await client.stop('/dhwCircuits/dhw1/operationMode', 'Off');
  assert.equal((await b).code, CODES.ABORTED);
  await c;
  assert.deepEqual(seen, [
    'GET /gateway/uuid',
    'GET /heatingCircuits',
    'PUT /dhwCircuits/dhw1/operationMode',
    'GET /gateway/uuid',
  ]);
  assert.equal(peak, 1, 'never two connections');
  client.close();
});

test('the client: another key (garbled), no ciphertext, an HTTP 404, a bad path', async (t) => {
  const other = deriveKey(TOKEN, 'other password');
  const srv = await httpServer({
    routes: {
      '/gateway/uuid': reply(200, encrypt(other, { value: '1' })),
      '/gateway/versionFirmware': reply(200, '<html>'),
      '/system/sensors/temperatures/outdoor_t1': reply(200, encrypt(KEY, [1, 2])),
    },
  });
  t.after(() => srv.close());
  const client = new KmClient({
    host: '127.0.0.1',
    port: srv.port,
    token: TOKEN,
    password: PASSWORD,
  });
  assert.equal((await failure(client.get('/gateway/uuid'))).code, CODES.KEY);
  assert.equal((await failure(client.get('/gateway/versionFirmware'))).code, CODES.BAD_ANSWER);
  assert.equal(
    (await failure(client.get('/system/sensors/temperatures/outdoor_t1'))).code,
    CODES.BAD_ANSWER,
  );
  const missing = await failure(client.get('/heatSources/systemPressure'));
  assert.equal(missing.code, CODES.HTTP);
  assert.equal(missing.status, 404);
  assert.equal((await failure(client.get('/a/../b'))).code, CODES.BAD_ANSWER);
  assert.equal((await failure(client.get('/a?x=1'))).code, CODES.BAD_ANSWER);
  assert.equal(srv.requests.length, 4, 'a bad path never leaves');
  assert.ok(!Object.keys(client).includes('key'), 'the key is not enumerable');
  client.close();
});
