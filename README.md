# Dream Game Valley

A small website where you list games you made, people sign up/sign in, and buy them
with a card (or Apple Pay/Google Pay/etc. — Stripe adds those automatically).
Only your account can add or remove games. Money goes to your own bank account
through your own Stripe account — this app never touches your money directly,
it just tells Stripe what to charge.

## What you need to do once, outside this code

1. **Create a Stripe account** at https://dashboard.stripe.com/register — this is
   the real business step. Stripe will ask for your legal name/business info and
   your bank account, because that's who they're legally required to verify before
   sending you money. I can't do this step for you.
2. Turn on the payment methods you want under **Settings → Payment methods** in
   Stripe (cards are on by default; wallets and others are a toggle).
3. (Optional but recommended) Turn on **Stripe Tax** under **Products → Tax** if
   you want sales tax calculated and collected automatically at checkout. Whether
   Stripe can also *file* it for you depends on your state/country — check Stripe's
   tax page for your region. Either way, Stripe Tax handles the "collect the right
   amount at checkout" part so you're not guessing.
4. Get your **Secret key** from **Developers → API keys**, and set up a
   **webhook** under **Developers → Webhooks** pointing at
   `https://yourdomain.com/api/stripe/webhook`, listening for
   `checkout.session.completed`. Copy the webhook's signing secret.

## Running it

```bash
npm install
cp .env.example .env
# open .env and fill in SESSION_SECRET, ADMIN_SETUP_KEY, and your Stripe keys
npm start
```

Then open `http://localhost:3000`.

## Becoming the admin (your own account, your own password)

1. Go to `http://localhost:3000/admin.html`.
2. You'll be asked for the `ADMIN_SETUP_KEY` from your `.env` file, plus an email
   and password **you choose right there** — nobody, including me, ever sees or
   sets your password. This only works once; after the first admin account exists,
   the setup form won't create another one.

From then on, that's your one and only admin login. Everyone else who signs up
through the normal "Sign up" button is a regular buyer — they can never add,
edit, or remove games, and they never see any money.

## How a sale actually works

1. A buyer signs up/signs in and clicks **Buy**.
2. They're sent to a Stripe-hosted checkout page (this is what gives them "many
   ways to pay" — Stripe handles that screen, not this code).
3. Once Stripe confirms payment, Stripe sends your server a webhook, and the
   order is marked paid.
4. Stripe deposits your money (minus Stripe's processing fee) into your bank
   account on whatever payout schedule you set in your Stripe dashboard —
   automatically, with no extra code from you.

## Deploying so it's live on the internet

This is a normal Node.js app, so it runs on hosts like Render, Railway, Fly.io,
or a VPS. General steps on most of them:
1. Push this folder to a GitHub repo (keep `.env` out of it — it's already
   listed in the included `.gitignore`).
2. Create a new "Web Service" from that repo on your host of choice.
3. Set the same environment variables from `.env` in the host's dashboard.
4. Set the start command to `npm start`.
5. Once it's live, update your Stripe webhook URL to the real domain.

## Being upfront about limits of this starter

- This is a solid working starting point, not a finished, audited payment
  system. Before you take real customer money at scale, it's worth having
  someone review the security (especially file uploads and session handling)
  and check your local sales-tax obligations with a tax professional —
  automated tools reduce that work but don't remove the responsibility.
- Game files are stored on the same server's disk. That's fine to start, but
  if you deploy to a host with an ephemeral filesystem (like some free tiers),
  uploaded files can disappear on redeploy — ask me to wire in S3 or a similar
  storage service if you get to that point.
