/**
 * A small, strict CBOR decoder (RFC 8949) for the two objects Apple's App Attest hands the server:
 * the attestation object (`{ fmt, attStmt: { x5c, receipt }, authData }`) and the assertion
 * (`{ signature, authenticatorData }`). Written here rather than added as a dependency: what App
 * Attest sends is a few maps of byte strings, and the server must read it before it trusts anyone.
 *
 * What it takes: unsigned and negative integers (as numbers; as bigint past 2^53), byte strings (a
 * Buffer copy), UTF-8 text (invalid UTF-8 is refused), arrays, maps (text or integer keys, no
 * duplicates; returned as a Map), tags (`{ tag, value }`), false / true / null / undefined and
 * floats. What it refuses (CborError): indefinite lengths (App Attest never uses them), reserved
 * additional-info values, simple values it does not know, a length past the end of the input,
 * nesting deeper than `maxDepth`, more than `maxItems` items in all, and anything left over after
 * the one item (`decodeCbor`). It never reads past the buffer.
 */

export type CborValue = number | bigint | string | boolean | null | undefined | Buffer | CborValue[] | CborMap | CborTagged;
export type CborMap = Map<string | number | bigint, CborValue>;
export interface CborTagged {
  tag: number | bigint;
  value: CborValue;
}

export class CborError extends Error {
  constructor(message: string) {
    super(`cbor: ${message}`);
    this.name = "CborError";
  }
}

export interface CborLimits {
  /** arrays, maps and tags nested at most this deep (default 16) */
  maxDepth?: number;
  /** items in all (array elements, map keys and values) at most (default 10,000) */
  maxItems?: number;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

class Reader {
  private pos = 0;
  private items = 0;
  constructor(
    private readonly buf: Buffer,
    private readonly maxDepth: number,
    private readonly maxItems: number,
  ) {}

  get offset(): number {
    return this.pos;
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) throw new CborError(`needs ${n} more bytes at ${this.pos}, has ${this.buf.length - this.pos}`);
  }

  private byte(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  /** The argument of a head: the additional info itself, or the 1, 2, 4 or 8 bytes after it. */
  private argument(info: number): number | bigint {
    if (info < 24) return info;
    if (info === 24) return this.byte();
    if (info === 25) {
      this.need(2);
      const v = this.buf.readUInt16BE(this.pos);
      this.pos += 2;
      return v;
    }
    if (info === 26) {
      this.need(4);
      const v = this.buf.readUInt32BE(this.pos);
      this.pos += 4;
      return v;
    }
    if (info === 27) {
      this.need(8);
      const v = this.buf.readBigUInt64BE(this.pos);
      this.pos += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    if (info === 31) throw new CborError(`indefinite length at ${this.pos - 1} is not accepted`);
    throw new CborError(`reserved additional info ${info} at ${this.pos - 1}`);
  }

  /** A length or count: a whole number that fits the rest of the input. */
  private size(info: number): number {
    const n = this.argument(info);
    if (typeof n === "bigint" || n > this.buf.length) throw new CborError(`length ${n} at ${this.pos} is past the end of the input`);
    return n;
  }

  private count(n: number): void {
    this.items += n;
    if (this.items > this.maxItems) throw new CborError(`more than ${this.maxItems} items`);
  }

  item(depth: number): CborValue {
    if (depth > this.maxDepth) throw new CborError(`nested deeper than ${this.maxDepth}`);
    const head = this.byte();
    const major = head >> 5;
    const info = head & 0x1f;
    switch (major) {
      case 0:
        return this.argument(info);
      case 1: {
        const n = this.argument(info);
        return typeof n === "bigint" ? BigInt(-1) - n : n + 1 > Number.MAX_SAFE_INTEGER ? BigInt(-1) - BigInt(n) : -1 - n;
      }
      case 2: {
        const n = this.size(info);
        this.need(n);
        const out = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
        this.pos += n;
        return out;
      }
      case 3: {
        const n = this.size(info);
        this.need(n);
        let text: string;
        try {
          text = UTF8.decode(this.buf.subarray(this.pos, this.pos + n));
        } catch {
          throw new CborError(`invalid UTF-8 text at ${this.pos}`);
        }
        this.pos += n;
        return text;
      }
      case 4: {
        const n = this.size(info);
        this.count(n);
        const out: CborValue[] = [];
        for (let i = 0; i < n; i += 1) out.push(this.item(depth + 1));
        return out;
      }
      case 5: {
        const n = this.size(info);
        this.count(2 * n);
        const out: CborMap = new Map();
        for (let i = 0; i < n; i += 1) {
          const at = this.pos;
          const key = this.item(depth + 1);
          if (typeof key !== "string" && typeof key !== "number" && typeof key !== "bigint") throw new CborError(`map key at ${at} is not text or an integer`);
          if (out.has(key)) throw new CborError(`duplicate map key ${String(key)} at ${at}`);
          out.set(key, this.item(depth + 1));
        }
        return out;
      }
      case 6: {
        const tag = this.argument(info);
        return { tag, value: this.item(depth + 1) };
      }
      default: {
        // major 7: simple values and floats
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25) {
          this.need(2);
          const half = this.buf.readUInt16BE(this.pos);
          this.pos += 2;
          return halfToNumber(half);
        }
        if (info === 26) {
          this.need(4);
          const v = this.buf.readFloatBE(this.pos);
          this.pos += 4;
          return v;
        }
        if (info === 27) {
          this.need(8);
          const v = this.buf.readDoubleBE(this.pos);
          this.pos += 8;
          return v;
        }
        throw new CborError(`simple value ${info} at ${this.pos - 1} is not accepted`);
      }
    }
  }
}

function halfToNumber(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exp = (half >> 10) & 0x1f;
  const frac = half & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

/** Exactly one CBOR item filling `input`; anything after it is refused. Throws CborError. */
export function decodeCbor(input: Uint8Array, limits: CborLimits = {}): CborValue {
  const { value, end } = decodeCborPrefix(input, limits);
  if (end !== input.length) throw new CborError(`${input.length - end} bytes left after the item`);
  return value;
}

/** The first CBOR item of `input`, and where it ends (for a structure with bytes after it). Throws CborError. */
export function decodeCborPrefix(input: Uint8Array, limits: CborLimits = {}): { value: CborValue; end: number } {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const reader = new Reader(buf, limits.maxDepth ?? 16, limits.maxItems ?? 10_000);
  const value = reader.item(0);
  return { value, end: reader.offset };
}

/** True for a decoded map. */
export function isCborMap(value: CborValue): value is CborMap {
  return value instanceof Map;
}

/** The byte string under `key` in a decoded map, or null when the key is missing or is not bytes. */
export function cborBytes(map: CborMap, key: string): Buffer | null {
  const value = map.get(key);
  return Buffer.isBuffer(value) ? value : null;
}
