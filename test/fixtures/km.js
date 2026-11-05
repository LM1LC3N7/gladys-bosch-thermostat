// -----------------------------------------------------------------------------
// A fake KM200 behind the transport of src/km/http.js: the paths and the
// shapes of the answers bosch-thermostat-client 0.28.3 reads (database
// rc300_rc200/040802.json: an RC300 with one heating circuit and one hot
// water circuit; hc2 listed but not fitted), every answer encrypted with the
// key of the gateway (its token and password), writes decrypted and applied
// within the bounds and modes it lists, every request recorded, one
// connection at a time counted. Its delays run on the clock of the test
// (`timers`), the connection itself is immediate.
// -----------------------------------------------------------------------------

import { decrypt, deriveKey, encrypt } from '../../src/km/crypto.js';
import { CODES, KmError } from '../../src/km/errors.js';

export const TOKEN = 'Ab12-Cd34-Ef56-Gh78';
export const PASSWORD = 'pa55-W0rd-test';
export const UUID = '123456789';
export const OTHER_UUID = '987654321';
export const CONFIG = { address: '192.168.1.50', token: TOKEN, password: PASSWORD };

const float = (id, value, extra = {}) => ({
  id,
  type: 'floatValue',
  writeable: 0,
  recordable: 0,
  value,
  unitOfMeasure: 'C',
  ...extra,
});
const text = (id, value, extra = {}) => ({
  id,
  type: 'stringValue',
  writeable: 0,
  recordable: 0,
  value,
  ...extra,
});
const refs = (id, names) => ({
  id,
  type: 'refEnum',
  references: names.map((n) => ({ id: `${id}/${n}`, uri: `http://192.168.1.50${id}/${n}` })),
});

/** The values of the gateway, by path. */
export function initialPaths(uuid = UUID) {
  const p = {};
  const put = (value) => {
    p[value.id] = value;
  };
  put(text('/gateway/uuid', uuid));
  put(text('/gateway/versionFirmware', '04.08.02'));
  put(float('/system/sensors/temperatures/outdoor_t1', 4.5));
  put(float('/system/sensors/temperatures/supply_t1', 45.2));
  put(float('/heatSources/systemPressure', 1.6, { unitOfMeasure: 'bar' }));
  put(refs('/heatingCircuits', ['hc1', 'hc2']));
  put(float('/heatingCircuits/hc1/roomtemperature', 20.5));
  put(float('/heatingCircuits/hc1/currentRoomSetpoint', 21));
  put(
    text('/heatingCircuits/hc1/operationMode', 'auto', {
      writeable: 1,
      allowedValues: ['manual', 'auto'],
    }),
  );
  put(
    float('/heatingCircuits/hc1/manualRoomSetpoint', 21, {
      writeable: 1,
      minValue: 5,
      maxValue: 30,
    }),
  );
  put(
    float('/heatingCircuits/hc1/temporaryRoomSetpoint', 21, {
      writeable: 1,
      minValue: 5,
      maxValue: 30,
    }),
  );
  put(refs('/dhwCircuits', ['dhw1']));
  put(float('/dhwCircuits/dhw1/actualTemp', 52.3));
  put(float('/dhwCircuits/dhw1/currentSetpoint', 60));
  put(
    text('/dhwCircuits/dhw1/operationMode', 'high', {
      writeable: 1,
      allowedValues: ['Off', 'high', 'low', 'eco', 'ownprogram'],
    }),
  );
  put(
    float('/dhwCircuits/dhw1/temperatureLevels/high', 60, {
      writeable: 1,
      minValue: 30,
      maxValue: 80,
    }),
  );
  put(
    float('/dhwCircuits/dhw1/temperatureLevels/low', 45, {
      writeable: 1,
      minValue: 30,
      maxValue: 80,
    }),
  );
  return p;
}

/** The setpoint path each mode writes (as src/constants.js maps them). */
const MODE_SETPOINT = {
  '/heatingCircuits/hc1': {
    manual: 'manualRoomSetpoint',
    auto: 'temporaryRoomSetpoint',
    current: 'currentRoomSetpoint',
  },
  '/dhwCircuits/dhw1': {
    high: 'temperatureLevels/high',
    low: 'temperatureLevels/low',
    current: 'currentSetpoint',
  },
};

/**
 * The fake gateway. `timers`: the clock of the test. Options and state may
 * be changed at any time: `latency` (ms per answer), `route(path, method)`
 * to override an answer ('silent', 'refuse', 'drop', or { status, body }
 * sent as is), `ignoreWrites` (writes answered 204 but not applied),
 * `applyDelay` (ms before a write shows), `connectDelay` (ms before the
 * connection is up: beforeSend runs then), `onConnect(path, method)`.
 */
