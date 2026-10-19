/**
 * An Apple subscription's state in unlimited_subscriptions' vocabulary (Stripe's statuses, which
 * has_unlimited(), the emails and the admin read), from what the App Store signed: a transaction,
 * its renewal info when we have it, and a notification's `data.status` and type. Pure.
 *
 *   App Store                                   row
 *   ------------------------------------------  -----------------------------------------------
 *   active, in the introductory free trial      trialing   trial_end = current_period_end = expiresDate
 *   active                                      active     current_period_end = expiresDate
 *   billing retry (3)                           past_due   help spends ink until a retry is paid (the
 *   billing grace period (4)                    past_due   web's rule: "the plan is paid for, or it is
 *                                                          not"; grace period is off in App Store Connect)
 *   expired (2)                                 canceled   ended_at = expiresDate
 *   revoked (5), or a revocationDate (refund)   canceled   ended_at = canceled_at = revocationDate
 *   auto-renew off (renewal info, or a          cancel_at_period_end = true (still Unlimited until
 *     DID_CHANGE_RENEWAL_STATUS notification)  the period ends, as a Stripe plan set to cancel)
 *
 * `data.status` (App Store Server Notifications V2) is the App Store's own answer and wins. Without
 * it (a transaction the app posted), the state is read from the transaction's dates and the renewal
 * info at `now`. `eventAt` is the App Store's signedDate: the as-of time that orders states in the
 * database (an older payload never overwrites a newer one).
 */
import {
  AutoRenewStatus,
  InAppOwnershipType,
  OfferDiscountType,
  OfferType,
  Status,
  Type,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import type { SubscriptionStatus } from "@/lib/server/billingWebhook";

export type AppleSubscriptionState = {
  originalTransactionId: string;
  environment: string;
  productId: string;
  transactionId: string | null;
  status: SubscriptionStatus;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  /** null: this payload does not say (a transaction without its renewal info); the row keeps its value */
  cancelAtPeriodEnd: boolean | null;
  canceledAt: string | null;
  endedAt: string | null;
  /** the buyer's checkout_ref, lower-cased; null when the purchase carried none */
  appAccountToken: string | null;
  /** what Apple will charge next (renewalPrice), else what was last paid; milliunits of `currency` */
  priceMilliunits: number | null;
  currency: string | null;
  /** the App Store's signedDate (ISO): orders states */
  eventAt: string;
};

export type AppleStateInput = {
  transaction: JWSTransactionDecodedPayload;
  renewalInfo?: JWSRenewalInfoDecodedPayload | null;
  /** a notification's data.status (1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked) */
  status?: number | null;
  notificationType?: string | null;
  subtype?: string | null;
  /** the as-of time (ms): the notification's signedDate, else the transaction's */
  signedDate?: number | null;
  /** the product this app sells */
  productId: string;
  now: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OTID_RE = /^[0-9A-Za-z._-]{1,64}$/;

const iso = (ms: number | null | undefined): string | null => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/** The transaction is in the introductory free trial (not a paid introductory price). */
export function isFreeTrial(t: Pick<JWSTransactionDecodedPayload, "offerType" | "offerDiscountType">): boolean {
  if (t.offerType !== OfferType.INTRODUCTORY_OFFER) return false;
  // Older payloads (and some Xcode ones) carry no offerDiscountType: an intro offer here is the free week.
  return t.offerDiscountType === undefined || t.offerDiscountType === OfferDiscountType.FREE_TRIAL;
}

/**
 * Pure: the state to record, or why the payload is not this plan's (another product, not a
 * subscription, a family-shared copy, no original transaction id).
 */
export function appleStateOf(input: AppleStateInput): AppleSubscriptionState | { ignore: string } {
  const t = input.transaction;
  const r = input.renewalInfo ?? null;
  if (t.type !== undefined && t.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION) return { ignore: `not an auto-renewable subscription (${t.type})` };
  if (t.productId !== input.productId) return { ignore: `another product (${t.productId ?? "none"})` };
  // Family Sharing is off for the plan; a shared copy must not become a second family's plan.
  if (t.inAppOwnershipType === InAppOwnershipType.FAMILY_SHARED) return { ignore: "a family-shared copy of someone else's purchase" };
  const otid = t.originalTransactionId;
  if (!otid || !OTID_RE.test(otid)) return { ignore: "no original transaction id" };
  if (r?.originalTransactionId && r.originalTransactionId !== otid) return { ignore: "renewal info for another subscription" };

  const expires = typeof t.expiresDate === "number" ? t.expiresDate : null;
  const revokedAt = typeof t.revocationDate === "number" ? t.revocationDate : null;
  const asOf = input.signedDate ?? t.signedDate ?? input.now;
  const trial = isFreeTrial(t);

  let status: SubscriptionStatus;
  let endedAt: string | null = null;
  let canceledAt: string | null = null;
  const type = input.notificationType ?? null;

  if (revokedAt !== null || input.status === Status.REVOKED || type === "REFUND" || type === "REVOKE") {
    status = "canceled";
    endedAt = iso(revokedAt ?? asOf);
    canceledAt = endedAt;
  } else if (input.status === Status.BILLING_RETRY || input.status === Status.BILLING_GRACE_PERIOD) {
    status = "past_due";
  } else if (input.status === Status.EXPIRED) {
    status = "canceled";
    endedAt = iso(expires ?? asOf);
  } else if (input.status === Status.ACTIVE) {
    status = trial ? "trialing" : "active";
  } else if (type === "EXPIRED") {
    status = "canceled";
    endedAt = iso(expires ?? asOf);
  } else if (type === "DID_FAIL_TO_RENEW" || type === "GRACE_PERIOD_EXPIRED") {
    status = "past_due";
  } else if (r?.isInBillingRetryPeriod === true || (typeof r?.gracePeriodExpiresDate === "number" && r.gracePeriodExpiresDate > input.now)) {
    status = "past_due";
  } else if (expires !== null && expires > input.now) {
    status = trial ? "trialing" : "active";
  } else {
    status = "canceled";
    endedAt = iso(expires ?? asOf);
  }

  let cancelAtPeriodEnd: boolean | null = null;
  if (r && typeof r.autoRenewStatus === "number") cancelAtPeriodEnd = r.autoRenewStatus === AutoRenewStatus.OFF;
  else if (type === "DID_CHANGE_RENEWAL_STATUS") cancelAtPeriodEnd = input.subtype === "AUTO_RENEW_DISABLED";

  const renewalPrice = typeof r?.renewalPrice === "number" && r.renewalPrice >= 0 ? r.renewalPrice : null;
  const paidPrice = typeof t.price === "number" && t.price > 0 ? t.price : null;
  const priceMilliunits = renewalPrice ?? paidPrice;
  const currencyRaw = renewalPrice !== null ? r?.currency : t.currency;
  const currency = priceMilliunits !== null && typeof currencyRaw === "string" && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : null;

  const token = typeof t.appAccountToken === "string" && UUID_RE.test(t.appAccountToken) ? t.appAccountToken.toLowerCase() : null;

  return {
    originalTransactionId: otid,
    environment: String(t.environment ?? ""),
    productId: t.productId!,
    transactionId: typeof t.transactionId === "string" && OTID_RE.test(t.transactionId) ? t.transactionId : null,
    status,
    trialEnd: trial ? iso(expires) : null,
    currentPeriodEnd: iso(expires),
    cancelAtPeriodEnd,
    canceledAt,
    endedAt,
    appAccountToken: token,
    priceMilliunits: currency ? priceMilliunits : null,
    currency,
    eventAt: iso(asOf) ?? new Date(input.now).toISOString(),
  };
}
