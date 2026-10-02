# Deploy ELECZZ with Render and Aiven

Use this guide to publish ELECZZ at a shareable `onrender.com` address. Aiven hosts the MySQL
database; Render hosts the Node.js/Express application and the files in `public/`.

**Done when:** the Render deployment log says `ELECZZ Software is running`, the public URL opens,
and a record created in the app remains after a page refresh.

## Before you start

You need:

- the ELECZZ repository in your GitHub account;
- Node.js 18 or newer and npm on your computer;
- an [Aiven](https://console.aiven.io/) account; and
- a [Render](https://dashboard.render.com/) account connected to GitHub.

The free plans are suitable for a portfolio or student demonstration, not a production business.
A Render free web service sleeps after 15 minutes without traffic, so its first response after a
quiet period can take about a minute. Aiven can power off an inactive free database after warning
you by email.

Never commit `.env`, database passwords, or `JWT_SECRET` to Git. The repository's `.gitignore`
already excludes `.env`.

## 1. Put the project on GitHub

Skip this section if the project is already in your GitHub account.

If you downloaded someone else's repository, fork it on GitHub. If this is a new local repository,
run the following commands from the project directory, replacing `YOUR-USERNAME`:

```bash
git init
git add .
git commit -m "Add ELECZZ application"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/eleczz-software.git
git push -u origin main
```

Before pushing, verify that Git is not tracking local secrets:

```bash
git status --short
git ls-files .env "*.pem"
```

The second command should print nothing. Keep the downloaded Aiven certificate outside the
repository, or add its exact filename to `.gitignore`.

## 2. Create the Aiven MySQL service

1. Sign in at [Aiven Console](https://console.aiven.io/).
2. Create an organization and project if prompted.
3. Open **Services** and select **Create service**.
4. Select **MySQL**.
5. Select the **Free** service tier and an available location.
6. Name the service `eleczz-mysql`.
7. Select **Create service**.
8. Wait until the service status is **Running**.

Free-tier availability and console labels can change. See Aiven's
[current free-tier limits](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier).

### Create the application database

1. Open the new MySQL service.
2. Open **Databases** under **Connect**.
3. Select **Create database**.
4. Enter `eleczz` and confirm.

Aiven may also provide a database named `defaultdb`. This project uses `eleczz`.

### Save the connection information

On the service **Overview** page, open **Quick connect** or locate **Connection information**. Save
the following values temporarily:

| Aiven value | ELECZZ setting |
|---|---|
| Host | `DB_HOST` |
| Port | `DB_PORT` |
| User, normally `avnadmin` | `DB_USER` |
| Password | `DB_PASSWORD` |
| Database | `DB_NAME=eleczz` |

Do not use `localhost` for `DB_HOST`.

### Download the CA certificate

Download the **CA certificate** from the Aiven connection information and save it as
`aiven-ca.pem` outside the Git repository. Example locations:

```text
macOS:   /Users/yourname/Downloads/aiven-ca.pem
Windows: C:/Users/yourname/Downloads/aiven-ca.pem
```

The CA certificate lets the application verify Aiven's identity while using an encrypted MySQL
connection.

## 3. Initialize the cloud database once

Run this section on your computer. Do not add database setup or seeding commands to Render's build
command; doing so would rerun them on every deployment.

Install the project dependencies:

```bash
npm install
```

Create your local environment file.

macOS or Linux:

```bash
cp .env.example .env
```

Windows Command Prompt:

```bat
copy .env.example .env
```

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Open `.env` and enter the Aiven values. Use the full path to the downloaded certificate:

```dotenv
PORT=3000
NODE_ENV=development

DB_HOST=YOUR-AIVEN-HOST
DB_PORT=YOUR-AIVEN-PORT
DB_USER=avnadmin
DB_PASSWORD="YOUR-AIVEN-PASSWORD"
DB_NAME=eleczz

DB_SSL=true
DB_SSL_CA=/full/path/to/aiven-ca.pem

JWT_SECRET=PASTE-THE-GENERATED-SECRET-HERE
```

On Windows, a forward-slash path such as `C:/Users/yourname/Downloads/aiven-ca.pem` avoids escaping
problems.

Create the tables, views, triggers, procedures, functions, warehouse tables, and ETL routines:

```bash
npm run setup-db
```

The command should finish with `Database "eleczz" is ready.` Some informational output about the
disabled nightly event is normal.

### Optional: load demonstration data

```bash
npm run seed
```

This creates `demo@eleczz.com` with password `Demo@123`. Those credentials are public in the
README, so anyone could change the demo account's data. For a public site, either skip seeding and
create your own account or treat the seeded account as disposable.

### Test the cloud database locally

```bash
npm start
```

Open <http://localhost:3000>, sign in or create an account, and confirm that the dashboard loads.
Stop the server with `Ctrl+C`.

## 4. Create the Render web service

1. Sign in at [Render Dashboard](https://dashboard.render.com/).
2. Connect your GitHub account and grant Render access to the ELECZZ repository.
3. Select **New** > **Web Service**.
4. Select `eleczz-software` and choose **Connect**.
5. Enter these settings:

| Setting | Value |
|---|---|
| Name | `eleczz-software` or another available name |
| Language/Runtime | `Node` |
| Branch | `main` |
| Root Directory | leave empty |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Compute/Instance | `Free` |

6. Choose the Render region closest to the Aiven service when possible.
7. Create the web service.

Choose **Web Service**, not **Static Site**. ELECZZ requires the Express server for authentication,
API routes, and database access.

The first deployment can fail with a missing `JWT_SECRET` or database error before you finish the
next section. That is expected.

## 5. Configure Render's environment

Open the Render service and select **Environment**. Add these variables manually:

```text
NODE_ENV=production
DB_HOST=YOUR-AIVEN-HOST
DB_PORT=YOUR-AIVEN-PORT
DB_USER=avnadmin
DB_PASSWORD=YOUR-AIVEN-PASSWORD
DB_NAME=eleczz
DB_SSL=true
DB_SSL_CA=/etc/secrets/aiven-ca.pem
JWT_SECRET=YOUR-LONG-RANDOM-SECRET
```

Important details:

- Copy the host, port, user, and password exactly from Aiven.
- Enter the Render password value without the `.env` quotation marks.
- `JWT_SECRET` must contain at least 32 characters and must not start with `replace_me`.
- Do not set `PORT`; Render supplies it automatically, and `server.js` already reads it.

### Add the Aiven certificate as a Render secret file

1. On the same **Environment** page, find **Secret Files**.
2. Select **Add Secret File**.
3. Set the filename to `aiven-ca.pem`.
4. Open the downloaded certificate in a text editor.
5. Paste everything from `-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----` into
   the contents field.
6. Save the secret file.

Render exposes that file at `/etc/secrets/aiven-ca.pem`, matching `DB_SSL_CA` above.

Select **Save, rebuild, and deploy** after all variables and the secret file are present. Render's
[environment and secret-file documentation](https://render.com/docs/configure-environment-variables)
shows the current dashboard workflow.

## 6. Verify the deployment

Open the service's **Logs** page. A successful startup ends with a line similar to:

```text
ELECZZ Software is running: http://localhost:10000
```

`localhost` in this message is normal. Render forwards the public address to the application's
port.

Open the public URL shown by Render, for example:

```text
https://eleczz-software.onrender.com
```

Verify all of the following:

- the sign-up or login screen loads;
- you can sign in or create an account;
- the dashboard loads without an API error;
- you can create a customer or product; and
- the new record remains after refreshing the page.

Every later push to the configured GitHub branch should trigger a new Render deployment. The data
remains in Aiven across application deployments.

## Troubleshooting

### `JWT_SECRET is missing, too short, or still the placeholder`

Generate a new secret, add it under Render **Environment**, and redeploy:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### `ENOENT ... /etc/secrets/aiven-ca.pem`

The certificate filename or path does not match. Use exactly:

```text
Secret filename: aiven-ca.pem
DB_SSL_CA: /etc/secrets/aiven-ca.pem
```

### `Unknown database 'eleczz'`

Create `eleczz` in the Aiven console, point your local `.env` at Aiven, and rerun:

```bash
npm run setup-db
```

### `Access denied for user`

Copy the current Aiven username and password again. Use the default `avnadmin` account while running
`setup-db`, because database initialization needs permission to create views, triggers, routines,
functions, and an event.

### `ECONNREFUSED`, timeout, or database connection failure

Check that the Aiven service is **Running**, `DB_HOST` is not `localhost`, the host and port match
Aiven's connection information, and `DB_SSL=true` is present.

### The website loads but reports are empty

The database may be initialized without data. Either create records in the application or run the
optional seed command locally while `.env` points to Aiven:

```bash
npm run seed
```

### The first request takes a long time

Render's free web service sleeps after 15 minutes without inbound traffic and wakes on the next
request. Open the site a few minutes before sharing it. See Render's
[free-service limits](https://render.com/docs/free).

## Final safety check

Before sharing the deployment, run:

```bash
git status --short
git ls-files .env "*.pem"
```

Confirm that `.env` and certificate files are not tracked. Then open the Render URL one final time,
check the deployment logs for errors, and verify that a saved record survives a refresh.
