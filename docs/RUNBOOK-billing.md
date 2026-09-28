# Billing runbook (Stripe)

How paid plans work in operation, how to go live, and what to do when a payment does not turn
into a plan. Design: `docs/ARCHITECTURE.md` "Billing". Database side (plans table, grants, setting
a plan by hand): `docs/RUNBOOK-supabase.md` section 13.

## 1. How it fits together

- **Plans.** Free 300 credits a month, Plus 3,000 at $9, Pro 12,000 at $29 (migration
  `20260928110000_paid_plans.sql`). The paid prices are placeholders. They live in two places that
  must agree: `public.plans` (what the app shows and meters) and `PLANS` at the top of
  `scripts/stripe-setup.mjs` (what Stripe charges). `src/__tests__/stripeSetup.test.ts` fails when
  they differ.
- **Checkout** is a Stripe Payment Link per paid plan. The app opens it with
  `client_reference_id=<user id>` and `prefilled_email=<email>`. After payment Stripe redirects to
  `<site>/account?upgraded=<plan>`, where the page waits for the webhook.
- **The webhook** (`POST /api/billing/webhook`, `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`)
  turns three events into `profiles` changes:
  - `checkout.session.completed` sets the plan, the customer and the subscription.
  - `customer.subscription.updated` handles a plan switch (by price, `BILLING_PRICE_MAP`), a
    cancellation scheduled for the period end (`billing_status = 'canceling'`), a renewal date or a
    failed payment.
  - `customer.subscription.deleted` moves the user back to Free.
- **Everything after checkout** goes through the Stripe customer portal. The app links to the
  portal's login page with the email filled in, and Stripe emails a one-time sign-in link. In the
  portal the customer can switch between Plus and Pro, cancel at the period end, update the card
  and see invoices.