export function fakeKm({ timers, latency = 0, token = TOKEN, password = PASSWORD } = {}) {
  const dev = {
    paths: initialPaths(),
    key: deriveKey(token, password),
    latency,
    applyDelay: 0,
    connectDelay: 0,
    onConnect: undefined,
    ignoreWrites: false,
    route: undefined,
    /** { path, method, value, headers } of every request that reached the gateway. */
    requests: [],
    /** Requests refused unsent (beforeSend, late, refused port). */
    unsent: 0,
    open: 0,
    peak: 0,
    count: (path, method = 'GET') =>
      dev.requests.filter((r) => r.path === path && r.method === method).length,
    puts: () => dev.requests.filter((r) => r.method === 'PUT'),
    later(fn) {
      if (dev.applyDelay > 0) {
        timers.setTimeout(fn, dev.applyDelay);
      } else {
        fn();
      }
    },
    /** Sets the key of the gateway (the password changed in the app). */
    rekey(newToken, newPassword) {
      dev.key = deriveKey(newToken, newPassword);
    },
    sealed: (status, value) => ({ status, body: encrypt(dev.key, value) }),
    write(path, value) {
      const entry = dev.paths[path];
      if (!entry || entry.writeable !== 1) {
        return { status: 403, body: '' };
      }
      if (entry.type === 'stringValue') {
        if (!entry.allowedValues.includes(value)) {
          return { status: 400, body: '' };
        }
      } else if (typeof value !== 'number' || value < entry.minValue || value > entry.maxValue) {
        return { status: 400, body: '' };
      }
      if (!dev.ignoreWrites) {
        dev.later(() => {
          entry.value = value;
          dev.sync(path);
        });
      }
      return { status: 204, body: '' };
    },
    /** The current setpoint follows the level of the current mode. */
    sync(path) {
      for (const [folder, map] of Object.entries(MODE_SETPOINT)) {
        if (!path.startsWith(`${folder}/`)) {
          continue;
        }
        const mode = dev.paths[`${folder}/operationMode`].value;
        const own = map[mode];
        if (own) {
          dev.paths[`${folder}/${map.current}`].value = dev.paths[`${folder}/${own}`].value;
        }
      }
    },
    answer(path, method, body) {
      if (method === 'PUT') {
        const opened = decrypt(dev.key, body);
        if (!opened.json || !Object.hasOwn(opened.json, 'value')) {
          return { status: 400, body: '' };
        }
        return dev.write(path, opened.json.value);
      }
      const entry = dev.paths[path];
      if (!entry) {
        return { status: 404, body: '' };
      }
      return dev.sealed(200, entry);
    },
  };

  dev.transport = ({
    path,
    method = 'GET',
    body,
    timeout,
    sendWithin,
    beforeSend,
    signal,
    maxBytes,
    headers,
  }) =>
    new Promise((resolve, reject) => {
      const route = dev.route?.(path, method);
      let settled = false;
      let written = false;
      const handles = [];
      const finish = (err, value) => {
        if (settled) {
          return;
        }
        settled = true;
        for (const h of handles) {
          timers.clearTimeout(h);
        }
        signal?.removeEventListener('abort', onAbort);
        dev.open -= 1;
        if (err) {
          if (!written) {
            dev.unsent += 1;
          }
          reject(err);
        } else {
          resolve(value);
        }
      };
      const onAbort = () => finish(new KmError(CODES.ABORTED, { sent: written }));
      dev.open += 1;
      dev.peak = Math.max(dev.peak, dev.open);
      if (signal?.aborted) {
        finish(new KmError(CODES.ABORTED));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      if (route === 'refuse') {
        // ECONNREFUSED: nothing sent.
        queueMicrotask(() => finish(new KmError(CODES.UNREACHABLE)));
        return;
      }
      if (sendWithin !== undefined && sendWithin <= 0) {
        finish(new KmError(CODES.LATE));
        return;
      }
      handles.push(
        timers.setTimeout(
          () => finish(new KmError(CODES.TIMEOUT, { sent: written })),
          Math.max(1, timeout),
        ),
      );
      const reply = () => {
        if (settled || route === 'silent') {
          return;
        }
        if (route === 'drop') {
          finish(new KmError(CODES.UNREACHABLE, { sent: true }));
          return;
        }
        const answer = route && typeof route === 'object' ? route : dev.answer(path, method, body);
        if (Buffer.byteLength(answer.body) > maxBytes) {
          finish(new KmError(CODES.TOO_LARGE, { sent: true }));
          return;
        }
        finish(null, answer);
      };
      const connected = () => {
        if (settled) {
          return;
        }
        if (beforeSend) {
          try {
            beforeSend();
          } catch (err) {
            err.beforeSend = true;
            err.sent = false;
            finish(err);
            return;
          }
        }
        written = true;
        const opened = method === 'PUT' ? decrypt(dev.key, body) : {};
        dev.requests.push({ path, method, value: opened.json?.value, headers });
        if (dev.latency > 0) {
          handles.push(timers.setTimeout(reply, dev.latency));
        } else {
          queueMicrotask(reply);
        }
      };
      dev.onConnect?.(path, method);
      if (dev.connectDelay > 0) {
        handles.push(timers.setTimeout(connected, dev.connectDelay));
      } else {
        connected();
      }
    });
  return dev;
}
