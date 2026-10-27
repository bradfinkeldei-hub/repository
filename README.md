# The Coaching Circle

A group life coaching app. Members sign in, share their life wheel, what they're creating, what they're accountable to and their mission, and see only their own team. The coach sees every team (Monday, Tuesday, Wednesday, Thursday) from a left column, gets a Coaches actions list across all teams, invites and moves members, and offers one free call a month ($150 after).

Built with Next.js, Supabase (database, sign-in and access rules) and Gmail for weekly reminder emails. It runs on Cloudflare Workers through the OpenNext adapter, on the free plan.

## How access works

Team-only access is enforced in the database, not just hidden on screen (`supabase/migrations/0001_init.sql`):

- The coach can read and change everything.
- A member can read profiles on their own team only, and edit only their own.
- Members can't change their own team or role, and can't see anyone's email.
- Sign-in is invite only. Someone who signs in without an invite has no team and sees only themselves until the coach puts them on one.

`npm run test:db` runs 14 checks of these rules against a real Postgres.

## Setting it up

### 1. Supabase

1. Create a free project at supabase.com.
2. In **SQL Editor**, run `supabase/migrations/0001_init.sql`, then make yourself the coach:
   ```sql
   insert into app_settings (key, value) values ('coach_email', 'your-email@example.com');
   ```
   Do this before you first sign in. That email becomes the coach account.
3. **Authentication > URL Configuration**: set Site URL to the app's address (for example `https://app.sparkzofcourage.com`) and add `https://app.sparkzofcourage.com/**` to Redirect URLs.
4. **Authentication > Email Templates**: change the link in three templates so it comes back through the app.
   - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (new members then choose a password)
   - Magic link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
5. **Authentication > Providers**: turn on Google (needs a Google Cloud OAuth client; Supabase links to the steps). Microsoft is the `azure` provider. Apple needs a paid Apple developer account, so start with Google and email links.
6. **Authentication > Sign In / Providers**: after you've signed in once as the coach, turn off "Allow new users to sign up". Invites still work.
7. Supabase's built-in email is rate limited. For more than a few invites an hour, set **Authentication > SMTP Settings** to the same Gmail app password as below.

### 2. Gmail for reminders

Turn on 2-Step Verification on the Google account, then create an app password (Google account > Security > App passwords). That password goes in `SMTP_PASS`. Never share it in chat.

### 3. Cloudflare

1. Put this code in a GitHub repository.
2. In the Cloudflare dashboard go to **Workers & Pages > Create > Import a repository**, pick the repository, and name the Worker `coaching-circle` (it must match `name` in `wrangler.jsonc`).
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
   - Build variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Next.js bakes these into the pages at build time.
3. After the first deploy, open the Worker's **Settings > Variables and Secrets** and add the runtime settings listed in `.env.example`. Add keys and passwords as type **Secret**. Then redeploy (Deployments > Retry, or push a commit).
4. The app is at `https://coaching-circle.<your-account>.workers.dev`. Put that in `SITE_URL` and in Supabase's Site URL. A custom domain such as `app.sparkzofcourage.com` needs the domain's DNS on Cloudflare (free); add it under the Worker's **Settings > Domains & Routes**.

Reminders run once a day from `triggers` in `wrangler.jsonc`. The time is in UTC: `0 13 * * *` is 8am Central during daylight time and 7am in winter. Each member picks their reminder day on their profile and gets at most one email a week. The job lives in `worker/reminders.ts` and runs outside Next.js, because sending through Gmail uses Cloudflare's TCP sockets. Results show in the Worker's **Logs**.

The free Workers plan allows 100,000 requests a day and 10 ms of CPU per request, which suits a coaching group. If pages ever fail with a "CPU time limit" error, the Workers Paid plan ($5 a month) lifts it.

### Booking links

`FREE_CALL_URL` and `PAID_CALL_URL` are your scheduling links (Calendly, Google Calendar appointment pages and similar). The paid link should take payment, for example a Calendly event with Stripe or a Stripe payment link. A member's free call is counted when they click through to book; you can give one back from **Add or manage members**.

## Working on it

```sh
npm install
cp .env.example .env.local   # fill in
cp .env.example .dev.vars    # same values, for the Cloudflare preview
npm run dev       # Next.js dev server
npm run preview   # the real Cloudflare build, locally
npx wrangler dev --test-scheduled   # then open /__scheduled to run reminders
npm test          # week, time zone and coach action rules
npm run test:db   # database access rules
npm run typecheck
```
