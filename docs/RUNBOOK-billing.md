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
  the route answers `402 ink_empty`. The ledgers are append-only: fix a mistake with a new row
  (section 6).
- **Failed calls are refunded by the server.** When a paid route's provider call fails after the
  charge, the route gives the ink back with `refund_ink_for(user, request id)`, using the **service
  role** (`SUPABASE_SERVICE_ROLE_KEY`). A user cannot refund anything: the old user-callable
  `refund_credits` would have let anyone refund their successful calls too (every response carries
  its request id). So every deployment that meters ink needs the service role key, or failed calls
  keep their charge (the log says `SUPABASE_SERVICE_ROLE_KEY is not set, so failed calls cannot be
  refunded`).
- **Checkout** is a Stripe Payment Link per pack, in payment mode, with promotion codes off. The app
  opens it with `client_reference_id=<user id>` and `prefilled_email=<email>`: from the board in a
  **new tab** (the board stays as it is; the meter and the dialog pick the ink up when it lands),
  from `/account` in the same tab. After paying, Stripe redirects to `<site>/account?ink=<pack>`,
  where the page says "Adding your Medium pack…" until the webhook lands, then "Ink added".
- **The webhook** (`POST /api/billing/webhook`, `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`):
  - It first refuses an event from the wrong Stripe mode (`400 livemode mismatch`, see
    `STRIPE_LIVEMODE` below), then ignores anything that is not Agathon's (section 2).
  - `checkout.session.completed` with `mode: payment` and `payment_status: paid` (or
    `checkout.session.async_payment_succeeded` for a delayed method) grants the pack: the session's
    `metadata.pack_id` (copied from the Payment Link), else `INK_PRICE_MAP`, to the user in
    `client_reference_id`, via `grant_ink_purchase()`. One grant per Checkout Session id, ever, and
    only when **the amount paid covers the pack**: the session's `amount_total` in USD (under
    Adaptive Pricing, the `currency_conversion` source amount, which is in USD) must be at least the
    pack's price.
  - An Agathon checkout that cannot become ink (not paid, `no_payment_required` included; no or a
    bad `client_reference_id`; no pack; underpaid or not USD; the account deleted before the
    webhook) is recorded in **`ink_checkout_reviews`** with no ink, the delivery answers `200`, and
    the log says `Agathon checkout NOT granted` at `warn`. The owner resolves it (section 6).
  - `charge.refunded` takes the refunded share of that purchase's ink back via
    `reverse_ink_purchase()`, at most what is still unspent (section 5). A refund that overtook its
    checkout answers `500` so Stripe retries it after the grant.
  - Every Agathon event is logged in `billing_events`. Every step is idempotent, so a redelivered
    event is simply applied again (a duplicate answers `200 { received: true, duplicate: true }`),
    and a failure a retry could fix answers `500` so Stripe redelivers.
- **Stripe objects** carry `metadata.app = agathon-classroom`. `scripts/stripe-setup.mjs` finds them
  that way and never writes to anything else on the account (section 2).
- **Env:**
  - `NEXT_PUBLIC_BILLING_LINKS` = `{"small": url, "medium": url, "large": url}` (public; without it
    every buy button says "Coming soon" and everything else works);
  - `INK_PRICE_MAP` = `{"price_…": "small", …}` (the webhook's fallback when a session has no
    `metadata.pack_id`);
  - `STRIPE_WEBHOOK_SECRET`;
  - `STRIPE_LIVEMODE`: `true` in production (live events only), `false` on a deployment wired to a
    test-mode endpoint. Unset, a deployment accepts live events only and a localhost dev server
    accepts either;
  - `SUPABASE_SERVICE_ROLE_KEY` (the webhook, and refunds of failed calls everywhere ink is metered).

  `BILLING_PRICE_MAP` (plans) is no longer read; remove it from Vercel.

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
  Session is Agathon's only with `metadata.app = agathon-classroom`; a refund only when its charge
  carries the tag or its payment intent is an ink purchase or review we recorded (a read). Anything
  else answers `200 { received: true, ignored: true }` and leaves **no row at all**, not even in
  `billing_events` (Fuime's payloads hold its buyers' names, emails and addresses). `main` before
  the ink work stored every payload it received, which is why the live endpoint is made only after
  this code is deployed (section 7).
