# Billing runbook (ink packs on Stripe)

How ink works in operation, how to change packs and prices, how to give or take back ink by hand,
what a refund does, how to go live, and what to do when a payment does not turn into ink. Design:
`docs/ARCHITECTURE.md` "Billing". Schema: `supabase/migrations/20261002000000_ink.sql` (its header
is the reference for every table, trigger and function named here).

## 1. How it fits together

- **Ink is the unit.** 1 ink = 1 of the old monthly credits, and the per-action prices are unchanged
  (`ROUTE_COSTS` in `src/lib/server/billing.ts`: reading a line 1, checking 3, a worked solution 10,
  a word-problem setup 2, a board-chat request 3, lecture mode 2 a minute and 4 a drawing). Drawing
  on your own is always free.
- **Ink never expires and never resets.** A new account gets **300 starter ink once**, at sign-up
  (`handle_new_user()`; a failure never blocks sign-up, and the first summary or AI action grants a
  missing starter). Beta accounts that existed when the migration ran got one starter of
  `max(300, what they had left that month)`. There is no monthly refill.
- **Packs** (`public.ink_packs`, one-time payments, USD):

  | Pack | Ink | Price | Ink per $1 |
  | --- | --- | --- | --- |
  | `small` | 1,000 | $5 | 200 |
  | `medium` | 5,000 | $20 | 250 (+25 %) |
  | `large` | 14,000 | $50 | 280 (+40 %) |

  They live in two places that must agree: `public.ink_packs` (what the app shows and grants) and
  `PACKS` at the top of `scripts/stripe-setup.mjs` (what Stripe charges).
  `src/__tests__/stripeSetup.test.ts` fails when they differ.
- **The balance** is all ink granted (`ink_grants`: starter, purchases, manual grants, refund
  reversals) minus all ink used (`usage_events`), stored in `profiles.ink_balance` (CHECK `>= 0`) and
  kept by triggers in the same transaction as each ledger row. `consume_credits()` (the paid routes,
  as the user) locks the profile row, refuses with nothing written when the balance is short, and
  the route answers `402 ink_empty`. The ledgers are append-only: fix a mistake with a new row.
- **Checkout** is a Stripe Payment Link per pack, in payment mode. The app opens it with
  `client_reference_id=<user id>` and `prefilled_email=<email>`: from the board in a **new tab** (the
  board stays as it is; the meter and the dialog pick the ink up when it lands), from `/account` in
  the same tab. After paying, Stripe redirects to `<site>/account?ink=<pack>`, where the page says
  "Adding your Medium pack…" until the webhook lands, then "Ink added".
- **The webhook** (`POST /api/billing/webhook`, `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`):
  - `checkout.session.completed` with `mode: payment` and `payment_status: paid` (or
    `checkout.session.async_payment_succeeded` for a delayed method) grants the pack: the session's
    `metadata.pack_id` (copied from the Payment Link), else `INK_PRICE_MAP`, to the user in
    `client_reference_id`, via `grant_ink_purchase()`. One grant per Checkout Session id, ever.
  - `charge.refunded` takes the refunded share of that purchase's ink back via
    `reverse_ink_purchase()`, at most what is still unspent (section 5).
  - Every event it acts on is recorded in `billing_events` first; a duplicate answers
    `200 { received: true, duplicate: true }`. A failure a retry could fix answers 500 and forgets
    the event id, so Stripe redelivers it.
- **Stripe objects** carry `metadata.app = agathon-classroom`. `scripts/stripe-setup.mjs` finds them
  that way and never writes to anything else on the account (section 2).
