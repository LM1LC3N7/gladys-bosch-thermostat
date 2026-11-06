// -----------------------------------------------------------------------------
// The encryption of the KM gateway protocol, ported from
// bosch-thermostat-client 0.28.3 (Apache-2.0, encryption/base.py and
// const/ivt.py): AES-256 in ECB mode, the key being
//   md5(access token + MAGIC) || md5(MAGIC + password)
// (32 bytes), the plaintext padded with zero bytes to a multiple of 16, the
// ciphertext in base64. MAGIC is a constant of the local protocol (the same
// for every KM gateway, used by every client of it), not an identifier of
// an application.
//
// The derived key is kept by the client only (never logged, never stored).
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const MAGIC = Buffer.from(
  '867845e97c4e29dce522b9a7d3a3e07b152bffadddbed7f5ffd842e9895ad1e4',
  'hex',
);
const BLOCK = 16;

/** The AES key of a gateway: from its access token (dashes ignored) and the app password. */
export function deriveKey(token, password) {
  const t = Buffer.from(String(token).replace(/-/g, ''), 'utf8');
  const p = Buffer.from(String(password), 'utf8');
  return Buffer.concat([
    createHash('md5')
      .update(Buffer.concat([t, MAGIC]))
      .digest(),
    createHash('md5')
      .update(Buffer.concat([MAGIC, p]))
      .digest(),
  ]);
}

/** A JSON value -> the base64 body of a write. */
export function encrypt(key, value) {
  const plain = Buffer.from(JSON.stringify(value), 'utf8');
  const padded = Buffer.alloc(Math.ceil(plain.length / BLOCK) * BLOCK || BLOCK);
  plain.copy(padded);
  const cipher = createCipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The base64 body of an answer -> { json } when it decrypts into JSON,
 * { garbled: true } when its FIRST block does not open into the start of a
 * JSON object (the key of the gateway is not ours: wrong token or password;
 * with another key, 16 printable bytes starting with "{" come about once in
 * 10^9), or { malformed: true } when it is no ciphertext at all (another
 * device) or when the first block opens but the rest does not (an answer cut
 * short, a byte that is no UTF-8: ECB opens each block alone, so our key
 * reads the start of a broken answer; never a refusal).
 */
export function decrypt(key, body) {
  const text = typeof body === 'string' ? body.replace(/\s+/g, '') : '';
  if (text.length === 0 || !BASE64.test(text)) {
    return { malformed: true };
  }
  const data = Buffer.from(text, 'base64');
  if (data.length === 0 || data.length % BLOCK !== 0) {
    return { malformed: true };
  }
  const decipher = createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  if (!opensAsJson(plain.subarray(0, BLOCK))) {
    return { garbled: true };
  }
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) {
    end -= 1;
  }
  try {
    return { json: JSON.parse(utf8.decode(plain.subarray(0, end))) };
  } catch {
    return { malformed: true };
  }
}

/**
 * The first block of a KM answer: "{" then printable ASCII (or the zero
 * padding of a short answer), as every answer of the gateway starts
 * ({"id":"/...).
 */
function opensAsJson(block) {
  if (block[0] !== 0x7b) {
    return false;
  }
  let padding = false;
  for (const byte of block) {
    if (byte === 0) {
      padding = true;
    } else if (padding || byte < 0x20 || byte > 0x7e) {
      return false;
    }
  }
  return true;
}
