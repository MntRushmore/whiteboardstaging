/**
 * The App Store side of Agathon Unlimited's Apple purchases, without a network or a database:
 * Apple's roots are the ones Apple publishes; the APPLE_* settings (production never takes Xcode's
 * unsigned payloads); payloads verified with Apple's own library against a test chain made fresh
 * per run (testChain.ts), including every way one is refused; and every App Store state and
 * notification type mapped onto the table's statuses.
 */
import { createHash, X509Certificate } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Environment, Status } from "@apple/app-store-server-library";
import { APPLE_PLAN } from "@/lib/billing/apple";
import { appleConfigFrom, isAppleConfigError, isProductionDeployment, type AppleConfig } from "@/lib/server/apple/config";
import { APPLE_ROOT_CA_G2, APPLE_ROOT_CA_G3, appleRootCertificates } from "@/lib/server/apple/roots";
import { appleStateOf, isFreeTrial, type AppleStateInput } from "@/lib/server/apple/state";
import { AppleVerifyError, checkPinnedSignature, createAppleVerifier } from "@/lib/server/apple/verify";
import { makeTestChain, selfSignedCert, signJws, ecKey, type TestChain } from "./testChain";

const BUNDLE = APPLE_PLAN.bundleId;
const PRODUCT = APPLE_PLAN.productId;
const APP_APPLE_ID = 6740000001;
const DAY = 86_400_000;

function config(over: Partial<AppleConfig> = {}): AppleConfig {
  return { primary: "Production", environments: ["Production", "Sandbox"], bundleId: BUNDLE, appAppleId: APP_APPLE_ID, ...over };
}

export function transactionPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    originalTransactionId: "2000000123456789",
    transactionId: "2000000123456789",
    webOrderLineItemId: "2000000011111111",
    bundleId: BUNDLE,
    productId: PRODUCT,
    subscriptionGroupIdentifier: "21500000",
    purchaseDate: now - 1000,
    originalPurchaseDate: now - 1000,
    expiresDate: now + 7 * DAY,
    quantity: 1,
    type: "Auto-Renewable Subscription",
    appAccountToken: "6f0d2b7e-9c3a-4e2f-8a51-1b2c3d4e5f60",
    inAppOwnershipType: "PURCHASED",
    signedDate: now,
    offerType: 1,
    offerDiscountType: "FREE_TRIAL",
    environment: "Sandbox",
    storefront: "USA",
    storefrontId: "143441",
    transactionReason: "PURCHASE",
    currency: "USD",
    price: 0,
    ...over,
  };
}

export function renewalPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    originalTransactionId: "2000000123456789",
    autoRenewProductId: PRODUCT,
    productId: PRODUCT,
    autoRenewStatus: 1,
    signedDate: now,
    environment: "Sandbox",
    recentSubscriptionStartDate: now - 1000,
    renewalDate: now + 7 * DAY,
    renewalPrice: 24990,
    currency: "USD",
    ...over,
  };
}

describe("Apple's root certificates", () => {
  const fingerprint = (b64: string) => createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase().match(/../g)!.join(":");

  it("are byte for byte the ones Apple publishes (SHA-256 fingerprints from apple.com/certificateauthority)", () => {
    expect(fingerprint(APPLE_ROOT_CA_G3)).toBe("63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79");
    expect(fingerprint(APPLE_ROOT_CA_G2)).toBe("C2:B9:B0:42:DD:57:83:0E:7D:11:7D:AC:55:AC:8A:E1:94:07:D3:8E:41:D8:8F:32:15:BC:3A:89:04:44:A0:50");
  });

  it("are Apple's self-signed roots, valid well past launch", () => {
    for (const der of appleRootCertificates()) {
      const cert = new X509Certificate(der);
      expect(cert.subject).toContain("O=Apple Inc.");
      expect(cert.ca).toBe(true);
      expect(cert.verify(cert.publicKey)).toBe(true);
      expect(Date.parse(cert.validTo)).toBeGreaterThan(Date.parse("2035-01-01"));
    }
  });
});

