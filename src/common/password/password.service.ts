import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/** Cost parameters for the scrypt key-derivation function. */
interface ScryptParams {
  /** CPU/memory cost — must be a power of two. */
  N: number;
  /** Block size. */
  r: number;
  /** Parallelization factor. */
  p: number;
  /** Upper bound on the memory scrypt may use (128 * N * r bytes are needed). */
  maxmem: number;
}

const ALGORITHM = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const PARAMS: ScryptParams = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Password hashing built on Node's native `crypto.scrypt`.
 *
 * scrypt is an OWASP-recommended, memory-hard KDF and ships with Node, so no
 * extra (native) dependency is required. Each password gets a fresh 16-byte
 * random salt and the stored value records the parameters used, which keeps
 * hashes verifiable even if the defaults are hardened later:
 *
 *   scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>
 */
@Injectable()
export class PasswordService {
  /** Derives a hash string safe to persist on the user document. */
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = await this.derive(plain, salt, KEY_LENGTH, PARAMS);

    return [
      ALGORITHM,
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  /**
   * Constant-time verification of `plain` against a stored hash produced by
   * {@link hash}. Returns `false` (rather than throwing) for malformed hashes so
   * callers can treat every failure as a plain credential mismatch.
   */
  async verify(plain: string, stored: string): Promise<boolean> {
    const parsed = this.parse(stored);
    if (!parsed) return false;

    const derived = await this.derive(plain, parsed.salt, parsed.hash.length, parsed.params);
    // Both buffers share the same length here, so `timingSafeEqual` is safe.
    return timingSafeEqual(derived, parsed.hash);
  }

  private parse(stored: string): { salt: Buffer; hash: Buffer; params: ScryptParams } | null {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== ALGORITHM) return null;

    const N = Number.parseInt(parts[1], 10);
    const r = Number.parseInt(parts[2], 10);
    const p = Number.parseInt(parts[3], 10);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
    if (N <= 1 || r <= 0 || p <= 0) return null;

    const salt = Buffer.from(parts[4], 'base64');
    const hash = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || hash.length === 0) return null;

    return { salt, hash, params: { N, r, p, maxmem: PARAMS.maxmem } };
  }

  private derive(
    plain: string,
    salt: Buffer,
    keyLength: number,
    params: ScryptParams,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      scryptCallback(plain, salt, keyLength, params, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
  }
}
