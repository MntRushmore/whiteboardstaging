# Billing runbook (ink packs and Agathon Unlimited on Stripe)

How ink works in operation, how to change packs and prices, how to give or take back ink by hand,
what a refund does, how to go live, and what to do when a payment does not turn into ink. Design:
`docs/ARCHITECTURE.md` "Billing". Schema: `supabase/migrations/20261002000000_ink.sql` (its header
is the reference for every table, trigger and function named here). The $25/month **Agathon
Unlimited** subscription is sections 10 and 11; its schema is
`supabase/migrations/20261003020000_unlimited.sql`.

## 1. How it fits together

- **Ink is the unit.** 1 ink = 1 of the old monthly credits, and the per-action prices are unchanged
  (`ROUTE_COSTS` in `src/lib/server/billing.ts`: reading a line 1, checking 3, a worked solution 10,
  a word-problem setup 2, a board-chat request 3, lecture mode 2 a minute and 4 a drawing). Drawing
  on your own is always free.
- **No free plan (2026-10-05).** The app needs Agathon Unlimited after the guided first board
  (section 10); ink packs are no longer sold, and the pack Payment Links should be deactivated in
  Stripe. The pack rows, the webhook's pack handling and the refund rules stay for packs bought
  before.
- **Ink never expires and never resets.** A new account gets **100 starter ink once** (300 before
  2026-10-05; `ink_starter_amount()`), enough for the guided first board, at sign-up
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
  - The Agathon Unlimited subscription's checkout and `customer.subscription.*` events: section 10.
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

