import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hmacSha256Hex,
  parseStripeSignature,
  signStripePayload,
  timingSafeEqualHex,
  verifyStripeSignature,
} from "@/lib/server/webhookSignature";

const SECRET = "whsec_test_secret_0123456789";
const BODY = '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{}}}';
const NOW = 1_760_000_000; // unix seconds, arbitrary fixed point

describe("parseStripeSignature", () => {
  it("parses t and every v1, ignoring v0 and unknown schemes", () => {
    expect(parseStripeSignature("t=1700000000,v1=abc123,v0=legacy,v1=DEF456,foo=bar")).toEqual({
      t: 1_700_000_000,
      v1: ["abc123", "def456"],
    });
  });

  it("tolerates whitespace around parts", () => {
    expect(parseStripeSignature(" t=5 , v1=aa ")).toEqual({ t: 5, v1: ["aa"] });
  });

  it("returns null for a missing header, a missing t, a non-numeric t, or no valid v1", () => {
    expect(parseStripeSignature(null)).toBeNull();
    expect(parseStripeSignature("")).toBeNull();
    expect(parseStripeSignature("v1=abc")).toBeNull();
    expect(parseStripeSignature("t=abc,v1=abc")).toBeNull();
    expect(parseStripeSignature("t=1,v1=not-hex!")).toBeNull();
    expect(parseStripeSignature("t=1,v0=abc")).toBeNull();
  });
});

describe("hmacSha256Hex", () => {
  it("matches the well-known RFC test vector", async () => {
    // HMAC_SHA256("key", "The quick brown fox jumps over the lazy dog")
    await expect(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).resolves.toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("agrees with node:crypto for the signed payload format", async () => {
    const expected = createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex");
    await expect(hmacSha256Hex(SECRET, `${NOW}.${BODY}`)).resolves.toBe(expected);
    await expect(signStripePayload(BODY, SECRET, NOW)).resolves.toBe(`t=${NOW},v1=${expected}`);
  });
});

describe("timingSafeEqualHex", () => {
  it("compares equal strings, rejects differences and length mismatches", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(true);
  });
});

describe("verifyStripeSignature", () => {
  it("accepts a header signed with the same secret within tolerance", async () => {
    const header = await signStripePayload(BODY, SECRET, NOW);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW })).resolves.toBe(true);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW + 299 })).resolves.toBe(true);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW - 300 })).resolves.toBe(true);
  });

  it("accepts when any one of several v1 values matches (secret rotation)", async () => {
    const good = (await signStripePayload(BODY, SECRET, NOW)).split("v1=")[1];
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${good}`;
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW })).resolves.toBe(true);
  });

  it("rejects outside the tolerance window (default 300 s, configurable)", async () => {
    const header = await signStripePayload(BODY, SECRET, NOW);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW + 301 })).resolves.toBe(false);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW - 301 })).resolves.toBe(false);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET, now: NOW + 30, toleranceSec: 10 })).resolves.toBe(false);
  });

  it("rejects a tampered body, a wrong secret, a bad header, and an empty secret", async () => {
    const header = await signStripePayload(BODY, SECRET, NOW);
    await expect(verifyStripeSignature({ header, rawBody: BODY + " ", secret: SECRET, now: NOW })).resolves.toBe(false);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: "other", now: NOW })).resolves.toBe(false);
    await expect(verifyStripeSignature({ header: null, rawBody: BODY, secret: SECRET, now: NOW })).resolves.toBe(false);
    await expect(verifyStripeSignature({ header: "t=1,v1=zz", rawBody: BODY, secret: SECRET, now: NOW })).resolves.toBe(false);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: "", now: NOW })).resolves.toBe(false);
  });

  it("rejects a signature whose timestamp was moved (t is part of the signed payload)", async () => {
    const header = await signStripePayload(BODY, SECRET, NOW);
    const moved = header.replace(`t=${NOW}`, `t=${NOW + 1}`);
    await expect(verifyStripeSignature({ header: moved, rawBody: BODY, secret: SECRET, now: NOW })).resolves.toBe(false);
  });

  it("defaults `now` to the wall clock", async () => {
    const t = Math.floor(Date.now() / 1000);
    const header = await signStripePayload(BODY, SECRET, t);
    await expect(verifyStripeSignature({ header, rawBody: BODY, secret: SECRET })).resolves.toBe(true);
  });
});
