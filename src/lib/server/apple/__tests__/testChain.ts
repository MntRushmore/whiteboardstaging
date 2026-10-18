/**
 * A throwaway App Store-shaped certificate chain for tests, made fresh on every run (no key is ever
 * committed): a root CA, an intermediate carrying Apple's intermediate marker OID
 * (1.2.840.113635.100.6.2.1) and a leaf carrying the App Store receipt-signing OID
 * (1.2.840.113635.100.6.11.1), which is what Apple's SignedDataVerifier checks besides the
 * signatures. The tests hand its root to the verifier in place of Apple's, as Apple's own library
 * tests do with their test CA, and sign JWS with the leaf's key (ES256, x5c = [leaf, intermediate,
 * root]).
 *
 * Needs `openssl` on the PATH (macOS and Linux both have it); keys come from node:crypto.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign, X509Certificate, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TestChain = {
  /** The root, DER: the verifier's trusted root in tests. */
  root: Buffer;
  /** [leaf, intermediate, root] as base64 DER, the x5c header. */
  x5c: string[];
  leafKey: KeyObject;
  /** A compact ES256 JWS of `payload` signed by the leaf. */
  sign(payload: unknown, opts?: { key?: KeyObject; x5c?: string[] }): string;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A compact ES256 JWS with these header fields, signed by `key`. */
export function signJws(payload: unknown, key: KeyObject, header: Record<string, unknown>): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg: "ES256", ...header })));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64url(s)}`;
}

/** A fresh EC P-256 key pair; the private key as PKCS#8 PEM. */
export function ecKey(): { privateKey: KeyObject; pem: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/** A self-signed certificate for `key` (Xcode's StoreKit test certificate is one), PEM. */
export function selfSignedCert(cn: string): { pem: string; key: KeyObject } {
  const dir = mkdtempSync(join(tmpdir(), "agathon-xcode-cert-"));
  try {
    const k = ecKey();
    writeFileSync(join(dir, "key.pem"), k.pem);
    execFileSync("openssl", ["req", "-x509", "-new", "-key", join(dir, "key.pem"), "-subj", `/CN=${cn}`, "-days", "2", "-sha256", "-out", join(dir, "cert.pem")], { stdio: "pipe" });
    return { pem: readFileSync(join(dir, "cert.pem"), "utf8"), key: k.privateKey };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function makeTestChain(): TestChain {
  const dir = mkdtempSync(join(tmpdir(), "agathon-apple-chain-"));
  const path = (name: string) => join(dir, name);
  const serial = () => `0x${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const run = (args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });
  try {
    const root = ecKey();
    const inter = ecKey();
    const leaf = ecKey();
    writeFileSync(path("root.key"), root.pem);
    writeFileSync(path("inter.key"), inter.pem);
    writeFileSync(path("leaf.key"), leaf.pem);
    writeFileSync(path("root.ext"), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
    writeFileSync(path("inter.ext"), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n");
    writeFileSync(path("leaf.ext"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=ASN1:NULL\n");

    // Root: self-signed, then the intermediate and the leaf, each signed by the one above it.
    run(["req", "-new", "-key", path("root.key"), "-subj", "/CN=Agathon Test Root CA/O=Agathon Tests", "-out", path("root.csr")]);
    run(["x509", "-req", "-in", path("root.csr"), "-signkey", path("root.key"), "-days", "3", "-sha256", "-set_serial", serial(), "-extfile", path("root.ext"), "-out", path("root.pem")]);
    run(["req", "-new", "-key", path("inter.key"), "-subj", "/CN=Agathon Test WWDR Intermediate/O=Agathon Tests", "-out", path("inter.csr")]);
    run(["x509", "-req", "-in", path("inter.csr"), "-CA", path("root.pem"), "-CAkey", path("root.key"), "-days", "3", "-sha256", "-set_serial", serial(), "-extfile", path("inter.ext"), "-out", path("inter.pem")]);
    run(["req", "-new", "-key", path("leaf.key"), "-subj", "/CN=Agathon Test StoreKit Signing/O=Agathon Tests", "-out", path("leaf.csr")]);
    run(["x509", "-req", "-in", path("leaf.csr"), "-CA", path("inter.pem"), "-CAkey", path("inter.key"), "-days", "3", "-sha256", "-set_serial", serial(), "-extfile", path("leaf.ext"), "-out", path("leaf.pem")]);

    const der = (name: string) => new X509Certificate(readFileSync(path(name))).raw;
    const rootDer = der("root.pem");
    const x5c = [der("leaf.pem"), der("inter.pem"), rootDer].map((d) => d.toString("base64"));
    return {
      root: rootDer,
      x5c,
      leafKey: leaf.privateKey,
      sign: (payload, opts) => signJws(payload, opts?.key ?? leaf.privateKey, { x5c: opts?.x5c ?? x5c }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
