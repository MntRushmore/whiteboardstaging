/**
 * Agathon Unlimited through Apple in-app purchase (the iPad app, StoreKit 2): the contract between
 * the app (ios/Packages/AgathonStore) and the server (src/lib/server/apple, the two routes under
 * src/app/api/billing/apple). docs/IPAD-NATIVE.md "Money"; docs/RUNBOOK-billing.md section 16.
 *
 * One auto-renewing monthly subscription in one subscription group, with a 7-day free trial (Apple's
 * introductory offer, for an Apple ID's first subscription in the group). The purchase carries
 * `appAccountToken` = the buyer's `profiles.checkout_ref` (read from `ink_summary().unlimited`), never
 * the user id, for the same reason as the Stripe checkout: a user id is not a secret.
 *
 * Pure constants and schemas: no server code, so the app's tests and the admin can import it.
 */
import { z } from "zod";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";

/** The App Store Connect record the app sells. ios/Agathon/Agathon.storekit must say the same. */
export const APPLE_PLAN = {
  /** The auto-renewable subscription's product id. */
  productId: "app.agathon.unlimited.monthly",
  /** Its subscription group's reference name (the .storekit file and App Store Connect). */
  subscriptionGroup: "Agathon Unlimited",
  /** The app's bundle id (APPLE_BUNDLE_ID overrides, for a fork). */
  bundleId: "app.agathon.Agathon",
  /** The introductory offer: a free week, as on the web. */
  trialDays: UNLIMITED_PLAN.trialDays,
} as const;

/** The routes the app and Apple call. */
export const APPLE_ROUTES = {
  /** POST, the app (Bearer user): a StoreKit 2 transaction, verified and recorded. */
  transaction: "/api/billing/apple/transaction",
  /** POST, Apple: App Store Server Notifications V2 (`{ signedPayload }`). */
  notifications: "/api/billing/apple/notifications",
} as const;

/**
 * Where a grown-up manages or cancels an Apple subscription from an email: Apple's own page, which
 * opens the subscriptions list on an iPad or iPhone (and the App Store's account page elsewhere).
 */
export const APPLE_MANAGE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

/** How the emails tell a grown-up to cancel an Apple subscription, in words (Apple renamed "Apple ID" to "Apple Account" in iPadOS 18; the path by name works on every version). */
export const APPLE_CANCEL_STEPS = "open Settings on your iPad, tap your name, then Subscriptions, and choose Agathon";

/** A compact JWS: three base64url parts. StoreKit's are a few KB (the x5c chain is most of it). */
const JWS = z
  .string()
  .min(20)
  .max(32_000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/, "a compact JWS");

/**
 * POST /api/billing/apple/transaction: `Transaction.jwsRepresentation` (a VerificationResult's) and,
 * when the app has it, the subscription's renewal info (`Product.SubscriptionInfo.Status`'s
 * `renewalInfo.jwsRepresentation`), which says whether it will renew (auto-renew off = set to cancel)
 * and whether a charge is failing.
 */
export const AppleTransactionBodySchema = z
  .object({
    transaction: JWS,
    renewalInfo: JWS.optional(),
  })
  .strict();
export type AppleTransactionBody = z.infer<typeof AppleTransactionBodySchema>;

/** POST /api/billing/apple/notifications: what Apple sends. */
export const AppleNotificationBodySchema = z.object({ signedPayload: JWS });

/** The transaction route's 200: what was recorded, and the plan as the server now sees it. */
export type AppleTransactionResult = {
  recorded: true;
  /** false when an older state arrived after a newer one (nothing changed; still finish it) */
  applied: boolean;
  /** the subscription's status in unlimited_subscriptions (Stripe's vocabulary) */
  status: string | null;
  /** has_unlimited() for the family the subscription belongs to */
  unlimited: boolean;
};

/**
 * Refusals the app acts on (HTTP 409 `invalid_request` with this `reason`). The app finishes the
 * transaction either way (it is delivered; another account's plan is theirs), and tells the grown-up.
 */
export const APPLE_REFUSALS = {
  /** the purchase was made from another Agathon account (its appAccountToken is theirs) */
  accountMismatch: "apple_account_mismatch",
  /** the purchase's account no longer exists (or the token is no account's) */
  accountUnknown: "apple_account_unknown",
  /** the subscription is already another family's (bought with no token, claimed first by them) */
  otherFamily: "apple_other_family",
} as const;