- **Env:** `NEXT_PUBLIC_BILLING_LINKS` = `{"small": url, "medium": url, "large": url}` (public; without
  it every buy button says "Coming soon" and everything else works), `INK_PRICE_MAP` =
  `{"price_…": "small", …}` (the webhook's fallback), `STRIPE_WEBHOOK_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`. `BILLING_PRICE_MAP` (plans) is no longer read; remove it from Vercel.

## 2. Shared Stripe account (Fuime)

Agathon's packs run on the owner's existing Stripe account, which also runs **Fuime**, a live
merchant-of-record app. The rule is that Agathon never interferes with Fuime and ignores its traffic.

- **Fuime acts only on its own tags.** Its handlers (`app/services/fuime/payment_webhook_handler.rb`,
  `missed_mor_payment_sweep.rb`, `subscription_webhook_handler.rb` in the Fuime repo) act only on
  objects whose metadata carries `fuime_event_id` or `fuime_subscription_kind`, or on refunds and
  disputes of payment intents it recorded itself. Its sweep lists every succeeded PaymentIntent on
  the account and skips any without `fuime_event_id`. So Fuime ignores Agathon's payments as long as
  **no Agathon object ever carries a `fuime_*` metadata key**. The setup script's write guard refuses
  one, and `stripeSetup.test.ts` asserts that no body it sends has one.
- **Everything Agathon makes is tagged** `metadata.app = "agathon-classroom"`: products, prices,
  Payment Links, the webhook endpoint, and, through `payment_intent_data.metadata` on each Payment
  Link (`app`, `pack_id`), every PaymentIntent and charge. Card statements carry the suffix
  `AGATHON` (`payment_intent_data.statement_descriptor_suffix`) after the account's descriptor.
- **The webhook ignores Fuime's events of the same types** before writing anything. A Checkout
  Session is Agathon's only with `metadata.app = agathon-classroom` (plus a user id and a pack); a
  refund only when its charge carries the tag or its payment intent is an ink purchase we recorded
  (a read). Anything else answers `200 { received: true, ignored: true }` and leaves **no row at all**,
  not even in `billing_events` (Fuime's payloads hold its buyers' names, emails and addresses).
- **The setup script writes only to tagged objects it found or made**, never to account-level
  settings (branding, business profile, the default customer-portal configuration, payouts, tax).
  It has to *list* products, links and endpoints (Stripe's list endpoints cannot filter by
  metadata), but a guard throws before any write to an untagged object, any create without the tag,
  or any `fuime_*` key. When it retires the old Plus/Pro objects it deactivates only our tagged
  Payment Links, prices and products and our tagged portal configuration; the test-mode portal
  configuration it made in September is the account's default, which Stripe will not deactivate, so
  it is left as it is (it lists only archived plans).
- **Money is shared.** Payouts and the balance are one pool with Fuime. Agathon's revenue is
  filterable in the Dashboard by product ("Agathon … ink pack") or by `metadata.app`.
- **Branding is shared.** Checkout, receipts and statements show the account's public name and
  branding ("Fuime"); see section 7.

## 3. The setup script

```bash
node scripts/stripe-setup.mjs [--mode test|live] [--site <url>] [--dry-run] [--secret-file <path>]
```

It talks to Stripe only through the Stripe CLI (`stripe get|post … [--live]`), using the account the
CLI is logged in to, and never reads, stores or prints an API key. It is idempotent: a second run
creates nothing and only updates what differs. Per pack it makes:

- a product (`Agathon Medium ink pack`) and a **one-time** price;
- a Payment Link in payment mode, quantity fixed at 1, `metadata { app, pack_id, price_id }`,
  `payment_intent_data { metadata { app, pack_id }, statement_descriptor_suffix: AGATHON }`, that
  redirects to `<site>/account?ink=<pack>`.

It also retires its own Plus/Pro objects (section 2) and, for a site that is not localhost, makes a
webhook endpoint for `<site>/api/billing/webhook` listening to exactly `checkout.session.completed`,
`checkout.session.async_payment_succeeded` and `charge.refunded` (an existing endpoint of ours is
narrowed to those). A new endpoint's signing secret is written to
`~/.config/agathon-classroom/stripe-webhook-secret-<mode>` (mode 600) and never printed.

It prints the values to set: `NEXT_PUBLIC_BILLING_LINKS` and `INK_PRICE_MAP`.

**Dry run, test mode, 2026-10-02** (`--mode test --site https://whiteboard.rushilchopra.com --dry-run`,
read-only): it would create the three products, prices and links; deactivate
`plink_1UKhFS2Uz4P3wrXOAGg8YW0Z` (Pro) and `plink_1UKhFQ2Uz4P3wrXOZy1YVtIV` (Plus); archive
`prod_VLO1tDN1Jinw3b` and `prod_VLO1PGefEep16C` with their prices; leave portal configuration
`bpc_1UKhFb2Uz4P3wrXOenlorpyo` (the test-mode default); and create the endpoint for the three
events. No test or live objects have been created for ink yet.

### Changing a price or a pack

1. Edit `PACKS` in `scripts/stripe-setup.mjs` **and** the `ink_packs` seed in a new migration (or an
   `update public.ink_packs …` plus the seed, so the next migration run does not revert it). The
   test fails until they agree.
2. Run the script (dry run first). For a changed amount it creates a new price and Payment Link,
   archives the old price, deactivates the old link, and prints new `NEXT_PUBLIC_BILLING_LINKS` /
   `INK_PRICE_MAP` (archived prices stay in the map).
3. Update both Vercel variables and redeploy: the links are built into the client bundle.

A purchase always grants the pack's ink as the database knew it when the webhook landed
(`ink_purchases.ink` keeps that number). To stop selling a pack, set `active = false` on its row and
drop its link from `NEXT_PUBLIC_BILLING_LINKS`; old purchases keep its name.

## 4. Trying it locally (test mode)

```bash
# 1. Webhooks to the dev server. The secret goes into a variable, never onto the screen.
export STRIPE_WEBHOOK_SECRET="$(stripe listen --print-secret)"
stripe listen --forward-to localhost:3000/api/billing/webhook &

# 2. Test-mode objects (once), then the dev server with the printed values
node scripts/stripe-setup.mjs --mode test --site http://localhost:3000
NEXT_PUBLIC_BILLING_LINKS='…' INK_PRICE_MAP='…' npx next dev -p 3000
```

Pay with card `4242 4242 4242 4242`, any future date, any CVC and ZIP. `stripe listen` forwards every
event on the account (Fuime's test traffic too); the webhook ignores what is not Agathon's.

Without Stripe at all, sign a fake event with the same scheme as `src/lib/server/webhookSignature.ts`
(`Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`) and POST it; the event's
`data.object` needs `metadata.app = "agathon-classroom"`, `mode: "payment"`,
`payment_status: "paid"`, `client_reference_id` and `metadata.pack_id`.

## 5. Refunds

Refund in the Dashboard (*Payments → the payment → Refund*). Stripe sends `charge.refunded` with the
charge's **cumulative** refunded amount; `reverse_ink_purchase()` acts only on its growth, so replays
and later partial refunds never double up:

- the ink to take back is the refunded share of the pack (a full refund: all of it; half the money:
  half the ink), minus what earlier refund events already asked for;
- it takes **at most the current balance**: ink the student already spent stays spent, and the
  balance never goes below zero;
- `ink_purchases` records it: `status` (`refunded` / `partially_refunded`), `refunded_cents`,
  `refunded_ink` (taken back) and `refund_unrecovered_ink` (asked for, already spent). The student
  sees "Refunded: 3,800 ink taken back; 1,200 had already been used" in their purchase history.

```sql
-- refunds and what they did
select p.created_at, u.email, p.pack_id, p.ink, p.amount_cents, p.status, p.refunded_ink, p.refund_unrecovered_ink
from public.ink_purchases p join auth.users u on u.id = p.user_id
where p.status <> 'paid' order by p.refunded_at desc;
```

Disputes (chargebacks) are not handled automatically. If one is lost, take the ink back by hand
(section 6) and note the dispute id in the reason.

## 6. By hand (SQL editor, as `postgres`)

```sql
-- what a student has
select public.ink_summary_of((select id from auth.users where email = 'student@example.com'));

-- give ink (an apology, a pilot, a payment the webhook missed)
select public.grant_ink((select id from auth.users where email = 'student@example.com'), 500, 'outage apology 2026-10-05');

-- take ink back (stops at zero; `granted` in the answer says how much actually moved)
select public.grant_ink((select id from auth.users where email = 'student@example.com'), -500, 'duplicate grant');

-- a paid checkout the webhook could not match (opened outside the app, so no client_reference_id):
-- record it as a purchase so a later refund finds it (one row per Checkout Session, ever)
select public.grant_ink_purchase(
  (select id from auth.users where email = 'student@example.com'),
  'medium', 'cs_live_…', 'pi_…', 'cus_…', 2000, 'usd');

-- the ledger
select kind, units, reason, created_at from public.ink_grants
where user_id = (select id from auth.users where email = 'student@example.com') order by created_at;
```

Never `update` or `delete` ledger rows: a trigger refuses edits to `units`/`user_id`, and a deleted
grant would leave the balance as it was. Corrections are new rows. A raw
`insert into public.ink_grants` works (the trigger keeps the balance), but one that would take the
balance below zero fails with `23514`.

## 7. Going live

The owner's steps, in order:

1. **Stripe access.** Give the live restricted key write permission (Products, Prices, Payment
   Links, Webhook Endpoints; read on the account) or run `stripe login` for the live account.
2. **Check what the customer will see** (*Settings → Business → Public details*, *Settings →
   Branding*): Checkout, receipts and card statements show the account's name ("Fuime") and
   branding, with `AGATHON` as the statement suffix. Changing them affects Fuime's customers too.
   Turn on receipt emails for successful payments and refunds (*Settings → Customer emails*).
   Decide on tax (the Payment Links do not collect tax).
3. **Create the live objects:**

   ```bash
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run   # read-only preview
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com
   ```

   It prints `NEXT_PUBLIC_BILLING_LINKS` and `INK_PRICE_MAP` and writes the endpoint's signing
   secret to `~/.config/agathon-classroom/stripe-webhook-secret-live`.
4. **Set the Vercel Production env vars** (project `whiteboardstaging`, team `rushmore`):

   ```bash
   vercel env add NEXT_PUBLIC_BILLING_LINKS production   # paste the printed JSON
   vercel env add INK_PRICE_MAP production               # paste the printed JSON
   vercel env add STRIPE_WEBHOOK_SECRET production --sensitive < ~/.config/agathon-classroom/stripe-webhook-secret-live
   vercel env rm BILLING_PRICE_MAP production            # if it exists: plans are gone
   ```

   `SUPABASE_SERVICE_ROLE_KEY` is already in Production (the Supabase Marketplace integration).
5. **Apply the migration** `20261002000000_ink.sql` to the production database (the Marketplace
   project; see the note at the top of `RUNBOOK-supabase.md`):
   `npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all`, then
   `node scripts/verify-rls.mjs` against production. On the way in it gives every existing account
   one starter of `max(300, what it had left this month)`, deactivates Plus/Pro and moves everyone to
   `free`. Apply it right before the deploy: the old app keeps working on the new schema, but shows
   "0 credits a month".
6. **Redeploy** production (merge to `main`, or `vercel --prod`). The `NEXT_PUBLIC_*` values are
   built into the client bundle, so a deploy that predates them keeps showing "Coming soon".
7. **A real purchase and refund** on https://whiteboard.rushilchopra.com:
   1. Sign in, open a board, tap the ink meter, buy the Small pack (a new tab opens). Pay.
   2. Back on the board tab the meter should read +1,000 within seconds; the other tab ends on
      `/account?ink=small` saying "Ink added". In the Dashboard, *Developers → Webhooks → the
      endpoint* shows `checkout.session.completed` answered `200`.
   3. Refund the payment in the Dashboard. The `charge.refunded` delivery answers `200`; the
      purchase shows "Refunded" in `/account` and the ink is gone (or what was left of it).
   4. `select id, type, received_at from public.billing_events order by received_at desc limit 5;`
      shows only those two events: Fuime's traffic leaves no rows.

## 8. When something goes wrong

- **Paid, but no ink after a minute.**
  1. Look at the endpoint's deliveries in the Dashboard and at `billing_events`.
     - `503` means an env var is missing (`STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) or
       `INK_PRICE_MAP` is malformed; `400 bad signature` means the secret belongs to another
       endpoint or mode; `500` with "names a pack that is not in ink_packs" means the migration is
       missing or a pack was removed (fix it; Stripe retries for 3 days).
     - `200 ignored` for a session that is ours: it had no `client_reference_id` (the Payment Link
       was opened outside the app) or no pack. The Vercel log line `Agathon event ignored` says
       which. Grant it by hand with `grant_ink_purchase` (section 6).
  2. `ink purchase for a deleted account` in the logs: the account was deleted between paying and
     the webhook. Refund the payment.
- **The meter did not move after buying.** It re-reads on focus, on returning to the tab, every 3 s
  for ten minutes after a buy button, and when another tab saw the ink arrive. A reload settles it.
- **A student is out of ink mid-lesson.** Give some by hand (section 6); the meter picks it up the
  next time the tab is focused.
- **Two purchases for one checkout.** Impossible by construction (unique Checkout Session id);
  check `ink_purchases` before granting by hand.

## 9. What the no-secret design cannot do

These are the limits of Payment Links with no server-side Stripe key. Each could be lifted by a
small server route with a restricted key (Checkout Sessions: write).

- **A Payment Link opened outside the app cannot be matched to a user.** A server-created Checkout
  Session always carries the user. Today such a payment is logged and granted by hand.
- **No per-user receipt list in the app beyond our own purchase rows.** Stripe's receipts go by
  email.