It also makes Agathon Unlimited's product, price, Payment Link and portal configuration (section
10), retires its own Plus/Pro objects (section 2) and, for a site that is not localhost, makes a
webhook endpoint for `<site>/api/billing/webhook` listening to exactly `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `charge.refunded` and
`customer.subscription.created|updated|deleted` (an existing endpoint of ours is set to exactly
those). A new endpoint's signing secret is written to
`~/.config/agathon-classroom/stripe-webhook-secret-<mode>` (mode 600) and never printed.

It prints the values to set: `NEXT_PUBLIC_BILLING_LINKS`, `INK_PRICE_MAP`,
`NEXT_PUBLIC_UNLIMITED_LINK` and `NEXT_PUBLIC_BILLING_PORTAL_URL`.

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

The release carries four migrations, applied in **two halves around the deploy** (steps 3 and 5),
never all at once with a plain `db push`:

| When | Migrations | Why then |
| --- | --- | --- |
| Before the deploy (step 3) | `20261002000000_ink.sql`, `20261003000000_snapshot_retention.sql` | The new code needs the ink schema; `main` keeps working on it |
| After the deploy (step 5) | `20261003010000_signup_consent.sql`, `20261003010100_bug_reports_leave_with_account.sql` | The consent migration refuses any sign-up that does not send `terms_version`, which `main`'s form does not: applied before the deploy, every sign-up fails ("Database error saving new user") until the new form is live. The new code is fine without either: the version it sends is kept in the account's metadata and recorded on the profile by step 5's backfill; bug reports simply outlive a deleted account until then |

1. **Stripe access.** Give the live restricted key write permission (Products, Prices, Payment
   Links, Webhook Endpoints; read on the account) or run `stripe login` for the live account.
2. **Check what the customer will see** (*Settings → Business → Public details*, *Settings →
   Branding*): Checkout, receipts and card statements show the account's name ("Fuime") and
   branding, with `AGATHON` as the statement suffix. Changing them affects Fuime's customers too.
   Turn on receipt emails for successful payments and refunds (*Settings → Customer emails*).
   Decide on tax (the Payment Links do not collect tax). Leave Adaptive Pricing as it is: the
   webhook checks the USD amount either way.
3. **Back up the board history, then apply the first half of the migrations**, ink and snapshot
   retention, to the production database (the Marketplace project; see the note at the top of
   `RUNBOOK-supabase.md`). Production is on the free plan (no backups, no PITR), and
   `20261003000000_snapshot_retention.sql` deletes most of `public.whiteboard_snapshots` (the copies
   of every board kept by the old every-save rule), so dump it first:

   ```bash
   mkdir -p backups && pg_dump "$POSTGRES_URL_NON_POOLING" -t public.whiteboard_snapshots -Fc \
     -f backups/whiteboard_snapshots-$(date +%F).dump
   gpg -c backups/whiteboard_snapshots-$(date +%F).dump && rm backups/whiteboard_snapshots-$(date +%F).dump
   ```

   It holds students' work: keep the encrypted file off the repo and off shared drives (a full
   `pg_dump --schema=public` the same way is better still; `RUNBOOK-supabase.md` section 10).
   Then apply the two files. Not with `db push`, which would apply the consent migration too: run
   the two files, then record them so step 5's `db push` skips them.

   ```bash
   DB="$POSTGRES_URL_NON_POOLING"                       # from `vercel env pull`
   psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261002000000_ink.sql
   psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261003000000_snapshot_retention.sql
   npx supabase migration repair --db-url "$DB" --status applied 20261002000000 20261003000000
   npx supabase migration list --db-url "$DB"           # 20261003010000 and 20261003010100 still pending
   ```

   On the way in the ink migration gives every existing account one starter of
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
   in the header and on `/account`; the sign-up form shows the Terms box.
5. **Apply the second half of the migrations**, sign-up consent and bug reports, once the
   deployment from step 4 is serving production (an old tab still open on the previous sign-up form
   gets "We couldn't create your account. Reload this page and try again." after this, and a reload
   fixes it):

   ```bash
   npx supabase migration list --db-url "$DB"           # exactly 20261003010000 and 20261003010100 pending
   npx supabase db push --db-url "$DB" --include-all
   ```

   Then `node scripts/verify-rls.mjs` against production (with `SUPABASE_SERVICE_ROLE_KEY`, so the
   service-role checks run too; its `consent:` checks pass only from here on), and sign up once on
   the site: `select terms_version, accepted_terms_at from public.profiles order by created_at desc
   limit 1;` shows `2026-10-03`. Accounts made between steps 4 and 5 got the same record from the
   migration's backfill. Both migrations are safe to re-run.
6. **Create the live objects**, now that the deployed webhook ignores what is not Agathon's:

   ```bash
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run   # read-only preview
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com
   ```

   It prints `NEXT_PUBLIC_BILLING_LINKS` and `INK_PRICE_MAP` and writes the endpoint's signing
   secret to `~/.config/agathon-classroom/stripe-webhook-secret-live`. Until the next step the
   endpoint's deliveries fail with `503` (no secret yet) and Stripe retries them; nothing is sold
   yet, so nothing is lost.
7. **Set the remaining Production variables** (project `whiteboardstaging`, team `rushmore`):

   ```bash
   vercel env add NEXT_PUBLIC_BILLING_LINKS production   # paste the printed JSON
   vercel env add INK_PRICE_MAP production               # paste the printed JSON
   vercel env add STRIPE_WEBHOOK_SECRET production --sensitive < ~/.config/agathon-classroom/stripe-webhook-secret-live
   ```

8. **Redeploy** production (`vercel --prod`, or an empty commit to `main`). The `NEXT_PUBLIC_*`
   values are built into the client bundle, so a deploy that predates them keeps showing "Coming
   soon".
9. **A real purchase and refund** on https://whiteboard.rushilchopra.com:
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
- **The app cannot cancel a subscription.** Cancelling is the customer portal's (section 10), and
  deleting an account waits until the plan is set to cancel. A server route with a restricted key
  (Subscriptions: write) could cancel it as part of the deletion.

## 10. Agathon Unlimited

**$25 a month after a 7-day free trial** (owner, 2026-10-03). On 2026-10-06 it was 3 days for a
few hours, then 7 again; the two trials started in between keep their 3 days (Stripe fixes a
subscription's trial at checkout). Changing the trial means changing, in Stripe, all three of:
the Payment Link's `subscription_data[trial_period_days]` (plus `metadata[trial_days]`), its
`custom_text[submit][message]` note, and the product's description (`stripe-setup.mjs` writes all
three; the link's URL stays the same, so NEXT_PUBLIC_UNLIMITED_LINK does not change). Order: when
the trial gets SHORTER, deploy the app first and then change Stripe; when it gets LONGER, change
Stripe first. Either way the app never promises a later charge than Stripe makes. While a user's subscription is
`trialing` or `active`, help spends **no ink**, and a subscriber keeps whatever ink they had. Since
2026-10-05 there is no free plan: without a plan (none, or a plan that ended) the home, the boards
and Progress send the student to the plan screen (`usePlanGate`, `src/lib/billing/planGate.ts`).

- **Checkout.** One subscription Payment Link (`NEXT_PUBLIC_UNLIMITED_LINK`) with the free trial on
  it (`subscription_data.trial_period_days = 7`) and the card taken up front
  (`payment_method_collection: always`), so it renews at $25 unless cancelled. The app opens it
  with `client_reference_id=<the account's checkout_ref>` (NOT the user id, unlike the packs: see
  section 12) from the last onboarding screen and from `/account`'s Plan section ("Try Unlimited
  free for 7 days"). After checkout Stripe redirects to
  `<site>/?unlimited=started`, where the page re-reads every few seconds until the plan shows up.
  Nothing is charged at checkout; Stripe charges $25 when the trial ends.