- **Stripe objects** carry `metadata.app = agathon-classroom`. `scripts/stripe-setup.mjs` finds them
  that way, and never touches anything else on the account (the account also sells "Fuime
  membership").

## 2. The setup script

```bash
node scripts/stripe-setup.mjs [--mode test|live] [--site <url>] [--dry-run] [--secret-file <path>]
```

The script talks to Stripe only through the Stripe CLI (`stripe get|post … [--live]`), using the
account the CLI is logged in to (`stripe config --list`). It never reads, stores or prints an API
key. It is idempotent: a second run creates nothing, and it only updates what differs. Per paid plan
it makes:

- a product and a monthly price;
- a Payment Link that redirects to `<site>/account?upgraded=<plan>`.

It also makes one customer portal configuration with a login page, and, for a site that is not
localhost, a webhook endpoint for `<site>/api/billing/webhook` with the three events.

A new endpoint's signing secret is written to `~/.config/agathon-classroom/stripe-webhook-secret-<mode>`
(mode 600) and is never printed. Stripe's API returns the secret only when the endpoint is created;
after that, it can be revealed in the Dashboard.

The script prints the values to set: `NEXT_PUBLIC_BILLING_LINKS` and `BILLING_PRICE_MAP`.

**Changing a price.** Edit `PLANS` in the script, then run it. The script:

- creates a new price;
- archives the old price (its subscribers keep paying it until they switch);
- creates a new Payment Link and deactivates the old one;
- prints new values for both env vars. `BILLING_PRICE_MAP` keeps the archived prices mapped.

Then update the two Vercel variables and redeploy. Also update `public.plans` (runbook-supabase
section 13), plus a migration if the change is permanent.

## 3. Test mode (what exists now)

Run on 2026-09-28 against account `acct_1TznaN2Uz4P3wrXO` ("Fuime", test mode) with
`node scripts/stripe-setup.mjs --mode test --site http://localhost:3112`. A second run printed
this (only IDs and public URLs, no secrets):

```
Stripe account acct_1TznaN2Uz4P3wrXO ("Fuime"), test mode
Site http://localhost:3112

Plus (plus): $9.00/month, 3000 credits
  product prod_VLO1PGefEep16C
  price price_1UKhFP2Uz4P3wrXOgj06QDjP
  payment link plink_1UKhFQ2Uz4P3wrXOZy1YVtIV https://buy.stripe.com/test_00w4gs8Jn0J79Zg4v63Je00

Pro (pro): $29.00/month, 12000 credits
  product prod_VLO1tDN1Jinw3b
  price price_1UKhFR2Uz4P3wrXOKixfGN3V
  payment link plink_1UKhFS2Uz4P3wrXOAGg8YW0Z https://buy.stripe.com/test_cNi3co4t7crPb3kd1C3Je01

Customer portal
  update portal configuration bpc_1UKhFb2Uz4P3wrXOenlorpyo (plans, return URL, login page)
  configuration bpc_1UKhFb2Uz4P3wrXOenlorpyo
  login page https://billing.stripe.com/p/login/test_00w4gs8Jn0J79Zg4v63Je00

Webhook
  skipped (local site)

Set these (Vercel: Production; locally: the dev server's env):
  NEXT_PUBLIC_BILLING_LINKS={"plus":"https://buy.stripe.com/test_00w4gs8Jn0J79Zg4v63Je00","pro":"https://buy.stripe.com/test_cNi3co4t7crPb3kd1C3Je01","portal":"https://billing.stripe.com/p/login/test_00w4gs8Jn0J79Zg4v63Je00"}
  BILLING_PRICE_MAP={"price_1UKhFP2Uz4P3wrXOgj06QDjP":"plus","price_1UKhFR2Uz4P3wrXOKixfGN3V":"pro"}
  STRIPE_WEBHOOK_SECRET: http://localhost:3112 is local, so no endpoint was made. Run `stripe listen --forward-to http://localhost:3112/api/billing/webhook`; the whsec_ secret it prints is STRIPE_WEBHOOK_SECRET for that session.
```

Because the test Payment Links redirect to `http://localhost:3112`, re-run the script with another
`--site` to move them. The test-mode portal configuration is the account's default test-mode
configuration, because it was the first one.

### Trying it locally

```bash
# 1. Webhooks to the dev server. The secret goes into a variable, never onto the screen.
export STRIPE_WEBHOOK_SECRET="$(stripe listen --print-secret)"
stripe listen --forward-to localhost:3112/api/billing/webhook &

# 2. The dev server, with the test-mode values from section 3 (env vars override .env.local)
NEXT_PUBLIC_BILLING_LINKS='…' BILLING_PRICE_MAP='…' npx next dev -p 3112
```

To pay, use card `4242 4242 4242 4242`, any future date, and any CVC and ZIP.

A test-mode portal login emails a one-time link only to a test-mode customer's address. For an
`@example.com` user, open the portal through a session instead:

```bash
stripe post /v1/billing_portal/sessions \
  -d customer=<profiles.billing_customer_id> \
  -d configuration=bpc_1UKhFb2Uz4P3wrXOenlorpyo \
  -d return_url=http://localhost:3112/account
```

To end a subscription at once, which is what happens at the period end, run
`stripe delete /v1/subscriptions/<id> --confirm`.

## 4. Before going live: the owner, in the Stripe Dashboard

These are decisions or account settings; the script does not change them.

1. **Who the customer sees.** Checkout, the portal and card statements show the account's public
   business name, which today is **"Fuime"**. Checkout says "Subscribe to Agathon Classroom Plus",
   but also "By subscribing, you authorize Fuime to charge you". The portal shows "Return to Fuime".
   Either set up a separate Stripe account for Agathon Classroom, or accept or change the public
   details. Changing them affects Fuime's customers too. They are under *Settings → Business →
   Public details*: business name, support email/phone/URL, and statement descriptor.
2. **Branding** (*Settings → Branding*): the icon, logo and colours used on Checkout and the portal.
3. **Account activation.** The API reports `charges_enabled: true` and `details_submitted: true`
   for this account, so it can take live payments. Confirm that payouts are enabled and the bank
   account is right.
4. **Customer emails** (*Settings → Customer emails*): receipts for successful payments and
   refunds, and emails about failed payments and cards that are about to expire.
5. **Portal legal links.** The portal configuration has no terms-of-service or privacy-policy URL,
   because the app has no such pages yet. Add them in *Settings → Billing → Customer portal*, or
   through the script, once the pages exist.
6. **Live-mode default portal configuration.** If the live account has no portal configuration
   yet, the one the script creates becomes the account's default. Fuime's own portal sessions
   would then show Agathon's plans. Check *Settings → Billing → Customer portal* after the live run.
7. **Tax.** Decide whether Stripe Tax applies. The Payment Links do not collect tax today.
8. **Failed payments** (*Settings → Billing → Subscriptions and emails*): decide how many retries
   happen and what happens after the last one. The app keeps the plan while the status is
   `past_due`, and moves the user to Free when Stripe deletes the subscription.

## 5. Going live

1. **Apply the migration** `20260928110000_paid_plans.sql` to the production database (the
   Marketplace project; see the note at the top of `RUNBOOK-supabase.md`):
   `npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all`. Then run
   `node scripts/verify-rls.mjs` against production.
   - This lowers the Free plan from 1,000 to 300 credits for everyone at once.
   - A Free user who has already used more than 300 credits this month is out of credits until the 1st.
   - To soften that for this month, grant the difference in `credit_grants` (runbook-supabase
     section 13).
2. **Create the live objects:**

   ```bash
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com --dry-run   # read-only preview
   node scripts/stripe-setup.mjs --mode live --site https://whiteboard.rushilchopra.com
   ```

   This creates the products, prices, Payment Links, the portal configuration and the webhook
   endpoint. It prints `NEXT_PUBLIC_BILLING_LINKS` and `BILLING_PRICE_MAP`, and writes the
   endpoint's signing secret to `~/.config/agathon-classroom/stripe-webhook-secret-live`.
3. **Set the Vercel Production env vars** (project `whiteboardstaging`, team `rushmore`):

   ```bash
   vercel env add NEXT_PUBLIC_BILLING_LINKS production   # paste the printed JSON
   vercel env add BILLING_PRICE_MAP production           # paste the printed JSON
   vercel env add STRIPE_WEBHOOK_SECRET production --sensitive < ~/.config/agathon-classroom/stripe-webhook-secret-live
   ```

   `SUPABASE_SERVICE_ROLE_KEY`, which the webhook also needs, is already in Production: the
   Supabase Marketplace integration added it, as `vercel env ls production` showed on 2026-09-28.
4. **Redeploy** production (`vercel --prod`, or merge to `main`). The `NEXT_PUBLIC_*` values are
   built into the client bundle, so a deploy that predates them keeps showing "Coming soon".
5. **Test purchase and refund** with a real card on https://whiteboard.rushilchopra.com:
   1. Sign up (or use your own account), open */account* and click Plus → Upgrade. Pay.
   2. Back on */account* you should see "You're on Plus" and 3,000 credits within a few seconds.
      In the Stripe Dashboard, *Developers → Webhooks → the endpoint* should show
      `checkout.session.completed` answered `200`.
   3. In the Dashboard, open the payment and click *Refund*. Then open the subscription and
      *Cancel subscription → Immediately*. A refund alone does not cancel the subscription.
   4. The `customer.subscription.deleted` event moves the account back to Free. Check it with
      `select id, type, received_at from public.billing_events order by received_at desc limit 5;`.

## 6. When something goes wrong

- **Paid, but the plan is still Free after a minute.**
  1. Look in `billing_events` and at the endpoint's deliveries in the Dashboard.
     - `503` means an env var is missing: `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, or
       a malformed `BILLING_PRICE_MAP`.
     - `400 bad signature` means the secret belongs to another endpoint or mode.
  2. A `checkout.session.completed` without `client_reference_id` is ignored. That happens when
     someone opened the Payment Link directly instead of through the app.
  3. Fix it by hand: set the plan and the Stripe ids with SQL (runbook-supabase section 13, "Set a
     user's plan by hand"). Include `billing_customer_id` and `billing_subscription_id`, so that
     later events find the profile.
- **"Renews every month" instead of a date.** Stripe sends no `customer.subscription.updated`
  right after a Payment Link checkout, and `checkout.session.completed` does not carry the period
  end. The date appears with the first renewal, plan switch or cancellation.
- **Two subscriptions for one user.** The app sends a subscriber to the portal, never to a second
  Payment Link. The links themselves are public, though. Cancel the extra one in the Dashboard.
- **Portal login email not arriving.** Stripe sends it to the address on the Stripe customer, which
  is the checkout email, not necessarily the app login.

## 7. What the no-secret design cannot do

These are the limits of Payment Links plus the portal login link. Each one could be lifted by a
small server route that uses a *restricted* key (Checkout Sessions: write; Billing portal sessions:
write; Customers: read). Nothing needs it yet.

- **Portal access takes an email round trip.** A server route could open a portal session for the
  signed-in user in one click.
- **No renewal date right after checkout.** A route or webhook with API access could read the
  subscription.
- **A Payment Link opened outside the app cannot be matched to a user.** A server-created Checkout
  Session always carries the user.
- **The same Payment Link could be bought twice.** A server-created Checkout Session could refuse
  a user who already has a subscription.
