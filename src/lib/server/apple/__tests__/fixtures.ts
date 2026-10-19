/** App Store payloads as Apple's library decodes them, for the Apple tests (shapes from Apple's documentation). */
import { APPLE_PLAN } from "@/lib/billing/apple";

const BUNDLE = APPLE_PLAN.bundleId;
const PRODUCT = APPLE_PLAN.productId;
const DAY = 86_400_000;

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