- **The setup script writes only to tagged objects it found or made**, never to account-level
  settings (branding, business profile, the default customer-portal configuration, payouts, tax).
  It has to *list* products, links and endpoints (Stripe's list endpoints cannot filter by
  metadata; it pages through all of them), but a guard throws before any write to an untagged
  object, any create without the tag, or any `fuime_*` key. When it retires the old Plus/Pro objects
  it deactivates only our tagged Payment Links, prices and products and our tagged portal
  configuration; the test-mode portal configuration it made in September is the account's default,
  which Stripe will not deactivate, so it is left as it is (it lists only archived plans).
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
- a Payment Link in payment mode, quantity fixed at 1, promotion codes off
  (`allow_promotion_codes: false`), `metadata { app, pack_id, price_id }`,
  `payment_intent_data { metadata { app, pack_id }, statement_descriptor_suffix: AGATHON }`, that
  redirects to `<site>/account?ink=<pack>`.

It also retires its own Plus/Pro objects (section 2) and, for a site that is not localhost, makes a
webhook endpoint for `<site>/api/billing/webhook` listening to exactly `checkout.session.completed`,
`checkout.session.async_payment_succeeded` and `charge.refunded` (an existing endpoint of ours is
narrowed to those). A new endpoint's signing secret is written to
`~/.config/agathon-classroom/stripe-webhook-secret-<mode>` (mode 600) and never printed.

It prints the values to set: `NEXT_PUBLIC_BILLING_LINKS` and `INK_PRICE_MAP`.

**Test mode never points at the production site.** `--mode test --site
https://whiteboard.rushilchopra.com` is refused (except with `--dry-run`, which writes nothing): it
would send test-mode events and test-mode Payment Links to the live app. Use test mode with
`http://localhost:3000` (section 4) or a preview deployment's URL with `STRIPE_LIVEMODE=false` set
on that deployment.

**Dry run, test mode, 2026-10-02** (read-only, `--dry-run`): it would create the three products,
prices and links; deactivate `plink_1UKhFS2Uz4P3wrXOAGg8YW0Z` (Pro) and
`plink_1UKhFQ2Uz4P3wrXOZy1YVtIV` (Plus); archive `prod_VLO1tDN1Jinw3b` and `prod_VLO1PGefEep16C`
with their prices; leave portal configuration `bpc_1UKhFb2Uz4P3wrXOenlorpyo` (the test-mode
default); and create the endpoint for the three events. No test or live objects have been created
for ink yet.

### Changing a price or a pack

1. Edit `PACKS` in `scripts/stripe-setup.mjs` **and** the `ink_packs` seed in a new migration (or an
   `update public.ink_packs …` plus the seed, so the next migration run does not revert it). The
   test fails until they agree.
2. Run the script (dry run first). For a changed amount it creates a new price and Payment Link,
   archives the old price, deactivates the old link, and prints new `NEXT_PUBLIC_BILLING_LINKS` /
   `INK_PRICE_MAP` (archived prices stay in the map).
3. Update both Vercel variables and redeploy: the links are built into the client bundle.

