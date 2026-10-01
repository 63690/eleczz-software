# Putting ELECZZ Software online (a real URL, not just localhost)

This is optional. Everything the project brief and a recruiter's code review need is already
satisfied by running the app locally (see the main README). Do this only if you want a link you
can share without anyone installing Node.js or MySQL themselves.

## Honest limits before you start

* **Free-tier availability for cloud databases changes often.** As of when this guide was written,
  [Aiven](https://aiven.io) offers a genuinely free, no-card-required MySQL plan (1 CPU, 1 GB RAM,
  1 GB disk, kept indefinitely). Verify this yourself at signup — if it's gone, Clever Cloud and
  PlanetScale are the next things to check, or a $5–7/month VPS (any host) if you want a guarantee.
* **Free web hosting sleeps.** Render's free web service "spins down" after 15 minutes with no
  traffic. The first visit after that takes 30–60 seconds to wake up. If you're sending a recruiter
  a link, visit it yourself 2–3 minutes beforehand so it's already awake.
* **This guide was not tested end-to-end against Aiven or Render from this environment** — only the
  underlying code change (TLS support, below) was tested against a real MySQL server configured to
  require encryption, which is what any cloud MySQL host will require. If a step doesn't match what
  you see on screen (these dashboards change their layout periodically), tell Claude the exact
  wording of what you see and it can adjust the instructions.

## What changed in the code for this

Cloud MySQL hosts require an encrypted (TLS) connection; a MySQL server on your own machine does
not. Three new/changed files handle this, controlled entirely by your `.env` file — nothing changes
for a normal local setup:

* `utils/db-ssl.js` — turns `DB_SSL=true` (and optionally `DB_SSL_CA=path/to/cert.pem`) into the
  right connection option.
* `db.js`, `scripts/init-db.js`, `scripts/seed.js` — now use it.

If `DB_SSL` is not set in `.env`, nothing changes — your local setup keeps working exactly as before.

## Step 1: Put your code on GitHub

If you haven't already (you likely have, from sending this to a recruiter):

```bash
git init
git add .
git commit -m "ELECZZ Software"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/eleczz-software.git
git push -u origin main
```

Make sure `.env` is **not** in the repository (the included `.gitignore` already prevents this).

## Step 2: Create a free MySQL database on Aiven

1. Go to Aiven's signup page and create a free account (no card required for the free plan).
2. Create a new service → choose **MySQL** → choose the **Free** plan → pick any region.
3. Wait for it to say "Running" (a minute or two).
4. Open the service and find the **connection information**: host, port, user (usually `avnadmin`),
   password, and a **CA certificate** download link/button.
5. Download the CA certificate file and keep it somewhere on your computer, e.g.
   `C:\projects\eleczz\aiven-ca.pem`.

## Step 3: Load your schema and data into it

On your own computer, in your project folder, temporarily point `.env` at Aiven instead of your
local MySQL:

```
DB_HOST=<the Aiven host>
DB_PORT=<the Aiven port>
DB_USER=<the Aiven user>
DB_PASSWORD=<the Aiven password>
DB_NAME=eleczz
DB_SSL=true
DB_SSL_CA=C:\projects\eleczz\aiven-ca.pem
```

Then run, exactly as usual:

```bash
npm run setup-db
npm run seed
```

If this succeeds, your cloud database now has every table, view, trigger, procedure, and the demo
account — the same as your local one.

## Step 4: Deploy the app on Render

1. Go to Render, sign up (no card required for the free plan), and connect your GitHub account.
2. **New → Web Service** → pick your `eleczz-software` repository.
3. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment**, add these variables (same values as Step 3, plus two more):
   ```
   NODE_ENV=production
   DB_HOST=<the Aiven host>
   DB_PORT=<the Aiven port>
   DB_USER=<the Aiven user>
   DB_PASSWORD=<the Aiven password>
   DB_NAME=eleczz
   DB_SSL=true
   JWT_SECRET=<a long random value — generate one locally with the node -e command from .env.example>
   ```
   Do **not** set `PORT` — Render sets this automatically and the app already reads it.
5. For the CA certificate, use Render's **Secret Files** feature: add a secret file at, say,
   `/etc/secrets/aiven-ca.pem` with the certificate's contents pasted in, then add one more
   environment variable: `DB_SSL_CA=/etc/secrets/aiven-ca.pem`.
6. Click **Deploy**. Watch the build log; it should end with
   `ELECZZ Software is running: http://localhost:<port>`.
7. Render gives you a URL like `https://eleczz-software.onrender.com`. Open it, wait for the cold
   start if it's the first visit in a while, and log in as `demo@eleczz.com` / `Demo@123`.

## Step 5: Before you send the link to anyone

* Visit the link yourself first, so it's already "awake."
* Consider changing the demo password (`UPDATE users SET password_hash = ... WHERE email =
  'demo@eleczz.com'` with a new bcrypt hash) since the current one is published in your own README.
* Every push to your GitHub `main` branch will redeploy automatically — check the Render dashboard
  after any change to confirm the deploy succeeded.

## If it doesn't work

Copy the exact error from Render's deploy log or from the browser, and the step you were on, and
share both — the specific wording matters for diagnosing a cloud dashboard that may look different
from what's described here.
