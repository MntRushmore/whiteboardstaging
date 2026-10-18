/**
 * Fabricated App Attest objects for tests, made fresh on every run (no key is ever committed):
 *  - a throwaway CA standing in for Apple's (a root, and an intermediate it signs), made with
 *    `openssl` like the billing lane's App Store chain (src/lib/server/apple/__tests__/testChain.ts
 *    on feat/ipad-billing; the approach is copied, nothing is imported across worktrees);
 *  - a device key (P-256, node:crypto) whose key id is SHA256 of its uncompressed point, as
 *    DCAppAttestService makes it;
 *  - a credential certificate for that key, signed by the intermediate, carrying the nonce in the
 *    extension 1.2.840.113635.100.8.2 as Apple does: `SEQUENCE { [1] { OCTET STRING nonce } }`;
 *  - real CBOR attestation and assertion objects (`encodeCbor`, a small encoder for the tests).
 * Every field can be bent (`opts`) so each verification step has a case that fails it.
 *
 * Needs `openssl` on the PATH (macOS and Linux both have it).
 */
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign, X509Certificate, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AAGUID_DEVELOPMENT, AAGUID_PRODUCTION } from "../verify";

const sha256 = (...parts: Buffer[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

// ------------------------------------------------------------------ CBOR, encoded

type Encodable = number | string | boolean | null | Buffer | Encodable[] | Map<string | number, Encodable> | { [key: string]: Encodable };

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

/** Definite-length CBOR of `value` (integers, text, bytes, arrays, maps; plain objects are text-keyed maps). */
export function encodeCbor(value: Encodable): Buffer {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("encodeCbor: integers only");
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (typeof value === "boolean") return Buffer.from([value ? 0xf5 : 0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)])]);
}

// ------------------------------------------------------------------ the CA

export interface TestCa {
  root: X509Certificate;
  intermediate: X509Certificate;
  rootKeyPem: string;
  interKeyPem: string;
  rootPem: string;
  interPem: string;
}