A purchase always grants the pack's ink as the database knew it when the webhook landed
(`ink_purchases.ink` keeps that number), and only if what was paid covers the pack's price **in the
database**: raise the price in Stripe and in `ink_packs` together, or checkouts paid at the old
price will land in the review queue. To stop selling a pack, set `active = false` on its row and drop
its link from `NEXT_PUBLIC_BILLING_LINKS`; old purchases keep its name.

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
event on the account (Fuime's test traffic too); the webhook ignores what is not Agathon's. On
localhost `STRIPE_LIVEMODE` can stay unset (test events are accepted there). The dev server needs
`SUPABASE_SERVICE_ROLE_KEY` (`npx supabase status -o env`) for the webhook and for refunds of failed
calls.

Without Stripe at all, sign a fake event with the same scheme as `src/lib/server/webhookSignature.ts`
(`Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`) and POST it; the event's
`data.object` needs `metadata.app = "agathon-classroom"`, `mode: "payment"`,
`payment_status: "paid"`, `client_reference_id`, `metadata.pack_id`, `amount_total` (at least the
pack's price, in cents) and `currency: "usd"`.

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

**A refund before its grant.** Stripe does not order deliveries: a quick refund's `charge.refunded`
can arrive before the checkout's `checkout.session.completed` has been processed. A refund that is
ours (its charge is tagged) but whose purchase is not recorded yet answers `500` ("refund arrived
before its ink purchase was recorded"), so Stripe retries it (with backoff, for up to three days in
live mode) and it applies once the grant has landed; the grant can never keep the refunded ink. If
the checkout itself never reaches the webhook (for example, it was paid before the endpoint
existed), the refund keeps failing: resolve the checkout by hand (section 6) and the next retry
applies, or answer it by hand in the Dashboard.

**A refund of a checkout in review** (no ink was granted) takes nothing back and marks the review
`refunded`.

Disputes (chargebacks) are not handled automatically. If one is lost, take the ink back by hand
(section 6) and note the dispute id in the reason.

## 6. By hand (SQL editor, as `postgres`)

```sql
-- what a student has
select public.ink_summary_of((select id from auth.users where email = 'student@example.com'));

-- give ink (an apology, a pilot)
select public.grant_ink((select id from auth.users where email = 'student@example.com'), 500, 'outage apology 2026-10-05');

-- take ink back (stops at zero; `granted` in the answer says how much actually moved)
select public.grant_ink((select id from auth.users where email = 'student@example.com'), -500, 'duplicate grant');

-- the ledger
select kind, units, reason, created_at from public.ink_grants
where user_id = (select id from auth.users where email = 'student@example.com') order by created_at;
```

### Checkouts waiting for review

Paid (or claimed paid) Agathon checkouts that did not become ink. Look at this list after any
`Agathon checkout NOT granted` log line, and before answering "I paid but got no ink":

```sql
select r.id, r.created_at, r.reason, r.checkout_session_id, r.payment_intent_id, r.pack_id,
       r.amount_cents, r.currency, r.customer_email, u.email as account_email
from public.ink_checkout_reviews r left join auth.users u on u.id = r.user_id
where r.status = 'open' order by r.created_at;
```

Then, for each one, check the payment in the Dashboard (search the session or payment intent id) and
do one of:

```sql
-- honour it: a real purchase for the review's account and pack (or the ones you name), so a later
-- refund takes the ink back like any other. Once per review.
select public.resolve_ink_checkout_review(42);
select public.resolve_ink_checkout_review(42,
  p_user_id => (select id from auth.users where email = 'student@example.com'),  -- opened outside the app
  p_pack_id => 'medium',
  p_note    => 'emailed 2026-10-06, paid from a forwarded link');

-- refund it in the Dashboard instead: the webhook marks it `refunded` by itself. Or close it with a note:
update public.ink_checkout_reviews set status = 'resolved', resolved_at = now(), note = 'test payment, refunded by hand'
where id = 42;
```

Rows outlive the account (their `user_id` becomes null) because a refund may still be owed.

### Rules for the ledgers

Never `update` or `delete` ledger rows. Triggers refuse edits to `units`/`user_id`, and refuse any
delete from `usage_events`, `ink_grants`, `ink_purchases` and `profiles` (`42501`, even as
`postgres`), except an account deletion's cascade and `refund_ink_for()`: a deleted usage row would
mint ink, a deleted grant or purchase would leave the stored balance wrong, and a deleted profile
would come back with a zero balance. Corrections are new rows (`grant_ink`). A raw
`insert into public.ink_grants` works (the trigger keeps the balance), but one that would take the
balance below zero fails with `23514`. To remove an account entirely, delete the auth user
(*Authentication → Users*, or the user's own *Delete account*).

## 7. Going live

The owner's steps, **in this order**. The live webhook endpoint is created only after the ink code
is deployed: `main` before it stores every payload that reaches the webhook in `billing_events`,
Fuime's buyers' names, emails and addresses included.

1. **Stripe access.** Give the live restricted key write permission (Products, Prices, Payment
   Links, Webhook Endpoints; read on the account) or run `stripe login` for the live account.
2. **Check what the customer will see** (*Settings → Business → Public details*, *Settings →
   Branding*): Checkout, receipts and card statements show the account's name ("Fuime") and
   branding, with `AGATHON` as the statement suffix. Changing them affects Fuime's customers too.
   Turn on receipt emails for successful payments and refunds (*Settings → Customer emails*).
   Decide on tax (the Payment Links do not collect tax). Leave Adaptive Pricing as it is: the
   webhook checks the USD amount either way.
3. **Apply the migration** `20261002000000_ink.sql` to the production database (the Marketplace
   project; see the note at the top of `RUNBOOK-supabase.md`). **First back up the board history**:
   production is on the free plan (no backups, no PITR), and `20261003000000_snapshot_retention.sql`,
   pushed with it, deletes most of `public.whiteboard_snapshots` (the copies of every board kept by
   the old every-save rule):

   ```bash
   mkdir -p backups && pg_dump "$POSTGRES_URL_NON_POOLING" -t public.whiteboard_snapshots -Fc \
     -f backups/whiteboard_snapshots-$(date +%F).dump
   gpg -c backups/whiteboard_snapshots-$(date +%F).dump && rm backups/whiteboard_snapshots-$(date +%F).dump
   ```

   It holds students' work: keep the encrypted file off the repo and off shared drives (a full
   `pg_dump --schema=public` the same way is better still; `RUNBOOK-supabase.md` section 10). Then
   `npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all`, then
   `node scripts/verify-rls.mjs` against production (with `SUPABASE_SERVICE_ROLE_KEY`, so the
   service-role checks run too). On the way in it gives every existing account one starter of
   `max(300, what it had left this month)`, deactivates Plus/Pro and moves everyone to `free`. Apply
   it right before the deploy: the old app keeps working on the new schema, but shows "0 credits a
   month", and cannot refund failed calls (it calls `refund_credits` as the user, which the
   migration revokes).
4. **Deploy the ink code** (merge to `main`) with these Production variables set first:

   ```bash
   vercel env add STRIPE_LIVEMODE production                # true
   vercel env rm BILLING_PRICE_MAP production               # if it exists: plans are gone
   ```

   `SUPABASE_SERVICE_ROLE_KEY` is already in Production (the Supabase Marketplace integration); the
   paid routes now use it for refunds of failed calls. Without `NEXT_PUBLIC_BILLING_LINKS` every buy
   button says "Coming soon"; everything else works. Check the deploy: sign in, see the starter ink
   in the header and on `/account`.
5. **Create the live objects**, now that the deployed webhook ignores what is not Agathon's:

   ```bash
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run   # read-only preview
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com
   ```

   It prints `NEXT_PUBLIC_BILLING_LINKS` and `INK_PRICE_MAP` and writes the endpoint's signing
   secret to `~/.config/agathon-classroom/stripe-webhook-secret-live`. Until the next step the
   endpoint's deliveries fail with `503` (no secret yet) and Stripe retries them; nothing is sold
   yet, so nothing is lost.
6. **Set the remaining Production variables** (project `whiteboardstaging`, team `rushmore`):

   ```bash
   vercel env add NEXT_PUBLIC_BILLING_LINKS production   # paste the printed JSON
   vercel env add INK_PRICE_MAP production               # paste the printed JSON
   vercel env add STRIPE_WEBHOOK_SECRET production --sensitive < ~/.config/agathon-classroom/stripe-webhook-secret-live
   ```

7. **Redeploy** production (`vercel --prod`, or an empty commit to `main`). The `NEXT_PUBLIC_*`
   values are built into the client bundle, so a deploy that predates them keeps showing "Coming
   soon".
8. **A real purchase and refund** on https://whiteboard.rushilchopra.com:
   1. Sign in, open a board, tap the ink meter, buy the Small pack (a new tab opens). Pay.
   2. Back on the board tab the meter should read +1,000 within seconds; the other tab ends on
      `/account?ink=small` saying "Ink added". In the Dashboard, *Developers → Webhooks → the
      endpoint* shows `checkout.session.completed` answered `200`.
   3. Refund the payment in the Dashboard. The `charge.refunded` delivery answers `200`; the
      purchase shows "Refunded" in `/account` and the ink is gone (or what was left of it).
   4. `select id, type, received_at from public.billing_events order by received_at desc limit 5;`
      shows only those two events: Fuime's traffic leaves no rows. `ink_checkout_reviews` is empty.

## 8. When something goes wrong

- **Paid, but no ink after a minute.**
  1. Look at the endpoint's deliveries in the Dashboard, and at the review queue (section 6).
     - `200` and a row in `ink_checkout_reviews`: the checkout could not be granted automatically;
       its `reason` says why (no `client_reference_id` because the Payment Link was opened outside
       the app, underpaid, not USD, unknown pack, account deleted). Resolve it (section 6). The
       Vercel log line is `Agathon checkout NOT granted`.
     - `503` means an env var is missing (`STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`),
       `INK_PRICE_MAP` is malformed, or the migration is missing.
     - `400 bad signature`: the secret belongs to another endpoint or mode.
     - `400 livemode mismatch`: `STRIPE_LIVEMODE` does not match the endpoint's mode (a test-mode
       endpoint pointed at production, or `STRIPE_LIVEMODE=false` in production). Fix the variable
       or the endpoint; Stripe retries for three days.
     - `500`: a database error; the log line says which. Stripe retries.
     - `200 ignored` for a session that should be ours: it is missing `metadata.app` (a Payment Link
       not made by the script). Grant by hand with `grant_ink` and fix the link.
- **A refund keeps failing with 500.** Its checkout has not been granted (section 5, "A refund
  before its grant").
- **Failed AI calls are not refunded.** The log says `SUPABASE_SERVICE_ROLE_KEY is not set, so failed
  calls cannot be refunded`: set it on that deployment. Make good by hand with `grant_ink`.
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
  Session always carries the user. Today such a payment waits in `ink_checkout_reviews` and is
  resolved by hand.
- **No per-user receipt list in the app beyond our own purchase rows.** Stripe's receipts go by
  email.
