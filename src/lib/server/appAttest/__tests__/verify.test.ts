/**
 * The App Attest verifier (src/lib/server/appAttest/verify.ts) and its readers (cbor.ts, der.ts):
 *  - Apple's own published sample attestation (appleSample.ts), against the REAL pinned Apple App
 *    Attestation Root CA at a fixed time inside its certificate's validity;
 *  - fabricated attestations and assertions, made fresh on every run (attestKit.ts: a throwaway CA,
 *    a device key, a credential certificate with the nonce extension, real CBOR), each bent so that
 *    exactly one of Apple's steps fails.
 */
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CborError, decodeCbor } from "../cbor";
import { APPLE_APP_ATTESTATION_ROOT_SHA256, CHALLENGE_TTL_MS, DEFAULT_APP_ID, debugBypassAllowed, pinnedRoots } from "../config";
import { certificateExtension, oidContents, singleOctetString } from "../der";
import { decodeStandardBase64, isChallenge, newChallenge, parseDeviceId, parseKeyId } from "../encoding";
import { AAGUID_DEVELOPMENT, NONCE_OID, parseAuthData, sha256, verifyAssertion, verifyAttestation, type AttestationInput } from "../verify";
import { APPLE_SAMPLE } from "./appleSample";
import { encodeCbor, makeAssertion, makeAttestation, makeDevice, makeTestCa, type AttestationOptions, type TestCa, type TestDevice } from "./attestKit";

const APP_ID = DEFAULT_APP_ID;
const CHALLENGE = "Zq3x9m2Yb8Kd7Lp1Qw5Er4Ty6Ui0Op3As2Df1Gh7Jk";

let ca: TestCa;
let device: TestDevice;

beforeAll(() => {
  ca = makeTestCa();
  device = makeDevice();
}, 30_000);

function attest(over: Partial<AttestationOptions> = {}, input: Partial<AttestationInput> = {}) {
  const made = makeAttestation(ca, device, { appId: APP_ID, challenge: CHALLENGE, ...over });
  return verifyAttestation({
    keyId: device.keyIdBytes,
    attestation: made.bytes,
    clientDataHash: sha256(Buffer.from(CHALLENGE, "utf8")),
    appId: APP_ID,
    now: new Date(),
    roots: [ca.root],
    ...input,
  });
}