- **Tags.** The product, price, link and its Checkout Sessions carry `metadata.app =
  agathon-classroom` and `metadata.plan_id = unlimited`; every subscription the link starts gets
  the same pair (`subscription_data.metadata`). That is how the webhook tells Unlimited apart from
  Fuime's subscriptions (foreign: nothing stored) and from the retired Plus/Pro ones (ignored).
- **The webhook** (`src/lib/server/billingWebhook.ts`):
  - `checkout.session.completed` with `mode: subscription` links the subscription to the account
    whose `profiles.checkout_ref` is `client_reference_id`, and stores the payer's email
    (`link_unlimited_checkout()`). It is the only event that names the user.
  - `customer.subscription.created|updated|deleted` store its status, trial end, period end and
    cancellation (`apply_unlimited_subscription()`).
  - Stripe does not order deliveries, so either kind may arrive first: each creates the row
    (`unlimited_subscriptions`, keyed by the subscription id, `user_id` null until linked). A state
    is applied only if its event is not older than the one the row holds (same second: created,
    then updated, then deleted), and `canceled` is final. Redeliveries are applied again, harmlessly.
  - A checkout without a usable user (the link opened outside the app; the account deleted) is
    stored linked to nobody and logged at `warn`: `Agathon Unlimited checkout NOT linked to an
    account`. Nobody gets the plan until you link it (section 11).
- **Who has it** (`has_unlimited()`): a linked row in `active`, or in `trialing` on the account's
  FIRST plan (section 12), whose period end (else trial end) is less than **3 days** past (Stripe
  retries a failed webhook delivery for three days). `past_due` (a failed renewal) is **not** Unlimited: help spends ink again until the card
  is fixed, and the Plan section says "Your last payment didn't go through. Update your card".
- **Fair use.** Each AI action a subscriber takes is recorded in `unlimited_usage` (the ink it
  would have cost) instead of spending ink, at most **1,500 actions per rolling 24 hours**
  (`unlimited_fair_use_per_day()`, the one constant). Over it, the route answers `429
  rate_limited` with `Retry-After` and `reason: "fair_use"`, like any rate limit; never 402. A
  repeated request id is not counted twice (lecture mode asks under one id per minute), and a
  failed call's count is given back with its (zero) ink refund.
- **The customer portal** (`NEXT_PUBLIC_BILLING_PORTAL_URL`): Stripe's no-code login page for the
  Unlimited portal configuration, where the grown-up signs in with the checkout's email (a one-time
  code) and cancels (at the end of the free trial or the paid month), changes the card or reads
  invoices. "Manage or cancel" on `/account` opens it with the email prefilled.
- **Deleting an account** with a plan that would charge again (trialing, active or past_due, not
  set to cancel) is refused, in the app and in `delete_own_account()`: the dialog sends the
  grown-up to the portal first. After the deletion the subscription row stays with `user_id` null
  (no personal data on it), so a plan whose account is gone can still be found (section 11).
- **Refunds.** Refund a subscription payment in the Dashboard as usual; it touches no ink (the
  webhook ignores refunds of anything but ink packs). Refunding does not end the plan: cancel the
  subscription in the Dashboard too if that is the intent.
- **Env:** `NEXT_PUBLIC_UNLIMITED_LINK` (without it the plan says "Coming soon") and
  `NEXT_PUBLIC_BILLING_PORTAL_URL`. Both are printed by `scripts/stripe-setup.mjs` and built into
  the client bundle (redeploy after setting them).

