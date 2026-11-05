// -----------------------------------------------------------------------------
// The local API of one KM gateway: a read (GET, one value per path) and a
// write (PUT of { value }), both encrypted, through the Gate (one request at
// a time, a stop first). The AES key (derived from the access token and the
// password) lives here only, not enumerable: never in a URL, a log, an
// error, /data.
//
// Deadlines are on the monotonic clock given (`sendBy`: the request must be
// written by then, else nothing leaves; `answerBy`: the answer by then).
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from '../constants.js';
import { decrypt, deriveKey, encrypt } from './crypto.js';
import { CODES, KmError } from './errors.js';
import { Gate, PRIORITY } from './gate.js';
import { httpRequest } from './http.js';

/** A path of the API: segments of letters, digits and _ only. */
const PATH = /^(\/[A-Za-z0-9_]{1,40}){1,5}$/;

export class KmClient {
  constructor({
    host,
    port,
    token,
    password,
    transport = httpRequest,
    monotonic = () => performance.now(),
    timers = globalThis,
  }) {
    this.host = host;
    this.port = port;
    this.transport = transport;
    this.monotonic = monotonic;
    this.timers = timers;
    this.gate = new Gate();
    Object.defineProperty(this, 'key', { value: deriveKey(token, password), enumerable: false });
  }

  /** One exchange in its turn: resolves { status, body } of the transport. */
  exchange(path, { method = 'GET', body, priority = PRIORITY.POLL, sendBy, answerBy, beforeSend }) {
    if (this.gate.closed) {
      return Promise.reject(new KmError(CODES.ABORTED));
    }
    if (!PATH.test(path)) {
      return Promise.reject(new KmError(CODES.BAD_ANSWER));
    }
    return this.gate.run(priority, async (signal) => {
      const now = this.monotonic();
      if (sendBy !== undefined && now >= sendBy) {
        throw new KmError(CODES.LATE);
      }
      const timeout = answerBy === undefined ? TIMINGS.requestTimeout : Math.max(1, answerBy - now);
      return this.transport({
        host: this.host,
        port: this.port,
        path,
        method,
        body,
        timeout,
        maxBytes: LIMITS.responseBytes,
        ...(sendBy === undefined ? {} : { sendWithin: Math.max(0, sendBy - now) }),
        beforeSend,
        signal,
        timers: this.timers,
      });
    });
  }

  /**
   * The value of one path: resolves the decrypted JSON object of a 200;
   * rejects HTTP (another status), KEY (our key does not open it),
   * BAD_ANSWER (no ciphertext, or no object).
   */
  async get(path, options = {}) {
    const { status, body } = await this.exchange(path, { ...options, method: 'GET' });
    if (status !== 200) {
      throw new KmError(CODES.HTTP, { sent: true, status });
    }
    const opened = decrypt(this.key, body);
    if (opened.garbled) {
      throw new KmError(CODES.KEY, { sent: true });
    }
    const json = opened.json;
    if (opened.malformed || json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new KmError(CODES.BAD_ANSWER, { sent: true });
    }
    return json;
  }

  /** A write: resolves on 200/204 (the gateway took the request); HTTP otherwise. */
  async put(path, value, options = {}) {
    const body = encrypt(this.key, { value });
    const { status } = await this.exchange(path, { ...options, method: 'PUT', body });
    if (status !== 200 && status !== 204) {
      throw new KmError(CODES.HTTP, { sent: true, status });
    }
  }

  /** A stop (an "off" mode): it takes the connection (see the Gate). */
  stop(path, value, options = {}) {
    this.gate.preempt();
    return this.put(path, value, { ...options, priority: PRIORITY.STOP });
  }

  /** Whether a request is in flight or waiting. */
  get busy() {
    return this.gate.busy;
  }

  close() {
    this.gate.close(new KmError(CODES.ABORTED));
  }
}
