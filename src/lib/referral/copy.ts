/**
 * Referrals' words, beyond the contract's title and pitch (src/lib/referral/contracts.ts
 * REFERRAL_COPY): the grown-up's card on /family and /account, the invitation a friend sees on the
 * sign-up page, and the admin console's Referrals page. Kept here so every sentence is in one place
 * and the tests read the same strings the pages show.
 *
 * The friend's free month is a Stripe Payment Link the owner may not have made yet
 * (NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK): without it, nothing here promises the friend a free month.
 * The referrer's month is a credit of one month's price, read from UNLIMITED_PLAN.monthlyUsd so a
 * price change is one edit.
 */
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";

/** The referrer's free month, as the credit the admin applies in Stripe: "$25". */
const MONTH_CREDIT = `$${UNLIMITED_PLAN.monthlyUsd}`;

/** The grown-up's "Give a month, get a month" card. */
export const REFERRAL_CARD_COPY = {
  /** the pitch when the friend's free month is NOT on offer (no referral Payment Link yet) */
  pitchNoFriendOffer: "Share Agathon with another family. When they join and their plan starts, you get a free month.",
  linkLabel: "Your invite link",
  copy: "Copy link",
  copied: "Copied",
  copyFailed: "Couldn't copy. Select the link and copy it.",
  share: "Share",
  /** navigator.share's title and text; the link is passed separately */
  shareTitle: "Agathon",
  shareText: "We use Agathon for math practice at home. Here's our invite:",
  shareTextWithOffer: "We use Agathon for math practice at home. Your first month is free with our invite:",
  friendsJoined: (n: number) => (n === 1 ? "1 friend joined" : `${n} friends joined`),
  monthsEarned: (n: number) => (n === 1 ? "1 free month earned" : `${n} free months earned`),
  monthsPending: (n: number) => (n === 1 ? "1 free month on its way" : `${n} free months on their way`),
  nobodyYet: "Nobody has joined with your link yet.",
  /** under the counts: when the referrer's month arrives */
  howItWorks: "Your free month is added to your plan after their first payment goes through.",
  statFriends: "Friends joined",
  statMonths: "Free months earned",
  loading: "Loading your invite link",
} as const;

/** What a friend who arrived through an invite link sees on the sign-up page. */
export const REFERRAL_INVITE_COPY = {
  title: "A friend invited you to Agathon",
  /** only when the friend's free-month Payment Link is set */
  freeMonth: "Your first month is free.",
} as const;

/** The admin console's Referrals page. */
export const REFERRAL_ADMIN_COPY = {
  title: "Referrals",
  hint: "Give a month, get a month: who invited whom, and the free months the referrers are due.",
  loadWhat: "the referrals",
  /** the list's own heading, under the page's title */
  listTitle: "Who invited whom",
  caption: "Referrals, newest first",
  filterLabel: "Show",
  filters: {
    due: "Reward due",
    all: "All",
    trial: "Signed up or trialing",
    rewarded: "Rewarded",
    void: "Void",
  },
  columns: {
    referrer: "Referrer",
    friend: "Friend",
    status: "Status",
    joined: "Joined",
    paid: "First paid",
    actions: "",
  },
  statuses: {
    signed_up: "Signed up",
    trialing: "Trialing",
    paid: "Paid: reward due",
    rewarded: "Rewarded",
    void: "Void",
  },
  tiles: {
    due: "Rewards due",
    dueHint: "Paid, not yet credited",
    trialing: "In a trial",
    trialingHint: "Friends trying it now",
    rewarded: "Rewarded",
    rewardedHint: "Free months given",
    signedUp: "Signed up",
    signedUpHint: "Every referral, less voided",
  },
  /** the note above the list: check the friend paid, then the credit, then the mark */
  rewardNoteTitle: "Before you mark a referral rewarded",
  rewardNote: `First open the friend's subscription in Stripe and check that its first real invoice (not the $0 trial one) says Paid. Then apply a ${MONTH_CREDIT} credit to the referrer's Stripe customer (Stripe → Customers → Adjust balance). Mark rewarded only records that you did.`,
  markRewarded: "Mark rewarded",
  void: "Void",
  rewardTitle: "Mark this referral rewarded?",
  rewardBody: (email: string) =>
    `Check in Stripe that the friend's first real invoice (not the $0 trial one) says Paid, then apply a ${MONTH_CREDIT} credit to ${email}'s Stripe customer (Stripe → Customers → Adjust balance). This only records that the free month was given.`,
  rewardConfirm: "I applied the credit: mark rewarded",
  voidTitle: "Void this referral?",
  voidBody: "Use this for abuse: a friend who is really the same family, or a fake account. A voided referral earns nothing and cannot be undone.",
  voidConfirm: "Void referral",
  cancel: "Cancel",
  rewarded: "Marked rewarded",
  voided: "Referral voided",
  customer: "Stripe customer",
  noCustomer: "No Stripe customer yet",
  payer: (email: string) => `Paid as ${email}`,
  /** the friend's plan under their address, in Stripe's terms */
  friendPlan: (words: string) => `Plan ${words}`,
  noPlan: "No plan yet",
  planWords: {
    trialing: "in its free trial",
    active: "active",
    past_due: "past due: a charge is failing",
    unpaid: "unpaid: a charge failed",
    canceled: "canceled",
    incomplete: "waiting on its first payment",
    incomplete_expired: "never started",
    paused: "paused",
  },
  /** where "Mark rewarded" would be, while a paid referral cannot be rewarded yet */
  rewardFrom: (day: string) => `Reward from ${day}`,
  rewardSettling: "Reward once the first payment settles",
  rewardPlanNotActive: "No reward while the plan is not active",
  samePerson: "Looks like the same person",
  samePersonHint: "The two addresses match once dots and +tags are ignored. Check before rewarding.",
  rewardedBy: (who: string, when: string) => `Rewarded ${when} by ${who}`,
  rewardedWhen: (when: string) => `Rewarded ${when}`,
  noEmail: "account deleted",
  emptyTitle: "No referrals yet",
  emptyHint: "When a family signs up with someone's invite link, it shows here.",
  emptyFilterTitle: "Nothing here",
  emptyFilterHint: "No referral is in this state.",
  truncated: (n: number) => `Showing the newest ${n}.`,
  actionFailed: (message: string) => `Couldn't save: ${message}`,
} as const;