The setup script (section 3) makes the Unlimited product, the monthly price, the Payment Link and
the portal configuration (with its login page) next to the packs, and subscribes our webhook
endpoint to the three `customer.subscription.*` events as well. `UNLIMITED` at the top of the
script and `UNLIMITED_PLAN` in `src/lib/billing/unlimited.ts` must agree (`stripeSetup.test.ts`).
Changing the price or the trial makes a new price and link (the old link stops selling; current
subscribers keep their price until they cancel), and prints the new `NEXT_PUBLIC_UNLIMITED_LINK`.

**Test mode, 2026-10-03.** The script ran in test mode against `http://localhost:3000`: product
`prod_VNK842UCp0pKNv`, price `price_1UMZTx2Uz4P3wrXOCCQT6Bl1`, link
`https://buy.stripe.com/test_6oU5kw0cR77vgnE9Pq3Je05`, portal configuration
`bpc_1UMZTz2Uz4P3wrXOXKZ34uYD` with login page
`https://billing.stripe.com/p/login/test_cNi3co4t7crPb3kd1C3Je01` (and the three ink packs, and the
Plus/Pro test objects retired). This account's API version is `2026-07-29.dahlia`: a
subscription's period end is on its items, which the webhook reads.

### Going live with Unlimited

The owner's steps, **in this order**:

1. **Apply the migration to production before merging.** `20261003020000_unlimited.sql` is
   additive and safe under the current code (nobody has a plan until the link is live, so spending,
   refunds and deletion behave as before):

   ```bash
   DB="$POSTGRES_URL_NON_POOLING"                       # from `vercel env pull`
   npx supabase migration list --db-url "$DB"           # exactly 20261003020000 pending
   npx supabase db push --db-url "$DB"
   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verify-rls.mjs   # against production: the "Agathon Unlimited" checks pass
   ```

   (If anything else is pending, apply this file alone with `psql "$DB" -v ON_ERROR_STOP=1
   --single-transaction -f supabase/migrations/20261003020000_unlimited.sql` and record it with
   `npx supabase migration repair --db-url "$DB" --status applied 20261003020000`.)
2. **Merge and deploy** the code. Until step 4 the Plan section and the onboarding offer say
   "Coming soon".
3. **Run the setup script in live mode** (read-only preview first):

   ```bash
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com
   ```

   It creates the Unlimited product, price, Payment Link and portal configuration, and
   **re-subscribes the existing live endpoint** to the `customer.subscription.created`,
   `.updated` and `.deleted` events (its signing secret does not change, so
   `STRIPE_WEBHOOK_SECRET` stays). Check it in the Dashboard: *Developers → Webhooks → the
   Agathon endpoint* lists six events. If the script prints a note instead of a portal login URL,
   turn it on by hand: *Settings → Billing → Customer portal →* the Agathon configuration *→
   Customer portal link → Activate*.
4. **Set the Production variables and redeploy:**

   ```bash
   vercel env add NEXT_PUBLIC_UNLIMITED_LINK production       # the printed https://buy.stripe.com/… link
   vercel env add NEXT_PUBLIC_BILLING_PORTAL_URL production   # the printed https://billing.stripe.com/p/login/… link
   vercel --prod                                              # NEXT_PUBLIC_* are built into the bundle
   ```

5. **Account-level Stripe settings** (shared with Fuime, so your call): *Settings → Billing →
   Subscriptions and emails*: what happens when all payment retries fail (choose **cancel the
   subscription**; `unpaid` also works but leaves it lingering), the failed-payment and
   trial-ending emails, and receipts for successful payments.
6. **Update the legal pages** before selling. Terms: the plan renews at $25 a month, charged
   automatically to the card given at checkout when the 7-day free trial ends and every month
   after, until cancelled; how to cancel (the customer portal, any time; before the trial ends
   means no charge; a cancellation takes effect at the end of the paid period); the fair-use
   limit; what happens when a payment fails (help uses ink until it is fixed); that a grown-up's
   card pays for a student's account. Refunds: whether a month already started is refunded
   (pro rata or not) and how to ask. Privacy: Stripe processes the subscription; we keep the
   Stripe ids, the plan's status and dates, and a record of the help a subscriber used; the
   subscription record stays (without the account link) after an account is deleted.