describe("the APPLE_* settings", () => {
  it("is off without APPLE_ENVIRONMENT", () => {
    const c = appleConfigFrom({});
    expect(isAppleConfigError(c) && c.kind).toBe("unset");
  });

  it("Production takes Production and Sandbox (App Review and TestFlight buy in the Sandbox), and needs the app's Apple ID", () => {
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Production", NODE_ENV: "production" })).toMatchObject({ kind: "invalid" });
    const c = appleConfigFrom({ APPLE_ENVIRONMENT: "production", APPLE_APP_APPLE_ID: String(APP_APPLE_ID), NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(c).toMatchObject({ primary: "Production", environments: ["Production", "Sandbox"], bundleId: BUNDLE, appAppleId: APP_APPLE_ID });
  });

  it("Sandbox is Sandbox only", () => {
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Sandbox" })).toMatchObject({ environments: ["Sandbox"] });
  });

  it("REFUSES Xcode and LocalTesting on a production deployment (payloads Apple never signed)", () => {
    for (const env of ["Xcode", "LocalTesting"]) {
      expect(appleConfigFrom({ APPLE_ENVIRONMENT: env, NODE_ENV: "production" })).toMatchObject({ kind: "refused" });
      expect(appleConfigFrom({ APPLE_ENVIRONMENT: env, NODE_ENV: "development", VERCEL_ENV: "production" })).toMatchObject({ kind: "refused" });
    }
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
  });

  it("takes Xcode on a dev server, alone", () => {
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Xcode", NODE_ENV: "development" })).toMatchObject({ primary: "Xcode", environments: ["Xcode"] });
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "LocalTesting", NODE_ENV: "test" })).toMatchObject({ environments: ["LocalTesting"] });
  });

  it("refuses typos and a malformed app id, bundle id or Xcode certificate", () => {
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Staging" })).toMatchObject({ kind: "invalid" });
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Sandbox", APPLE_APP_APPLE_ID: "abc" })).toMatchObject({ kind: "invalid" });
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Sandbox", APPLE_BUNDLE_ID: "not a bundle!" })).toMatchObject({ kind: "invalid" });
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Xcode", APPLE_XCODE_CERT: "nope", NODE_ENV: "development" })).toMatchObject({ kind: "invalid" });
  });
});