function ecKey(): { privateKey: KeyObject; pem: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

const serial = () => `0x${randomUUID().replace(/-/g, "").slice(0, 16)}`;

function inDir<T>(fn: (path: (name: string) => string, run: (args: string[]) => void) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "agathon-appattest-"));
  try {
    return fn(
      (name) => join(dir, name),
      (args) => {
        execFileSync("openssl", args, { stdio: "pipe" });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A root CA and an intermediate CA it signed, valid from now for `days`. */
export function makeTestCa(days = 3): TestCa {
  return inDir((path, run) => {
    const root = ecKey();
    const inter = ecKey();
    writeFileSync(path("root.key"), root.pem);
    writeFileSync(path("inter.key"), inter.pem);
    writeFileSync(path("ca.ext"), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
    run(["req", "-new", "-key", path("root.key"), "-subj", "/CN=Agathon Test App Attestation Root CA/O=Agathon Tests", "-out", path("root.csr")]);
    run(["x509", "-req", "-in", path("root.csr"), "-signkey", path("root.key"), "-days", String(days), "-sha256", "-set_serial", serial(), "-extfile", path("ca.ext"), "-out", path("root.pem")]);
    run(["req", "-new", "-key", path("inter.key"), "-subj", "/CN=Agathon Test App Attestation CA 1/O=Agathon Tests", "-out", path("inter.csr")]);
    run(["x509", "-req", "-in", path("inter.csr"), "-CA", path("root.pem"), "-CAkey", path("root.key"), "-days", String(days), "-sha256", "-set_serial", serial(), "-extfile", path("ca.ext"), "-out", path("inter.pem")]);
    const rootPem = readFileSync(path("root.pem"), "utf8");
    const interPem = readFileSync(path("inter.pem"), "utf8");
    return { root: new X509Certificate(rootPem), intermediate: new X509Certificate(interPem), rootKeyPem: root.pem, interKeyPem: inter.pem, rootPem, interPem };
  });
}

/** A credential certificate for the device key `deviceKey`, signed by the CA's intermediate, holding `nonce` in 1.2.840.113635.100.8.2 (null: no such extension). */
export function makeCredCert(ca: TestCa, deviceKey: KeyObject, nonce: Buffer | null, days = 3): Buffer {
  return inDir((path, run) => {
    writeFileSync(path("csr.key"), deviceKey.export({ type: "pkcs8", format: "pem" }).toString());
    writeFileSync(path("inter.key"), ca.interKeyPem);
    writeFileSync(path("inter.pem"), ca.interPem);
    const ext = ["basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment,dataEncipherment,keyAgreement"];
    if (nonce) {
      const der = Buffer.concat([Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]), nonce]);
      ext.push(`1.2.840.113635.100.8.2=DER:${[...der].map((b) => b.toString(16).padStart(2, "0")).join(":")}`);
    }
    writeFileSync(path("leaf.ext"), `${ext.join("\n")}\n`);
    run(["req", "-new", "-key", path("csr.key"), "-subj", "/CN=Agathon Test Credential/OU=AAA Certification/O=Agathon Tests", "-out", path("leaf.csr")]);
    run([
      "x509", "-req", "-in", path("leaf.csr"), "-CA", path("inter.pem"), "-CAkey", path("inter.key"),
      "-days", String(days), "-sha256", "-set_serial", serial(), "-extfile", path("leaf.ext"), "-out", path("leaf.pem"),
    ]);
    return new X509Certificate(readFileSync(path("leaf.pem"))).raw;
  });
}

// ------------------------------------------------------------------ the device

export interface TestDevice {
  privateKey: KeyObject;
  publicPem: string;
  /** SHA256 of the uncompressed point: what DCAppAttestService calls the key id */
  keyIdBytes: Buffer;
  /** standard base64, padded, as the app sends it */
  keyId: string;
  x: Buffer;
  y: Buffer;
}

export function makeDevice(): TestDevice {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  const keyIdBytes = sha256(Buffer.concat([Buffer.from([4]), x, y]));
  return { privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), keyIdBytes, keyId: keyIdBytes.toString("base64"), x, y };
}

export interface AttestationOptions {
  appId: string;
  /** the challenge string the server issued */
  challenge: string;
  /** what goes in authData (default: a correct value for each) */
  rpId?: string;
  counter?: number;
  environment?: "development" | "production";
  aaguid?: Buffer;
  credentialId?: Buffer;
  /** the nonce put in the certificate (default: the right one); null: no nonce extension */
  certNonce?: Buffer | null;
  /** a different key in the certificate (its hash then is not the key id) */
  certKey?: KeyObject;
  /** x5c as given (default [credCert, intermediate]) */
  x5c?: (credCert: Buffer, ca: TestCa) => Buffer[];
  certDays?: number;
  fmt?: string;
  receipt?: Buffer;
}

/** The attestation object (CBOR) for `device`, and its standard base64 as the app sends it. */
export function makeAttestation(ca: TestCa, device: TestDevice, opts: AttestationOptions): { bytes: Buffer; base64: string; authData: Buffer } {
  const credId = opts.credentialId ?? device.keyIdBytes;
  const cose = encodeCbor(
    new Map<number, Encodable>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, device.x],
      [-3, device.y],
    ]),
  );
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter ?? 0);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credId.length);
  const aaguid = opts.aaguid ?? (opts.environment === "development" ? AAGUID_DEVELOPMENT : AAGUID_PRODUCTION);
  const authData = Buffer.concat([sha256(Buffer.from(opts.rpId ?? opts.appId, "utf8")), Buffer.from([0x40]), counter, aaguid, idLength, credId, cose]);
  const nonce = sha256(authData, sha256(Buffer.from(opts.challenge, "utf8")));
  const credCert = makeCredCert(ca, opts.certKey ?? device.privateKey, opts.certNonce === undefined ? nonce : opts.certNonce, opts.certDays ?? 3);
  const x5c = opts.x5c ? opts.x5c(credCert, ca) : [credCert, ca.intermediate.raw];
  const bytes = encodeCbor({ fmt: opts.fmt ?? "apple-appattest", attStmt: { x5c, receipt: opts.receipt ?? Buffer.from("test receipt") }, authData });
  return { bytes, base64: bytes.toString("base64"), authData };
}

export interface AssertionOptions {
  appId: string;
  /** the request body bytes the assertion covers */
  body: Buffer | string;
  counter: number;
  rpId?: string;
  /** sign with another key */
  key?: KeyObject;
}

/** The assertion object (CBOR) over `body`, and its standard base64 as the app sends it in X-Agathon-App-Assertion. */
export function makeAssertion(device: TestDevice, opts: AssertionOptions): { bytes: Buffer; base64: string } {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter);
  const authenticatorData = Buffer.concat([sha256(Buffer.from(opts.rpId ?? opts.appId, "utf8")), Buffer.from([0x00]), counter]);
  const body = typeof opts.body === "string" ? Buffer.from(opts.body, "utf8") : opts.body;
  const nonce = sha256(authenticatorData, sha256(body));
  // DCAppAttestService: ECDSA P-256 with SHA-256 over the nonce, DER-encoded
  const signature = sign("sha256", nonce, opts.key ?? device.privateKey);
  const bytes = encodeCbor({ signature, authenticatorData });
  return { bytes, base64: bytes.toString("base64") };
}