7. **A real trial signup and cancel** on https://whiteboard.rushilchopra.com:
   1. Sign in with a real account and start the free trial (onboarding's last screen, or `/account`
      → *Try Unlimited free for 7 days*). Checkout shows "7 days free, then $25.00 per month" and
      the note under the button; pay with a real card (nothing is charged today).
   2. Back on the home (`/?unlimited=started`), the header shows **∞ Unlimited** within seconds;
      `/account` says "Your free trial ends on …". In the Dashboard, the endpoint shows
      `checkout.session.completed` and `customer.subscription.created` answered `200`.
   3. Use help on a board: the ink balance does not move, and
      `select route, units, created_at from public.unlimited_usage order by id desc limit 5;`
      shows the actions.
   4. *Manage or cancel* → sign in to the portal with the checkout's email → cancel. Back on
      `/account` (it re-reads on focus): "Your free trial ends on …, and your plan ends with it. You
      won't be charged." `customer.subscription.updated` answered `200`.
   5. *Delete account* is now allowed (before the cancellation it sent you to the portal).
      Optionally end the subscription at once in the Dashboard (*Cancel immediately*): the plan
      reads "ended" and help spends ink again.
   6. `select stripe_subscription_id, user_id, status, cancel_at_period_end from
      public.unlimited_subscriptions;` shows the row; `billing_events` holds only Agathon events.

## 11. Agathon Unlimited by hand (SQL editor, as `postgres`)

```sql
-- who has a plan, and its state
select u.email, s.status, s.trial_end, s.current_period_end, s.cancel_at_period_end, s.cancel_at,
       public.has_unlimited(s.user_id) as unlimited, s.stripe_subscription_id, s.updated_at
from public.unlimited_subscriptions s left join auth.users u on u.id = s.user_id
order by s.updated_at desc;

-- paid for (or in the free trial) but linked to nobody: the link was opened outside the app, or the
-- account is gone. Find the customer in the Dashboard by the subscription id, then link it:
select stripe_subscription_id, stripe_customer_id, checkout_session_id, status, created_at
from public.unlimited_subscriptions
where user_id is null and status in ('trialing', 'active', 'past_due', 'unpaid');

update public.unlimited_subscriptions
   set user_id = (select id from auth.users where email = 'student@example.com'), linked_at = now()
 where stripe_subscription_id = 'sub_…' and user_id is null;
-- (an account that was deleted: cancel the subscription in the Dashboard instead)

-- what subscribers actually use (ink-equivalent), last 30 days: does $25 cover it?
select u.email, count(*) as actions, sum(x.units) as ink_equivalent
from public.unlimited_usage x join auth.users u on u.id = x.user_id
where x.created_at > now() - interval '30 days'
group by u.email order by ink_equivalent desc;
```

- **Change the fair-use cap** with a new migration: `create or replace function
  public.unlimited_fair_use_per_day() returns integer language sql immutable set search_path =
  public as $$ select 2000 $$;` (no deploy needed). The cap is per FAMILY: a kid's actions are
  recorded on their grown-up's `unlimited_usage` rows (20261009040000_family_hardening.sql), so
  the "what subscribers actually use" query above shows a family under the grown-up's email.
- **Delete an account by hand** (*Authentication → Users*) only after cancelling its subscription
  in the Dashboard: the app's own deletion refuses while a plan would charge again, the
  Dashboard's does not. Deleting a grown-up deletes their kid profiles' accounts too (a trigger on
  `families`, 20261009040000_family_hardening.sql). The kids' saved images are then left for the
  storage GC, because SQL cannot remove files.
- **A grown-up who cannot sign in to the portal** (they used another email at checkout): cancel
  the subscription for them in the Dashboard (*Customers → the customer → the subscription →
  Cancel*, at the period end); the webhook updates the app.

## 12. Go-live checklist (2026-10-04): privacy, plan emails, retention

What `supabase/migrations/20261003040000_go_live_gaps.sql` and the code beside it need before the
first real families sign up. Each item says how to check it.

### Nobody can start a plan on someone else's account