describe("Apple's published sample attestation (the real Apple root)", () => {
  const input = () => ({
    keyId: Buffer.from(APPLE_SAMPLE.keyId, "base64"),
    attestation: Buffer.from(APPLE_SAMPLE.attestation, "base64"),
    clientDataHash: APPLE_SAMPLE.clientDataHash,
    appId: APPLE_SAMPLE.appId,
    now: APPLE_SAMPLE.now,
    roots: pinnedRoots(),
  });

  it("verifies: chain to the pinned root, nonce, key id, App ID, counter 0, production aaguid, credential id", () => {
    const out = verifyAttestation(input());
    expect(out).toMatchObject({ ok: true, environment: "production" });
    if (!out.ok) return;
    expect(out.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(out.receipt?.length).toBeGreaterThan(1000);
  });

  it("carries Apple's expected nonce in its credential certificate", () => {
    const top = decodeCbor(Buffer.from(APPLE_SAMPLE.attestation, "base64")) as Map<string, unknown>;
    const x5c = (top.get("attStmt") as Map<string, unknown>).get("x5c") as Buffer[];
    const ext = certificateExtension(x5c[0], NONCE_OID);
    expect(singleOctetString(ext!)?.toString("base64")).toBe(APPLE_SAMPLE.expectedNonce);
    expect(sha256(top.get("authData") as Buffer, APPLE_SAMPLE.clientDataHash).toString("base64")).toBe(APPLE_SAMPLE.expectedNonce);
  });

  it("fails outside its certificate's three days, for another challenge, another app, or another key", () => {
    expect(verifyAttestation({ ...input(), now: new Date("2026-10-17T00:00:00Z") })).toEqual({ ok: false, why: "chain" });
    expect(verifyAttestation({ ...input(), clientDataHash: sha256(Buffer.from("another_challenge")) })).toEqual({ ok: false, why: "nonce" });
    expect(verifyAttestation({ ...input(), appId: APP_ID })).toEqual({ ok: false, why: "rp_id" });
    expect(verifyAttestation({ ...input(), keyId: device.keyIdBytes })).toEqual({ ok: false, why: "key_id" });
    expect(verifyAttestation({ ...input(), roots: [ca.root] })).toEqual({ ok: false, why: "chain" });
  });

  it("the pinned root is Apple's (fingerprint checked)", () => {
    const [root] = pinnedRoots();
    expect(root.fingerprint256.replace(/:/g, "")).toBe(APPLE_APP_ATTESTATION_ROOT_SHA256);
    expect(root.subject).toContain("Apple App Attestation Root CA");
    expect(root.ca).toBe(true);
  });
});

describe("a fabricated attestation", () => {
  it("verifies when everything is right (production and development)", () => {
    expect(attest()).toMatchObject({ ok: true, environment: "production" });
    expect(attest({ environment: "development" })).toMatchObject({ ok: true, environment: "development" });
    const out = attest();
    if (!out.ok) throw new Error("expected ok");
    expect(out.receipt?.toString()).toBe("test receipt");
    // the stored key is the device's
    expect(out.publicKeyPem).toBe(device.publicPem);
  });

  it("chains to another root: refused (chain)", () => {
    const other = makeTestCa();
    expect(attest({}, { roots: [other.root] })).toEqual({ ok: false, why: "chain" });
    // the intermediate swapped for another CA's, or missing
    expect(attest({ x5c: (cred) => [cred, other.intermediate.raw] })).toEqual({ ok: false, why: "chain" });
    expect(attest({ x5c: (cred) => [cred] })).toEqual({ ok: false, why: "format" });
  }, 30_000);

  it("an expired (or not yet valid) certificate: refused (chain)", () => {
    expect(attest({}, { now: new Date(Date.now() + 4 * 86_400_000) })).toEqual({ ok: false, why: "chain" });
    expect(attest({}, { now: new Date(Date.now() - 86_400_000) })).toEqual({ ok: false, why: "chain" });
  });

  it("the wrong nonce (another challenge, or none in the certificate): refused (nonce)", () => {
    expect(attest({}, { clientDataHash: sha256(Buffer.from("not the challenge")) })).toEqual({ ok: false, why: "nonce" });
    expect(attest({ certNonce: Buffer.alloc(32, 7) })).toEqual({ ok: false, why: "nonce" });
    expect(attest({ certNonce: null })).toEqual({ ok: false, why: "nonce" });
  });

  it("a key id that is not the certificate's key: refused (key_id)", () => {
    expect(attest({}, { keyId: makeDevice().keyIdBytes })).toEqual({ ok: false, why: "key_id" });
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(attest({ certKey: privateKey })).toEqual({ ok: false, why: "key_id" });
  });

  it("another app (RP ID): refused (rp_id)", () => {
    expect(attest({ rpId: "SG4YJW2K5Z.app.agathon.Other" })).toEqual({ ok: false, why: "rp_id" });
    expect(attest({}, { appId: "SG4YJW2K5Z.app.agathon.Other" })).toEqual({ ok: false, why: "rp_id" });
  });

  it("a counter that is not 0: refused (counter)", () => {
    expect(attest({ counter: 1 })).toEqual({ ok: false, why: "counter" });
  });

  it("an aaguid that is neither appattestdevelop nor appattest + seven zeros: refused (aaguid)", () => {
    expect(attest({ aaguid: Buffer.from("appattestdevelo!", "ascii") })).toEqual({ ok: false, why: "aaguid" });
    expect(attest({ aaguid: Buffer.concat([Buffer.from("appattest"), Buffer.alloc(6), Buffer.from([1])]) })).toEqual({ ok: false, why: "aaguid" });
  });

  it("a credential id that is not the key id: refused (credential_id)", () => {
    expect(attest({ credentialId: Buffer.alloc(32, 9) })).toEqual({ ok: false, why: "credential_id" });
  });

  it("anything that is not an apple-appattest CBOR object: refused (format)", () => {
    expect(attest({ fmt: "packed" })).toEqual({ ok: false, why: "format" });
    expect(attest({}, { attestation: Buffer.from("not cbor at all") })).toEqual({ ok: false, why: "format" });
    expect(attest({}, { attestation: encodeCbor({ fmt: "apple-appattest" }) })).toEqual({ ok: false, why: "format" });
    expect(attest({}, { attestation: encodeCbor({ fmt: "apple-appattest", attStmt: { x5c: ["text", "text"] }, authData: Buffer.alloc(40) }) })).toEqual({ ok: false, why: "format" });
  });
});

describe("an assertion", () => {
  const BODY = '{"problemId":"k2-0","work":[]}';
  const check = (assertion: Buffer, over: { body?: string; stored?: number; appId?: string; key?: string } = {}) =>
    verifyAssertion({ assertion, clientData: Buffer.from(over.body ?? BODY, "utf8"), appId: over.appId ?? APP_ID, publicKeyPem: over.key ?? device.publicPem, storedSignCount: over.stored ?? 0 });

  it("verifies over the body's exact bytes, and hands back its counter", () => {
    expect(check(makeAssertion(device, { appId: APP_ID, body: BODY, counter: 1 }).bytes)).toEqual({ ok: true, signCount: 1 });
    expect(check(makeAssertion(device, { appId: APP_ID, body: BODY, counter: 9 }).bytes, { stored: 8 })).toEqual({ ok: true, signCount: 9 });
  });

  it("a bad signature (another key signed it, or a flipped byte): refused (signature)", () => {
    const other = makeDevice();
    expect(check(makeAssertion(device, { appId: APP_ID, body: BODY, counter: 1, key: other.privateKey }).bytes)).toEqual({ ok: false, why: "signature" });
    expect(check(makeAssertion(device, { appId: APP_ID, body: BODY, counter: 1 }).bytes, { key: other.publicPem })).toEqual({ ok: false, why: "signature" });
    const good = makeAssertion(device, { appId: APP_ID, body: BODY, counter: 1 }).bytes;
    const top = decodeCbor(good) as Map<string, Buffer>;
    const sig = Buffer.from(top.get("signature")!);
    sig[sig.length - 1] ^= 0x01;
    expect(check(encodeCbor({ signature: sig, authenticatorData: top.get("authenticatorData")! }))).toEqual({ ok: false, why: "signature" });
  });

  it("another body (clientDataHash): refused (signature) — even one byte, even whitespace", () => {
    const made = makeAssertion(device, { appId: APP_ID, body: BODY, counter: 1 }).bytes;
    expect(check(made, { body: '{"problemId":"k2-1","work":[]}' })).toEqual({ ok: false, why: "signature" });
    expect(check(made, { body: `${BODY} ` })).toEqual({ ok: false, why: "signature" });
  });

  it("a replay (a counter not above the stored one): refused (counter)", () => {
    const made = makeAssertion(device, { appId: APP_ID, body: BODY, counter: 5 }).bytes;
    expect(check(made, { stored: 4 })).toEqual({ ok: true, signCount: 5 });
    expect(check(made, { stored: 5 })).toEqual({ ok: false, why: "counter" });
    expect(check(made, { stored: 6 })).toEqual({ ok: false, why: "counter" });
  });

  it("another app's RP ID: refused (rp_id); not an assertion: refused (format)", () => {
    expect(check(makeAssertion(device, { appId: APP_ID, rpId: "SG4YJW2K5Z.other", body: BODY, counter: 1 }).bytes)).toEqual({ ok: false, why: "rp_id" });
    expect(check(Buffer.from([0xa0]))).toEqual({ ok: false, why: "format" });
    expect(check(encodeCbor({ signature: Buffer.alloc(8), authenticatorData: Buffer.alloc(10) }))).toEqual({ ok: false, why: "format" });
    expect(check(Buffer.from("garbage"))).toEqual({ ok: false, why: "format" });
  });
});

describe("the readers", () => {
  it("CBOR: maps, bytes, text, integers, nested; strict about trailing bytes, truncation, indefinite lengths and duplicate keys", () => {
    const value = decodeCbor(encodeCbor({ a: 1, b: [-1, -500, 70000, "x"], c: Buffer.from([1, 2, 3]), d: true, e: null })) as Map<string, unknown>;
    expect(value.get("a")).toBe(1);
    expect(value.get("b")).toEqual([-1, -500, 70000, "x"]);
    expect(value.get("c")).toEqual(Buffer.from([1, 2, 3]));
    expect(value.get("d")).toBe(true);
    expect(value.get("e")).toBe(null);
    expect(() => decodeCbor(Buffer.concat([encodeCbor(1), Buffer.from([0])]))).toThrow(CborError);
    expect(() => decodeCbor(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff]))).toThrow(CborError);
    expect(() => decodeCbor(Buffer.from([0x9f, 0x01, 0xff]))).toThrow(/indefinite/);
    expect(() => decodeCbor(Buffer.from([0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02]))).toThrow(/duplicate/);
    expect(() => decodeCbor(Buffer.from([0x62, 0xc3, 0x28]))).toThrow(/UTF-8/);
    let deep = encodeCbor(1);
    for (let i = 0; i < 20; i++) deep = Buffer.concat([Buffer.from([0x81]), deep]);
    expect(() => decodeCbor(deep)).toThrow(/deeper/);
  });

  it("DER: OIDs encode as X.690 says; a certificate without the extension has none", () => {
    expect(oidContents(NONCE_OID).toString("hex")).toBe("2a864886f763640802");
    expect(certificateExtension(ca.root.raw, NONCE_OID)).toBeNull();
    expect(singleOctetString(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x05]))).toBeNull();
    expect(singleOctetString(Buffer.from("3006a1040402abcd", "hex"))?.toString("hex")).toBe("abcd");
  });

  it("authenticator data: the attested credential's aaguid and id are read; too short is null", () => {
    const made = makeAttestation(ca, device, { appId: APP_ID, challenge: CHALLENGE, environment: "development" });
    const auth = parseAuthData(made.authData)!;
    expect(auth.signCount).toBe(0);
    expect(auth.attested?.aaguid).toEqual(AAGUID_DEVELOPMENT);
    expect(auth.attested?.credentialId).toEqual(device.keyIdBytes);
    expect(parseAuthData(Buffer.alloc(36))).toBeNull();
  });

  it("encodings: key ids are 32 bytes of standard base64; challenges are ours; device ids are uuids", () => {
    expect(parseKeyId(device.keyId)?.id).toBe(device.keyId);
    expect(parseKeyId(device.keyId.replace(/=$/, ""))?.id).toBe(device.keyId);
    expect(parseKeyId(Buffer.alloc(32, 0xfb).toString("base64"))?.bytes).toEqual(Buffer.alloc(32, 0xfb));
    expect(parseKeyId(Buffer.alloc(32, 0xfb).toString("base64url"))).toBeNull();
    expect(parseKeyId(Buffer.alloc(31).toString("base64"))).toBeNull();
    expect(parseKeyId("")).toBeNull();
    expect(decodeStandardBase64("a".repeat(10), 5)).toBeNull();
    const c = newChallenge();
    expect(isChallenge(c)).toBe(true);
    expect(Buffer.from(c, "base64url")).toHaveLength(32);
    expect(isChallenge("short")).toBe(false);
    expect(parseDeviceId("3F2B8C1E-5D4A-4B6C-9E8F-7A1B2C3D4E5F")).toBe("3f2b8c1e-5d4a-4b6c-9e8f-7a1b2c3d4e5f");
    expect(parseDeviceId("not-a-uuid")).toBeNull();
    expect(CHALLENGE_TTL_MS).toBe(300_000);
  });

  it("the debug bypass is off whenever NODE_ENV or VERCEL_ENV says production", () => {
    expect(debugBypassAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(debugBypassAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(debugBypassAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(debugBypassAllowed({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
    expect(debugBypassAllowed({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
  });

  it("the test CA is what it says (a guard on the fixtures themselves)", () => {
    expect(ca.intermediate.checkIssued(ca.root)).toBe(true);
    expect(new X509Certificate(ca.rootPem).ca).toBe(true);
  });
});