describe("verifying App Store payloads (Apple's SignedDataVerifier, a test chain in place of Apple's root)", () => {
  let chain: TestChain;
  beforeAll(() => {
    chain = makeTestChain();
  });
  const verifier = (c: AppleConfig = config()) => createAppleVerifier(c, { roots: [chain.root], onlineChecks: false });

  it("decodes a transaction signed through the chain", async () => {
    const t = await verifier().transaction(chain.sign(transactionPayload()));
    expect(t).toMatchObject({ originalTransactionId: "2000000123456789", productId: PRODUCT, environment: "Sandbox", appAccountToken: "6f0d2b7e-9c3a-4e2f-8a51-1b2c3d4e5f60" });
  });

  it("tries Production first, then Sandbox: a Sandbox purchase is accepted by a production deployment", async () => {
    await expect(verifier().transaction(chain.sign(transactionPayload({ environment: "Production" })))).resolves.toMatchObject({ environment: "Production" });
    await expect(verifier().transaction(chain.sign(transactionPayload({ environment: "Sandbox" })))).resolves.toMatchObject({ environment: "Sandbox" });
  });

  it("refuses a Sandbox payload where only Production is configured... and an Xcode one everywhere but Xcode", async () => {
    const productionOnly = verifier(config({ environments: ["Production"] }));
    await expect(productionOnly.transaction(chain.sign(transactionPayload({ environment: "Sandbox" })))).rejects.toMatchObject({ kind: "environment" });
    await expect(verifier().transaction(chain.sign(transactionPayload({ environment: "Xcode" })))).rejects.toMatchObject({ kind: "environment" });
  });

  it("refuses an Xcode-signed purchase (a self-signed key, no Apple chain) on production", async () => {
    const xcode = selfSignedCert("StoreKit Testing in Xcode");
    const der = new X509Certificate(xcode.pem).raw.toString("base64");
    const forged = signJws(transactionPayload({ environment: "Production" }), xcode.key, { x5c: [der] });
    await expect(verifier().transaction(forged)).rejects.toBeInstanceOf(AppleVerifyError);
    await expect(verifier().transaction(forged)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses a chain that does not reach the trusted root", async () => {
    const other = makeTestChain();
    await expect(verifier().transaction(other.sign(transactionPayload()))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses a payload signed by a key that is not the leaf's", async () => {
    await expect(verifier().transaction(chain.sign(transactionPayload(), { key: ecKey().privateKey }))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses a payload changed after signing", async () => {
    const [h, , s] = chain.sign(transactionPayload()).split(".");
    const tampered = Buffer.from(JSON.stringify(transactionPayload({ expiresDate: Date.now() + 365 * DAY }))).toString("base64url");
    await expect(verifier().transaction(`${h}.${tampered}.${s}`)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses a chain that had expired when the payload was signed", async () => {
    await expect(verifier().transaction(chain.sign(transactionPayload({ signedDate: Date.now() + 30 * DAY })))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses another app's purchase", async () => {
    await expect(verifier().transaction(chain.sign(transactionPayload({ bundleId: "com.example.other" })))).rejects.toMatchObject({ kind: "app" });
  });

  it("decodes renewal info and a V2 notification (bundle id, environment and, in Production, the app's Apple ID)", async () => {
    await expect(verifier().renewalInfo(chain.sign(renewalPayload()))).resolves.toMatchObject({ autoRenewStatus: 1, renewalPrice: 24990 });
    const note = (data: Record<string, unknown>) =>
      chain.sign({ notificationType: "TEST", notificationUUID: "9ad1bd28-7d1f-4f2b-9f0e-000000000001", version: "2.0", signedDate: Date.now(), data });
    await expect(verifier().notification(note({ bundleId: BUNDLE, environment: "Production", appAppleId: APP_APPLE_ID }))).resolves.toMatchObject({ notificationType: "TEST" });
    await expect(verifier().notification(note({ bundleId: BUNDLE, environment: "Sandbox" }))).resolves.toMatchObject({ notificationType: "TEST" });
    await expect(verifier().notification(note({ bundleId: BUNDLE, environment: "Production", appAppleId: 1 }))).rejects.toMatchObject({ kind: "app" });
    await expect(verifier().notification(note({ bundleId: "com.example.other", environment: "Sandbox" }))).rejects.toMatchObject({ kind: "app" });
  });

  it("refuses garbage", async () => {
    await expect(verifier().transaction("not.a.jws")).rejects.toBeInstanceOf(AppleVerifyError);
    await expect(verifier().notification("eyJhbGciOiJFUzI1NiJ9.e30.")).rejects.toBeInstanceOf(AppleVerifyError);
  });
});

describe("Xcode's StoreKit testing payloads (a dev server only)", () => {
  const xcodeConfig = (over: Partial<AppleConfig> = {}): AppleConfig => ({ primary: "Xcode", environments: ["Xcode"], bundleId: BUNDLE, ...over });

  it("are decoded unchecked when no certificate is pinned (Apple's library: they are not Apple-signed)", async () => {
    const xcode = selfSignedCert("StoreKit Testing in Xcode");
    const jws = signJws(transactionPayload({ environment: "Xcode" }), xcode.key, { kid: "Apple_Xcode_Key", x5c: [new X509Certificate(xcode.pem).raw.toString("base64")] });
    const v = createAppleVerifier(xcodeConfig(), { roots: [], onlineChecks: false });
    await expect(v.transaction(jws)).resolves.toMatchObject({ environment: "Xcode" });
    // but never a payload from another environment
    await expect(v.transaction(signJws(transactionPayload({ environment: "Production" }), xcode.key, {}))).rejects.toMatchObject({ kind: "environment" });
  });

  it("must carry the pinned certificate's signature when APPLE_XCODE_CERT is set", async () => {
    const mine = selfSignedCert("StoreKit Testing in Xcode");
    const someoneElse = selfSignedCert("StoreKit Testing in Xcode");
    const config = appleConfigFrom({ APPLE_ENVIRONMENT: "Xcode", APPLE_XCODE_CERT: mine.pem, NODE_ENV: "development" });
    if (isAppleConfigError(config)) throw new Error(config.error);
    const v = createAppleVerifier(config, { roots: [], onlineChecks: false });
    await expect(v.transaction(signJws(transactionPayload({ environment: "Xcode" }), mine.key, {}))).resolves.toMatchObject({ environment: "Xcode" });
    await expect(v.transaction(signJws(transactionPayload({ environment: "Xcode" }), someoneElse.key, {}))).rejects.toMatchObject({ kind: "invalid" });
    expect(() => checkPinnedSignature("a.b", new X509Certificate(mine.pem))).toThrow(AppleVerifyError);
    // a base64 DER certificate works as well as PEM
    const der = new X509Certificate(mine.pem).raw.toString("base64");
    expect(appleConfigFrom({ APPLE_ENVIRONMENT: "Xcode", APPLE_XCODE_CERT: der, NODE_ENV: "development" })).toHaveProperty("xcodeCert");
  });
});

describe("the App Store's state, as the table's statuses (state.ts)", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const t = (over: Record<string, unknown> = {}) => transactionPayload({ signedDate: now - 1000, purchaseDate: now - DAY, expiresDate: now + 6 * DAY, ...over });
  const r = (over: Record<string, unknown> = {}) => renewalPayload({ signedDate: now - 1000, ...over });
  const state = (input: Partial<AppleStateInput> & { transaction: Record<string, unknown> }) =>
    appleStateOf({ productId: PRODUCT, now, ...input } as AppleStateInput);

  it("SUBSCRIBED/INITIAL_BUY in the free week -> trialing, with the trial's end, the token and the next price", () => {
    expect(state({ transaction: t(), renewalInfo: r(), status: Status.ACTIVE, notificationType: "SUBSCRIBED", subtype: "INITIAL_BUY", signedDate: now })).toEqual({
      originalTransactionId: "2000000123456789",
      environment: "Sandbox",
      productId: PRODUCT,
      transactionId: "2000000123456789",
      status: "trialing",
      trialEnd: new Date(now + 6 * DAY).toISOString(),
      currentPeriodEnd: new Date(now + 6 * DAY).toISOString(),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      appAccountToken: "6f0d2b7e-9c3a-4e2f-8a51-1b2c3d4e5f60",
      priceMilliunits: 24990,
      currency: "USD",
      eventAt: new Date(now).toISOString(),
    });
  });

  it("DID_RENEW -> active, no trial end of its own (the row keeps the first)", () => {
    const s = state({ transaction: t({ offerType: undefined, offerDiscountType: undefined, price: 24990, transactionId: "2000000200000000" }), renewalInfo: r(), status: Status.ACTIVE, notificationType: "DID_RENEW", signedDate: now });
    expect(s).toMatchObject({ status: "active", trialEnd: null, transactionId: "2000000200000000", priceMilliunits: 24990 });
  });

  it("DID_RENEW/BILLING_RECOVERY -> active again", () => {
    expect(state({ transaction: t({ offerType: undefined }), status: Status.ACTIVE, notificationType: "DID_RENEW", subtype: "BILLING_RECOVERY" })).toMatchObject({ status: "active" });
  });

  it("DID_FAIL_TO_RENEW (billing retry, or its GRACE_PERIOD subtype) -> past_due: help spends ink until it is paid", () => {
    expect(state({ transaction: t({ expiresDate: now - DAY }), status: Status.BILLING_RETRY, notificationType: "DID_FAIL_TO_RENEW" })).toMatchObject({ status: "past_due" });
    expect(state({ transaction: t({ expiresDate: now - DAY }), status: Status.BILLING_GRACE_PERIOD, notificationType: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD" })).toMatchObject({ status: "past_due" });
    expect(state({ transaction: t({ expiresDate: now - DAY }), notificationType: "DID_FAIL_TO_RENEW" })).toMatchObject({ status: "past_due" });
  });

  it("GRACE_PERIOD_EXPIRED -> past_due (Apple keeps retrying)", () => {
    expect(state({ transaction: t({ expiresDate: now - 3 * DAY }), status: Status.BILLING_RETRY, notificationType: "GRACE_PERIOD_EXPIRED" })).toMatchObject({ status: "past_due" });
    expect(state({ transaction: t({ expiresDate: now - 3 * DAY }), notificationType: "GRACE_PERIOD_EXPIRED" })).toMatchObject({ status: "past_due" });
  });

  it("EXPIRED (VOLUNTARY, BILLING_RETRY, PRICE_INCREASE) -> canceled, ended at the expiry", () => {
    for (const subtype of ["VOLUNTARY", "BILLING_RETRY", "PRICE_INCREASE"]) {
      expect(state({ transaction: t({ expiresDate: now - DAY }), status: Status.EXPIRED, notificationType: "EXPIRED", subtype })).toMatchObject({
        status: "canceled",
        endedAt: new Date(now - DAY).toISOString(),
      });
    }
    expect(state({ transaction: t({ expiresDate: now - DAY }), notificationType: "EXPIRED" })).toMatchObject({ status: "canceled" });
  });

  it("REFUND -> canceled, ended and cancelled at the revocation", () => {
    const s = state({ transaction: t({ revocationDate: now - 60_000, revocationReason: 0 }), status: Status.REVOKED, notificationType: "REFUND", signedDate: now });
    expect(s).toMatchObject({ status: "canceled", endedAt: new Date(now - 60_000).toISOString(), canceledAt: new Date(now - 60_000).toISOString() });
    // even when Apple says the subscription is otherwise active
    expect(state({ transaction: t({ revocationDate: now - 60_000 }), status: Status.ACTIVE, notificationType: "REFUND" })).toMatchObject({ status: "canceled" });
  });

  it("REVOKE -> canceled", () => {
    expect(state({ transaction: t(), status: Status.REVOKED, notificationType: "REVOKE", signedDate: now })).toMatchObject({ status: "canceled", endedAt: new Date(now).toISOString() });
  });

  it("DID_CHANGE_RENEWAL_STATUS: auto-renew off is 'set to cancel' (still Unlimited until the end), on is not", () => {
    expect(state({ transaction: t(), renewalInfo: r({ autoRenewStatus: 0 }), status: Status.ACTIVE, notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED" })).toMatchObject({
      status: "trialing",
      cancelAtPeriodEnd: true,
    });
    expect(state({ transaction: t(), renewalInfo: r({ autoRenewStatus: 1 }), status: Status.ACTIVE, notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED" })).toMatchObject({
      cancelAtPeriodEnd: false,
    });
    // without the renewal info, the subtype says it
    expect(state({ transaction: t(), status: Status.ACTIVE, notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED" })).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it("OFFER_REDEEMED -> the subscription's state (an offer code's free month is not the intro trial)", () => {
    expect(state({ transaction: t({ offerType: 3, offerDiscountType: "FREE_TRIAL", appAccountToken: undefined }), status: Status.ACTIVE, notificationType: "OFFER_REDEEMED" })).toMatchObject({
      status: "active",
      appAccountToken: null,
    });
  });

  it("REFUND_REVERSED and RENEWAL_EXTENDED carry a live subscription again", () => {
    expect(state({ transaction: t({ offerType: undefined }), status: Status.ACTIVE, notificationType: "REFUND_REVERSED" })).toMatchObject({ status: "active" });
    expect(state({ transaction: t({ offerType: undefined, expiresDate: now + 20 * DAY }), status: Status.ACTIVE, notificationType: "RENEWAL_EXTENDED" })).toMatchObject({
      currentPeriodEnd: new Date(now + 20 * DAY).toISOString(),
    });
  });

  it("a transaction the app posted (no data.status): read from its dates and the renewal info", () => {
    expect(state({ transaction: t() })).toMatchObject({ status: "trialing", cancelAtPeriodEnd: null, eventAt: new Date(now - 1000).toISOString() });
    expect(state({ transaction: t({ offerType: undefined }) })).toMatchObject({ status: "active" });
    expect(state({ transaction: t({ expiresDate: now - DAY }) })).toMatchObject({ status: "canceled" });
    expect(state({ transaction: t({ expiresDate: now - DAY }), renewalInfo: r({ isInBillingRetryPeriod: true }) })).toMatchObject({ status: "past_due" });
    expect(state({ transaction: t({ expiresDate: now - DAY }), renewalInfo: r({ gracePeriodExpiresDate: now + DAY }) })).toMatchObject({ status: "past_due" });
    expect(state({ transaction: t({ revocationDate: now - 5 }) })).toMatchObject({ status: "canceled" });
  });

  it("is not this plan's: another product, not a subscription, a family-shared copy, renewal info for another subscription", () => {
    expect(state({ transaction: t({ productId: "app.agathon.something.else" }) })).toHaveProperty("ignore");
    expect(state({ transaction: t({ type: "Consumable" }) })).toHaveProperty("ignore");
    expect(state({ transaction: t({ inAppOwnershipType: "FAMILY_SHARED" }) })).toHaveProperty("ignore");
    expect(state({ transaction: t(), renewalInfo: r({ originalTransactionId: "999" }) })).toHaveProperty("ignore");
    expect(state({ transaction: t({ originalTransactionId: undefined }) })).toHaveProperty("ignore");
  });

  it("keeps only a real token and a real currency", () => {
    expect(state({ transaction: t({ appAccountToken: "6F0D2B7E-9C3A-4E2F-8A51-1B2C3D4E5F60" }) })).toMatchObject({ appAccountToken: "6f0d2b7e-9c3a-4e2f-8a51-1b2c3d4e5f60" });
    expect(state({ transaction: t({ appAccountToken: "user-id-123" }) })).toMatchObject({ appAccountToken: null });
    expect(state({ transaction: t({ price: 0 }) })).toMatchObject({ priceMilliunits: null, currency: null });
  });

  it("only the intro offer's free week is a trial", () => {
    expect(isFreeTrial({ offerType: 1, offerDiscountType: "FREE_TRIAL" })).toBe(true);
    expect(isFreeTrial({ offerType: 1 })).toBe(true);
    expect(isFreeTrial({ offerType: 1, offerDiscountType: "PAY_AS_YOU_GO" })).toBe(false);
    expect(isFreeTrial({ offerType: 2, offerDiscountType: "FREE_TRIAL" })).toBe(false);
    expect(isFreeTrial({})).toBe(false);
  });

  it("knows every environment Apple's library names", () => {
    expect(Object.values(Environment).sort()).toEqual(["LocalTesting", "Production", "Sandbox", "Xcode"]);
  });
});