The Unlimited link used to carry `client_reference_id=<user id>`, and a user id is not a secret. A
stranger who learned one could open the link with their own card and the plan landed on the
victim's account: the account could then not be deleted (it refuses while a plan would charge) and
only the stranger could cancel it (the portal signs in by the checkout's email). Now:

- every profile has `checkout_ref` (a random uuid; unique; readable only by its owner, writable by
  nobody), delivered to the app in `ink_summary().unlimited.checkout_ref`;
- the app sends that as `client_reference_id` (`unlimitedCheckoutUrl`); until it is read the start
  button waits (it never falls back to the user id);
- `link_unlimited_checkout(p_checkout_ref, …)` resolves it to the account; the old
  `p_user_id` signature is dropped. A user id sent as the ref links nobody and is logged at `warn`
  like any unlinkable checkout (section 11 links one by hand, by the account's email).

Ink packs still carry the user id: buying ink for someone else is a gift, harmless.
`scripts/verify-rls.mjs` checks that B cannot read A's ref, A cannot change it, and A's user id as
the ref links nothing.

### One free trial per account (the trade-off)

Every checkout through the Payment Link starts a new 7-day trial in Stripe, so an account could
cancel and start again forever without paying. `has_unlimited()` now counts a `trialing`
subscription only when it is the account's **first** Unlimited subscription (no earlier row of
theirs that ever started, i.e. anything but `incomplete_expired`). A later trial still runs in
Stripe and charges $25 when it ends, as its checkout said; until then **help spends ink**, and the
Plan section says "Your plan starts on <date>, with the first $25 charge. The free trial is for a
first plan only, so help uses ink until then." The trade-off, accepted: **a returning subscriber
who starts a second plan pays in ink during that week** (or cancels in the portal before it ends
and is not charged). It does not stop a new account with the same card: the Terms already say free
weeks may be limited to one per person, family or card, which covers cancelling such a trial by hand.

### AI services keep nothing and train on nothing

- **OpenRouter.** Every request carries `provider: { data_collection: "deny", zdr: true }`
  (`PROVIDER_PRIVACY`, `src/lib/server/openrouter.ts`, merged in the only two functions that post):
  OpenRouter may route it only to an endpoint with Zero Data Retention that does not train on
  prompts; a model with none is refused with `404 No endpoints found matching your data policy`,
  never sent elsewhere. **Check by hand:** <https://openrouter.ai/settings/privacy> must have
  *input/output logging* OFF (OpenRouter's own copy of prompts; nothing in the API shows it). Also
  leave the account's "allow training" switches off; the per-request flags win either way.
- **A new model** (in `LIVE_MODELS`, or a `LIVE_MODEL_*` override in Vercel) must pass `npm run
  eval:privacy` first: one tiny request per model under those flags, with the provider that served
  it (`docs/eval/privacy.md`). A model with no ZDR endpoint fails every request in production.
- **Mathpix.** Every strokes request carries `metadata: { improve_mathpix: false }`
  (`src/lib/server/mathpix.ts`): Mathpix persists no image data or result and keeps only the
  request's metadata for billing. An account-level `improve_mathpix` value (set by Mathpix support)
  overrides the per-request one: leave it unset, or have it set to false.

### The plan's emails go to the payer; the free trial is confirmed

- **Payer email.** Stripe gives the payer's email only on the checkout (`customer_details.email`,
  else `customer_email`); `link_unlimited_checkout(…, p_payer_email)` stores it on the row
  (`unlimited_subscriptions.payer_email`, first wins). The free-week reminder and the confirmation
  go there, and fall back to the account's address only when the row has none
  (`src/lib/email/payer.ts`). The account reads its own row (RLS unchanged); when the account is
  deleted, the trigger `unlimited_subscriptions_forget_payer` blanks the email with the user id, so
  the row kept for the owner names nobody.
- **"Your free trial of Agathon Unlimited has started"** (`src/lib/email/unlimitedStarted.ts`,
  template `unlimitedStartedEmail`): nothing charged today; the date, time (Eastern) and amount of
  the first charge, then $25 every month until cancelled; *Manage or cancel*; cancel before that
  moment and nothing is charged; links to `/terms#unlimited` and `/refunds#subscriptions`. A second
  plan's version says the plan starts with the first charge (its free trial grants nothing). Sent
  when the webhook sees the subscription both linked and `trialing` (either event may complete
  that), **after** answering Stripe (`after()` from `next/server`): email never fails or slows the
  webhook. Once per subscription (`email_log` kind `unlimited_started`, ref = subscription id; Resend
  idempotency key `unlimited-started/<sub>`), however often Stripe redelivers. If Resend fails, the
  daily cron (`/api/cron/trial-reminders`, its `started` block) sends it while the trial has more
  than a day left. Not sent when the plan is set to cancel by the trial's end, or is linked to nobody.
- **Check after the first real signup:** `select kind, ref, resend_id, sent_at from public.email_log
  where kind = 'unlimited_started' order by claimed_at desc limit 5;` and the Resend dashboard.

### Stripe payloads are kept 90 days

`billing_events.payload` (the whole Stripe event: the payer's name, email, billing address, card
brand and last four) is blanked after **90 days** by `purge_billing_event_payloads()` (service role
only; the one constant is `billing_event_payload_retention()` in the go-live migration). The row
(event id, type, time) stays. The nightly `GET /api/admin/gc` calls it when collecting (never in a
dry run) and reports `billingPayloadsPurged`; a failure is logged and reported as `null` without
failing the storage pass. The Privacy Policy states the 90 days (`legalPages.test.tsx` reads it
from the migration). By hand: `select public.purge_billing_event_payloads();`.

### Card statements say AGATHON

The Stripe account is Fuime's, so its own statement descriptor is `FUIME`. Ink packs already add
the suffix: their Payment Links set `payment_intent_data.statement_descriptor_suffix = AGATHON`, so a
statement reads `FUIME* AGATHON`. A subscription's charges cannot take a suffix (Stripe makes the
renewal charges itself; `payment_intent_data` is payment mode only), but Stripe takes a
subscription payment's descriptor from the first item's **product** `statement_descriptor`. The
setup script now sets `statement_descriptor = AGATHON` on the Unlimited product (and updates an
existing product in place: same product, price and link). **Checked in test mode on 2026-10-03:**
after `node scripts/stripe-setup.mjs --mode test`, a test subscription on the Unlimited price
(no trial, `pm_card_visa`) produced charge `ch_3UMadU2Uz4P3wrXO1HcQo3jf` with
`calculated_statement_descriptor: "AGATHON"`; the test customer was then deleted. What stays
"Fuime": Checkout, receipts, invoices and the customer portal show the account's public business
name, which is account-wide (only a separate Stripe account would change it). The Terms and the
Refund Policy say exactly this (`LEGAL.statementDescriptors`, pinned to the script by
`stripeSetup.test.ts`).

