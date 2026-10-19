/**
 * Just enough DER (X.690) to read one extension out of an X.509 certificate: App Attest's nonce,
 * which Apple puts in the credential certificate under OID 1.2.840.113635.100.8.2 as
 * `SEQUENCE { [1] EXPLICIT OCTET STRING (32 bytes) }`. node:crypto's X509Certificate checks the
 * signatures and the dates but does not hand out arbitrary extensions, so this walks the
 * certificate's own bytes:
 *
 *   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
 *   tbsCertificate ::= SEQUENCE { [0] version, serial, signature, issuer, validity, subject,
 *                                 subjectPublicKeyInfo, [1]?, [2]?, [3] EXPLICIT extensions }
 *   Extension ::= SEQUENCE { extnID OBJECT IDENTIFIER, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }
 *
 * Every read is bounds-checked (DerError); definite lengths only (DER has no other kind); tags in
 * the high-tag-number form are read (Apple's other extensions use them, though this never descends
 * into those).
 */

export class DerError extends Error {
  constructor(message: string) {
    super(`der: ${message}`);
    this.name = "DerError";
  }
}

export interface Tlv {
  /** 0 universal, 1 application, 2 context-specific, 3 private */
  tagClass: number;
  constructed: boolean;
  tagNumber: number;
  /** the contents */
  value: Buffer;
  /** where the whole element ends in the buffer it was read from */
  end: number;
}

/** The element starting at `offset`. Throws DerError. */
export function readTlv(buf: Buffer, offset = 0): Tlv {
  let pos = offset;
  const need = (n: number) => {
    if (pos + n > buf.length) throw new DerError(`needs ${n} more bytes at ${pos}`);
  };
  need(1);
  const first = buf[pos++];
  const tagClass = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tagNumber = first & 0x1f;
  if (tagNumber === 0x1f) {
    tagNumber = 0;
    for (let i = 0; ; i += 1) {
      if (i >= 4) throw new DerError(`tag number too long at ${offset}`);
      need(1);
      const b = buf[pos++];
      tagNumber = tagNumber * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
  }
  need(1);
  let length = buf[pos++];
  if (length === 0x80) throw new DerError(`indefinite length at ${offset}`);
  if (length > 0x80) {
    const bytes = length & 0x7f;
    if (bytes > 4) throw new DerError(`length of ${bytes} bytes at ${offset}`);
    need(bytes);
    length = 0;
    for (let i = 0; i < bytes; i += 1) length = length * 256 + buf[pos++];
  }
  need(length);
  return { tagClass, constructed, tagNumber, value: buf.subarray(pos, pos + length), end: pos + length };
}

/** The elements inside a constructed one, in order. Throws DerError. */
export function childrenOf(tlv: Tlv): Tlv[] {
  if (!tlv.constructed) throw new DerError("not a constructed element");
  const out: Tlv[] = [];
  let pos = 0;
  while (pos < tlv.value.length) {
    const child = readTlv(tlv.value, pos);
    out.push(child);
    pos = child.end;
  }
  return out;
}

/** An OBJECT IDENTIFIER's contents in DER, from its dotted form ("1.2.840.113635.100.8.2"). */
export function oidContents(oid: string): Buffer {
  const arcs = oid.split(".").map((s) => {
    if (!/^\d+$/.test(s)) throw new DerError(`bad OID ${oid}`);
    return Number(s);
  });
  if (arcs.length < 2) throw new DerError(`bad OID ${oid}`);
  const out: number[] = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const bytes = [arc & 0x7f];
    for (let rest = Math.floor(arc / 128); rest > 0; rest = Math.floor(rest / 128)) bytes.unshift((rest & 0x7f) | 0x80);
    out.push(...bytes);
  }
  return Buffer.from(out);
}

const UNIVERSAL = 0;
const CONTEXT = 2;
const SEQUENCE = 16;
const OID = 6;
const BOOLEAN = 1;
const OCTET_STRING = 4;

/**
 * The contents of the extension `oid`'s extnValue OCTET STRING (itself DER), or null when the
 * certificate has no such extension. Throws DerError for a certificate it cannot read.
 */
export function certificateExtension(certDer: Buffer, oid: string): Buffer | null {
  const cert = readTlv(certDer);
  if (cert.tagClass !== UNIVERSAL || cert.tagNumber !== SEQUENCE) throw new DerError("a certificate is a SEQUENCE");
  const tbs = childrenOf(cert)[0];
  if (!tbs || tbs.tagClass !== UNIVERSAL || tbs.tagNumber !== SEQUENCE) throw new DerError("tbsCertificate is a SEQUENCE");
  const wrapper = childrenOf(tbs).find((t) => t.tagClass === CONTEXT && t.tagNumber === 3 && t.constructed);
  if (!wrapper) return null;
  const list = childrenOf(wrapper)[0];
  if (!list || list.tagNumber !== SEQUENCE) throw new DerError("extensions are a SEQUENCE");
  const want = oidContents(oid);
  for (const ext of childrenOf(list)) {
    const parts = childrenOf(ext);
    if (parts[0]?.tagNumber !== OID || !parts[0].value.equals(want)) continue;
    const value = parts[1]?.tagNumber === BOOLEAN ? parts[2] : parts[1];
    if (!value || value.tagClass !== UNIVERSAL || value.tagNumber !== OCTET_STRING || value.constructed) throw new DerError(`extension ${oid} has no OCTET STRING value`);
    return value.value;
  }
  return null;
}

/**
 * Apple's "decode the sequence and extract the single octet string that it contains": through
 * constructed elements that each hold exactly one element (the SEQUENCE, then the [1] wrapper)
 * down to a primitive OCTET STRING; its contents, or null when the shape is anything else.
 */
export function singleOctetString(der: Buffer): Buffer | null {
  try {
    let tlv = readTlv(der);
    if (tlv.end !== der.length) return null;
    for (let depth = 0; depth < 4; depth += 1) {
      if (!tlv.constructed) return tlv.tagClass === UNIVERSAL && tlv.tagNumber === OCTET_STRING ? Buffer.from(tlv.value) : null;
      const inner = childrenOf(tlv);
      if (inner.length !== 1) return null;
      tlv = inner[0];
    }
    return null;
  } catch {
    return null;
  }
}
