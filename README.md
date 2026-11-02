# Jobpilot

Jobpilot is an approval-first job-search application. It supports email-link authentication, private profiles and resumes, Greenhouse and Lever public job boards, deterministic profile matching, scheduled scans, and opt-in email alerts. It never submits an application or contacts an employer.

## Recommended setup in plain language

Three services work together: **Supabase** stores your private profile and signs you in, **Gmail** sends low-volume personal notifications, and **Vercel** hosts the website. The public GitHub repository runs the free 30-minute schedule. A custom sending domain is not required for this Gmail setup.

### A. Create the private database and sign-in (Supabase)

1. Sign in at [supabase.com](https://supabase.com) and create a project. Save its database password in your password manager.
2. In **Project Settings → API Keys**, copy the **Project URL**, the **publishable key**, and the **service_role secret key**. The service-role key grants administrator access: keep it private and put it only in Vercel's encrypted settings.
3. Open **SQL Editor → New query**, paste the full contents of [`supabase/migrations/202611020001_initial_schema.sql`](./supabase/migrations/202611020001_initial_schema.sql), and run it once. It creates private profile, job, and resume storage with per-account access protections.
4. In **Authentication → URL Configuration**, add the current Vercel deployment URL plus `/auth/callback` to the redirect URLs. Also add `http://localhost:3000/auth/callback` for local testing.

### B. Set up free personal email (Gmail)

Jobpilot sends personal notifications through a small Google Apps Script that uses your Gmail account. This avoids buying a domain and avoids SMTP connections from Vercel.

1. Sign in to [script.google.com](https://script.google.com) with the Gmail account where you want Jobpilot alerts. This must be the same email address you use to sign in to Jobpilot. Create a new project named `Jobpilot Mailer`.
2. Replace the editor contents with [`scripts/google-apps-script.gs`](./scripts/google-apps-script.gs) and save.
3. Open **Project Settings → Script properties** and add:
   - `JOBPILOT_TOKEN`: a new random secret generated locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it private.
   - `ALLOWED_RECIPIENT`: the same Gmail address you will use to sign in to Jobpilot. The mailer refuses other recipients.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then deploy. Authorize the requested Gmail permission. Copy the deployment URL ending in `/exec`; do not use a `/dev` URL.
5. Gmail is intended here for low-volume personal alerts. Google applies sending quotas, and this setup is not intended for bulk mail. Supabase sign-in email delivery is a separate service and keeps using Supabase's configured auth email provider.

### C. Add service settings to Vercel

In Vercel, open the **online-job-applicant** project → **Settings → Environment Variables** → **Add Environment Variable**. Add the following name/value pairs and select **Production** (and Preview if you want preview deployments):

| Name | The value to copy |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role **secret** key |
| `GMAIL_WEB_APP_URL` | The deployed Google Apps Script URL ending in `/exec` |
| `GMAIL_WEB_APP_TOKEN` | The same private random token stored as `JOBPILOT_TOKEN` in Apps Script |
| `CRON_SECRET` | A new random secret; generate it locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

These are not new accounts. They are the connection settings Vercel needs to make the app work. Never paste their values into chat or put them in a public GitHub file. After saving or changing them, redeploy so the new settings take effect.

### D. Turn on the 30-minute schedule

The Vercel project is on the Hobby plan, which only permits a daily Vercel Cron. This repository therefore uses GitHub Actions for the requested 30-minute schedule instead. GitHub scheduled runs are best-effort and can be delayed during busy periods.

In the public GitHub repository **job-AI-applicate-**:

1. Open **Settings → Secrets and variables → Actions → Variables → New repository variable**. Add `JOBPILOT_APP_URL` with the deployed URL, for example `https://online-job-applicant.vercel.app` (no trailing slash).
2. In **Settings → Secrets and variables → Actions → Secrets → New repository secret**, add `CRON_SECRET` with the exact same random value you added to Vercel.
3. After the code is pushed to the repository's `main` branch, GitHub Actions will run the scan on the hour and half-hour. You can also use **Actions → Scan job boards → Run workflow** to test a run.

If GitHub's scheduled-run reliability is not sufficient, move scheduling to a dedicated queue/scheduler or use a Vercel plan that supports more frequent Vercel Cron jobs.

## Local development

Copy `.env.example` to `.env.local` and fill it in from Supabase and Google. The service-role key, Gmail mailer token, and cron secret are server-only. Never prefix them with `NEXT_PUBLIC_` or commit them.

```bash
npm install
npm run dev
```

Sign in using the verified email address where you want alerts. In **Preferences**, add the company's Greenhouse or Lever board slug, enable scans and email alerts in your profile, and send a test email to verify Gmail delivery.

## Required accounts and configuration

### 1. Supabase

1. Create a Supabase project and enable email authentication. Keep email confirmation enabled.
2. In **Project Settings → API**, copy the Project URL and the publishable key. Keep the service-role key private.
3. Run [`supabase/migrations/202611020001_initial_schema.sql`](./supabase/migrations/202611020001_initial_schema.sql) in the Supabase SQL editor. It creates row-level security policies, private resume storage, notification rate limits, and the scan cursor.
4. Add your local and production app URLs to the Supabase Auth redirect allowlist, including `/auth/callback`.

### 2. Gmail email delivery

Follow section **B** above to deploy the Apps Script mailer. The allowed recipient must be the same verified email address used to sign in to Jobpilot. Keep the token secret and only configure it in Apps Script properties and Vercel.

### 3. Local development

Copy `.env.example` to `.env.local` and fill in the values from the services above:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GMAIL_WEB_APP_URL=
GMAIL_WEB_APP_TOKEN=
CRON_SECRET=
```

Generate strong random tokens, for example with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The Supabase service-role key, Gmail mailer token, and cron secret are server-only. Never prefix them with `NEXT_PUBLIC_`, commit them, or paste them into chat.

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Sign in using the verified email address where you want alerts. In **Preferences**, add the company's Greenhouse or Lever board slug, enable scans and email alerts in your profile, and send a test email to verify Gmail delivery.

## Job sources and matching

- Greenhouse boards use their public board API; Lever boards use their public postings API.
- Add only public board slugs belonging to the company career page. The source URL is constructed from a fixed provider host; arbitrary URLs are not accepted.
- A scan checks up to 20 sources per run, in rotating batches, and deduplicates results by user, board, and external job ID. GitHub Actions calls the protected scanner every 30 minutes.
- Matching is deterministic keyword overlap across target-role terms, skills, and preferred location. It is not an AI judgment, and the score is a heuristic—not a guarantee of suitability.
- LinkedIn automation and automatic application submission are intentionally not implemented. Review listings at the employer site and decide what to submit yourself.

## Deploy and verify

The Vercel project `online-job-applicant` is connected to the public repository. After pushing code to `main`, Vercel builds and deploys the app. Add the Supabase and Gmail settings before signing in, apply the database migration, then add the two GitHub Actions settings above. Finally, sign in, add a board, enable scans and email alerts in your profile, send a test email, and trigger one manual scan from GitHub Actions.

The scanner uses a bounded source batch and persists its cursor to avoid starving later boards. Monitor GitHub Actions and Vercel function logs for failures.

## Security and privacy

- Supabase Auth sessions use secure server-managed cookies. Server routes verify the current user, and database row-level security scopes profile, board, and match access to that user.
- Resume uploads are private, limited to PDF/Word files up to 5 MB, and stored under the signed-in user's storage path.
- Email is sent only to the verified sign-in email, and only after the user enables alerts. Test email requests are rate limited. The scanner uses a server-only service role and a timing-safe cron-secret check; notifications are queued transactionally with new matches. Gmail does not provide provider-side idempotency through this mailer, so a rare retry after a send/database update failure may send a duplicate.
- No profile or resume is sent to GPT or another AI service by this MVP.
- Application approval records the user's decision only; no external application is submitted.

## Verification

```bash
npm run lint
npm run build
npm audit --omit=dev
```