### Go-live order for these changes

1. **Back up production first** (the free plan has no backups or PITR): `pg_dump "$DB" -n public
   -f ~/.config/agathon-classroom/backups/pre-go-live-gaps.sql`.
2. **Apply `20261003040000_go_live_gaps.sql`** right before the deploy, after
   `20261003020000_unlimited.sql` and `20261003030000_email_log.sql`. If the security audit's
   `20261003100000_*` / `20261003100100_*` are already applied, `supabase db push` refuses an
   older-stamped file: apply it with `psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f
   supabase/migrations/20261003040000_go_live_gaps.sql` and record it with `npx supabase migration
   repair --db-url "$DB" --status applied 20261003040000`. It is idempotent.
3. **Deploy the code at once.** In between, only Agathon Unlimited's link breaks: old code calls
   `link_unlimited_checkout(p_user_id)`, which no longer exists (500; Stripe retries for 3 days, so
   nothing is lost once the code is out). Ink packs, spending and everything else work either way.
4. `SUPABASE_SERVICE_ROLE_KEY=… node scripts/verify-rls.mjs` against production: the checkout-ref,
   one-free-week, payer-email and billing-retention checks pass.
5. **Stripe (live):** `node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run`,
   then without `--dry-run`: it sets `statement_descriptor = AGATHON` on the Unlimited product (or
   makes the product with it). Nothing to do in the Dashboard for the descriptor.
