// -----------------------------------------------------------------------------
// The errors of the transport and of the gateway, as codes. A message never
// carries an address, the access token, the password, the key or an answer
// of the gateway.
// -----------------------------------------------------------------------------

export const CODES = {
  /** No connection, or the connection dropped. */
  UNREACHABLE: 'unreachable',
  /** No complete answer in time. */
  TIMEOUT: 'timeout',
  /** The answer was larger than allowed: dropped before the end. */
  TOO_LARGE: 'tooLarge',
  /** Cut on purpose (a stop takes the connection). */
  ABORTED: 'aborted',
  /** A command could not leave in time: nothing written. */
  LATE: 'late',
  /** An HTTP status other than 200 (204 for a write). */
  HTTP: 'http',
  /** An answer that is no ciphertext of the gateway, or not the expected JSON. */
  BAD_ANSWER: 'badAnswer',
  /** A ciphertext our key does not open: wrong access token or password. */
  KEY: 'key',
};

export class KmError extends Error {
  /**
   * @param {string} code one of CODES
   * @param {{ sent?: boolean, status?: number }} [details]
   *   `sent`: the request was written (it may have reached the gateway)
   */
  constructor(code, { sent = false, status } = {}) {
    super(status === undefined ? code : `${code} ${status}`);
    this.name = 'KmError';
    this.code = code;
    this.sent = sent;
    this.status = status;
  }
}

/** Our key does not open the answers: the access token or the password is wrong. */
export const isKeyRefused = (err) => err?.code === CODES.KEY;

/** The gateway asks to slow down (429) or fails (5xx). */
export const isBusy = (err) =>
  err?.code === CODES.HTTP && (err.status === 429 || (err.status >= 500 && err.status <= 599));

/** A path this gateway does not have (or does not give): a value missing, never a failure. */
export const isMissing = (err) =>
  err?.code === CODES.HTTP && err.status >= 400 && err.status <= 499 && err.status !== 429;

/** A short reason for the logs and the texts (never a secret). */
export function reasonOf(err) {
  if (!(err instanceof KmError)) {
    return 'error';
  }
  if (err.code === CODES.HTTP) {
    return `HTTP ${err.status}`;
  }
  return err.code;
}
