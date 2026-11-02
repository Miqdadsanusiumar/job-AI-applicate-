# Jobpilot

Jobpilot is an approval-first job-search application. It supports email-link authentication, private profiles and resumes, Greenhouse and Lever public job boards, deterministic profile matching, scheduled scans, and opt-in email alerts. It never submits an application or contacts an employer.

## Recommended setup in plain language

Three services work together: **Supabase** stores your private profile and signs you in, **Resend** sends email notifications, and **Vercel** hosts the website. The public GitHub repository runs the free 30-minute schedule. You must create the Supabase project and verify a sender domain in Resend before the matching and emails can work.

### A. Create the private database and sign-in (Supabase)

1. Sign in at [supabase.com](https://supabase.com) and create a project. Save its database password in your password manager.
2. In **Project Settings → API Keys**, copy the **Project URL**, the **publishable key**, and the **service_role secret key**. The service-role key grants administrator access: keep it private and put it only in Vercel's encrypted settings.
3. Open **SQL Editor → New query**, paste the full contents of [`supabase/migrations/202611020001_initial_schema.sql`](./supabase/migrations/202611020001_initial_schema.sql), and run it once. It creates private profile, job, and resume storage with per-account access protections.
4. In **Authentication → URL Configuration**, add `https://online-job-applicant.vercel.app/auth/callback` to the redirect URLs after the first Vercel deploy. Also add `http://localhost:3000/auth/callback` for local testing.

### B. Set up email (Resend)

1. Sign in at [resend.com](https://resend.com) and verify a sender domain that you own. Resend will ask you to add DNS records at your domain provider.
2. Create an API key in **API Keys**. Use a sender such as `Jobpilot <alerts@your-verified-domain.example>` for `RESEND_FROM_EMAIL`; replace the example with an address on your verified domain.

### C. Add service settings to Vercel

In Vercel, open the **online-job-applicant** project → **Settings → Environment Variables** → **Add Environment Variable**. Add the following name/value pairs and select **Production** (and Preview if you want preview deployments):

| Name | The value to copy |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role **secret** key |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | Sender address on the domain verified with Resend |
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

Copy `.env.example` to `.env.local` and fill it in from Supabase and Resend. The service-role key, Resend key, and cron secret are server-only. Never prefix them with `NEXT_PUBLIC_` or commit them.

```bash
npm install
npm run dev
```

Sign in using the verified email address where you want alerts. In **Preferences**, add the company's Greenhouse or Lever board slug, enable scans and email alerts in your profile, and send a test email to verify Resend delivery.

## Required accounts and configuration

### 1. Supabase

1. Create a Supabase project and enable email authentication. Keep email confirmation enabled.
2. In **Project Settings → API**, copy the Project URL and the publishable key. Keep the service-role key private.
3. Run [`supabase/migrations/202611020001_initial_schema.sql`](./supabase/migrations/202611020001_initial_schema.sql) in the Supabase SQL editor. It creates row-level security policies, private resume storage, notification rate limits, and the scan cursor.
4. Add your local and production app URLs to the Supabase Auth redirect allowlist, including `/auth/callback`.

### 2. Resend

1. Verify a sender domain in Resend and create an API key.
2. Configure the sender in `RESEND_FROM_EMAIL`, for example `Jobpilot <alerts@your-verified-domain.example>`.
3. To have Supabase sign-in links use the same deliverability setup, configure Supabase Auth's custom SMTP using the Resend SMTP credentials. Do not put SMTP or API credentials in browser code.

### 3. Local development

Copy `.env.example` to `.env.local` and fill in the values from the services above:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
CRON_SECRET=
```

Generate a strong cron secret, for example with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The Supabase service-role key, Resend key, and cron secret are server-only. Never prefix them with `NEXT_PUBLIC_`, commit them, or paste them into chat.

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Sign in using the verified email address where you want alerts. In **Preferences**, add the company's Greenhouse or Lever board slug, enable scans and email alerts in your profile, and send a test email to verify Resend delivery.

## Job sources and matching

- Greenhouse boards use their public board API; Lever boards use their public postings API.
- Add only public board slugs belonging to the company career page. The source URL is constructed from a fixed provider host; arbitrary URLs are not accepted.
- A scan checks up to 20 sources per run, in rotating batches, and deduplicates results by user, board, and external job ID. GitHub Actions calls the protected scanner every 30 minutes.
- Matching is deterministic keyword overlap across target-role terms, skills, and preferred location. It is not an AI judgment, and the score is a heuristic—not a guarantee of suitability.
- LinkedIn automation and automatic application submission are intentionally not implemented. Review listings at the employer site and decide what to submit yourself.

## Deploy and verify

The Vercel project `online-job-applicant` is connected to the public repository. After pushing code to `main`, Vercel builds and deploys the app. Add the Supabase and Resend settings before signing in, apply the database migration, then add the two GitHub Actions settings above. Finally, sign in, add a board, enable scans and email alerts in your profile, send a test email, and trigger one manual scan from GitHub Actions.

The scanner uses a bounded source batch and persists its cursor to avoid starving later boards. Monitor GitHub Actions and Vercel function logs for failures.

## Security and privacy

- Supabase Auth sessions use secure server-managed cookies. Server routes verify the current user, and database row-level security scopes profile, board, and match access to that user.
- Resume uploads are private, limited to PDF/Word files up to 5 MB, and stored under the signed-in user's storage path.
- Email is sent only to the verified sign-in email, and only after the user enables alerts. Test email requests are rate limited. The scanner uses a server-only service role and a timing-safe cron-secret check; notification delivery is idempotent and queued transactionally with new matches.
- No profile or resume is sent to GPT or another AI service by this MVP.
- Application approval records the user's decision only; no external application is submitted.

## Verification

```bash
npm run lint
npm run build
npm audit --omit=dev
```