6. **Vercel Production env:** `RESEND_API_KEY` (the confirmation and the reminder send nothing
   without it; on 2026-10-03 it was only in `.env.local`), `CRON_SECRET` (set),
   `NEXT_PUBLIC_BILLING_PORTAL_URL` (else the emails' cancel link opens `/account`). Redeploy after
   adding.
7. **OpenRouter:** <https://openrouter.ai/settings/privacy>: input/output logging OFF.
8. After the first real Unlimited signup: `select kind, ref, sent_at from public.email_log where kind
   = 'unlimited_started';`, the Resend dashboard shows it delivered to the payer's address, and
   `select payer_email is not null from public.unlimited_subscriptions order by id desc limit 1;`.

## 13. A friend's free first month (the referral link)

"Give a month, get a month" (2026-10-09, `docs/KIDS-COME-BACK.md` Phase 2). A family a friend
invited gets its **first month free** instead of the 7-day trial, on the same monthly plan at the
same price (`UNLIMITED_PLAN.monthlyUsd`). It is a second Payment Link, nothing more: the app, the
webhook and the database treat its subscriptions like any other Agathon Unlimited subscription.

- **The link.** The monthly price, `subscription_data.trial_period_days = 30`, the card up front,
  the same `/?unlimited=started` redirect and the same `plan_id = unlimited` tags, plus `metadata.offer
  = referral` (on the link, its sessions and its subscriptions, so the Dashboard can tell them
  apart). `scripts/stripe-setup.mjs` makes it next to the monthly link (`REFERRAL` at the top of the
  script; its trial must equal `REFERRAL_TRIAL_DAYS` in `src/lib/billing/planChoice.ts`,
  `stripeSetupReferral.test.ts` pins them) and prints `NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK`. The
  monthly link's lookup and clean-up skip any link with an `offer`, so the live monthly link is never
  replaced by it.
- **Who gets it** (`planLink`, `src/lib/billing/planChoice.ts`): an account whose OWN
  `profiles.attribution.ref` is a valid referral code (saved once after sign-up from the visitor's
  `?ref=`), on a deployment with `NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK` set. The plan screen then says
  "First month free" and "Your first month is free (a friend invited you)" and dates the first charge
  30 days out; the account page's Billing card opens the same link and says why. Everyone else, a
  plan started again (the free trial is for a first plan only) and a deployment without the variable
  get the monthly link and the usual 7 days. Kids never see billing. The referral part's trigger on
  `profiles` (`profiles_record_referral`, `feat/kcb2-referral`) keeps `ref` in the attribution only
  when it recorded a real referral (a grown-up's code, issued before this account), so a made-up
  `?ref=` gets the usual trial; turn the link on only once that part is live.
- **The friend who invited them** gets their free month by hand: a credit you apply in Stripe once
  the new family's first payment succeeds (the admin console lists the referrals due one).
- **Trade-off.** Like every `NEXT_PUBLIC_*` link, its URL is in the page's code once set, so someone
  who reads the code could check out with it without being referred. The cost is at most 23 more
  free days on a first plan (one free trial per account). If it is abused: deactivate the link in the
  Dashboard (*Payment Links → the `offer: referral` link*), unset the variable and redeploy; a
  referred family then gets the usual 7 days, which the app says correctly.
- **When the monthly price changes**, change `UNLIMITED` in the script and `UNLIMITED_PLAN` in
  `src/lib/billing/unlimited.ts` together (section 10): the script makes the new monthly price and a
  new monthly link AND a new referral link, deactivates the old two, and prints both variables to
  update.

**Turning it on** (after the referral program's own code is live):

```bash
node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run   # "would create referral Payment Link (30-day trial …)", nothing else
node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com
vercel env add NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK production    # the printed https://buy.stripe.com/… link
vercel --prod
```

On 2026-10-09 only the test-mode dry run was made: it reads the existing test objects and says it
would create the referral link, and nothing else. Check it once live: sign up in a private window
through `https://whiteboard.rushilchopra.com/?ref=<a real code>`, finish the guided board, and the plan
screen says "First month free"; Checkout says 30 days free. Signed up without `?ref=`: 7 days.

## 14. Billing follow-ups (2026-10-09)

`supabase/migrations/20261009130000_billing_followups.sql` replaces `admin_funnel()` with one fix:
its `active_subscriptions`, which the admin Funnel's MRR is computed from (active ×
`UNLIMITED_PLAN.monthlyUsd`, `src/lib/funnel/report.ts`), counted every `active` subscription row,
so the owner's own test plan and paid rows linked to no account (section 11) were revenue. It now
leaves out admins' plans and rows with no user, like the per-account part already left admins out.
Same answer keys and grants; idempotent. Apply it to production before or after the deploy (the
code is the same either way):

```bash
psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261009130000_billing_followups.sql
npx supabase migration repair --db-url "$DB" --status applied 20261009130000
```

Locally, `src/lib/billing/__tests__/billing_followups.test.sql` checks it (it fails on the old
definition). The yearly plan once planned for this timestamp was dropped: the owner will raise the
monthly price instead, so `unlimited_subscriptions.billing_interval` (from
`20261009100000_parents_recommend.sql`) stays, unused. The admin Overview's money tiles
(`moneyOverview`, `src/lib/server/adminOverview.ts`) leave admins out but still count paid rows
linked to nobody.
