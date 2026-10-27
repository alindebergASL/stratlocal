# Running it on a box

One small EC2 instance, Docker Compose, Caddy for the certificate, a nightly
snapshot to S3. Two users, one SQLite file, no cluster.

The first AWS deployment has built and served the image over HTTPS, verified
both logins, and restored S3 snapshots into fresh volumes. A plain Opus 5
provider ping answered, but its real structured calls rejected
`output_config.format` with HTTP 400, including a minimal schema. Access
and a successful ping therefore do not establish structured-output support.

The Bedrock default is now `us.anthropic.claude-opus-4-6-v1`, whose native
structured-output support is documented by AWS. Preserve the schema and
semantic checks: no prompt-only fallback is introduced. Verify a real
structured workflow on each deployment; mocked SDK tests cannot prove model
capability. Direct Anthropic web research remains a separate, optional setup.

## Before the first deploy

1. **An instance.** t3.small, 20 GB. Security group: 80 and 443 open, 22 from
   your address only.
2. **DNS.** An A record for `APP_HOSTNAME` pointing at it, *before* the first
   `up` — Caddy asks for the certificate on boot and a name that does not
   resolve yet means a failure it will back off from.
3. **An instance role**, because no AWS keys go in any file:
   - `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the
     model ARN you are going to use
   - `s3:PutObject` and `s3:GetObject` on the backup prefix, `s3:ListBucket` on
     the bucket. `GetObject` is not decoration: the backup reads the object
     back after writing it, because an upload that returns 200 and a lifecycle
     rule that deletes it an hour later both exit zero.
4. **Raise the instance metadata hop limit to 2.** This is the one that will
   waste your afternoon. The role is delivered over IMDSv2, whose default
   response hop limit is 1 — and a container on the default Docker bridge is
   one hop further out, so *nothing inside a container can see the role at
   all*. Bedrock and S3 both fail, and the error reads like an IAM problem
   rather than a networking one.

   ```sh
   aws ec2 modify-instance-metadata-options \
     --instance-id i-xxxxxxxx --http-tokens required \
     --http-put-response-hop-limit 2 --http-endpoint enabled
   ```

   It takes effect immediately; no restart. Check it from inside the app
   container with **Check providers** on Home, or
   `docker compose -f deploy/compose.yml exec web node -e "fetch('"'"'http://169.254.169.254/latest/api/token'"'"',{method:'"'"'PUT'"'"',headers:{'"'"'x-aws-ec2-metadata-token-ttl-seconds'"'"':'"'"'60'"'"'}}).then(r=>console.log(r.status))"` — 200 means the role is reachable.
5. **Model access.** Enable the Anthropic models in the Bedrock console for
   that region. The default is `us.anthropic.claude-opus-4-6-v1`, a US inference
   profile, not global routing. Use Bedrock Runtime Invoke: Mantle rejects the
   `output_config.format` used by structured calls. The instance role needs
   access to the inference profile and its destination-region model ARNs.
   **Check providers** on Home is what proves the id you chose
   actually answers; do that before trusting any button. Its third line,
   "Ask, streamed, with its tools", sends every tool Ask uses and has the
   model call one over a stream, so it proves tool calls and the
   response-stream permission work too. (`npm run
   smoke:providers` is the same check for local development — it runs through
   tsx, which the deployment image does not carry.)
6. **`deploy/.env`**, from `deploy/.env.example`. It is gitignored.

## The first thing to open

**`/setup`**, linked from Home as "Is everything wired up?". One verdict per
thing this deployment depends on, read live rather than from anything the app
wrote down:

- The path `DB_PATH` actually resolved to — the day-one mistake that costs the
  most, because its default is relative to the working directory and under the
  standalone server that is inside the image. The page says so in those words.
- Whether the data and uploads directories are writable, whether WAL is on, how
  many migrations ran, and whether there is anyone who can sign in at all.
- What day the app thinks it is, in which timezone, and which fiscal quarter
  that makes it. Wrong here and every "overdue" in the app is wrong with it.
- Whether each provider is configured, and whether every configured model has a
  price — an unpriced model records no cost, which sums to zero against the
  daily cap, so the budget silently stops existing.
- Whether `APP_HOSTNAME` matches the host requests are arriving on. A mismatch
  renders every page perfectly and returns 403 from every single form submit,
  which is the most confusing failure in the whole deployment.
- The newest object under `BACKUP_S3_URI` and how old it is, read from S3. True
  even when the backup container has been failing quietly for a week.

A provider error that this recognises is prefixed with what it actually means
before the SDK's own message — an `AccessDeniedException` that is really a model
ARN naming the wrong region, a credentials timeout that is really the hop limit
above, a `ValidationException` that is really a bare model id where the region
wants an inference profile.

## Deploying

```sh
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/compose.yml logs -f proxy    # watch the certificate
```

Later deploys are `git pull` and the same command.

What a release has looked like in practice since the first one, none of it a
script and all of it worth keeping: a fresh backup taken while the app is
quiet, *before* the pull, because migrations run at boot; that backup restored
into a scratch volume with the exact image about to ship, and opened — the
only thing that proves a backup is reading it back; `/setup` read before and
after for the migration count, which is the one number that says what the
boot actually did; and both logins tried. Twice a merged change was held off
the box after this, because sitting down to do real work with the candidate
found something the acceptance tests had not. That hold is the point of the
rehearsal, not a failure of it.

**`APP_HOSTNAME` is baked into the build**, not just the environment: Next
reads it at build time for `serverActions.allowedOrigins`. Changing the
hostname means rebuilding, and skipping that gives you the confusing failure
where every page renders and every form submit returns 403.

## Checking it came up

```sh
curl -I https://$APP_HOSTNAME                     # headers, and a certificate
# Then sign in and use Check providers on Home (the image has no tsx).
```

The headers to expect are in `deploy/Caddyfile`: HSTS, a CSP that allows no
third-party script and no framing, `nosniff`, and `X-Robots-Tag: noindex`.
They are set there rather than in `next.config.ts` on purpose — the proxy sees
every response, including the ones Next does not generate.

Then import a report to exercise structured output (the provider check is
only a plain-text request), and watch the run's cost appear. If it says
*cost unknown for this model*, the rate for your `BEDROCK_MODEL_ID` is not
configured and the daily cap cannot measure the day — see `.env.example` for
the variable names. Compose forwards the current US Claude profile, direct
Claude research, and web-tool price variables from `deploy/.env.example`.
Leave rates blank until verified; a different model id needs matching price
variable names in Compose as well as the env file. `BACKUP_S3_URI` is passed
to both the backup service and web so `/setup` can inspect backup freshness.

## Backups, and the trap in the obvious version

`scripts/backup.mjs` runs in the `backup` container on a loop, writes a
snapshot under `data/backups`, and copies it to `BACKUP_S3_URI` when that is
set — through the AWS SDK, using the instance role.

The AWS SDK it uses is installed into `/app/scripts/node_modules` by the
Dockerfile rather than coming from the standalone output, because Next only
traces what the *app* imports and this script is not part of the app. That is
worth knowing before anyone tidies it away: without it the backup dies with
"Cannot find module" and nothing goes offsite.

It used to shell out to `aws s3 cp`, which this image does not install. The
failure mode is worth remembering because it is the shape most backup bugs
take: `spawnSync` returned ENOENT, `status` was `null`, `null !== 0`, and the
script died with *"aws s3 cp exited null"* every single night while every
snapshot stayed on the same disk as the database it was protecting. It never
once claimed success — it just failed in a way nobody was reading, at the only
thing it existed to do.

**Do not replace it with a copy of the .sqlite file.** SQLite runs in WAL mode
here, so committed data sits in `strategy.sqlite-wal` until a checkpoint. When
this was written the live database was 4 KB beside a 1.8 MB WAL, and a copy of
the database file alone did not merely lose recent writes — it restored a file
with *no tables in it at all*, and would have kept doing that nightly without
one error. The script uses `VACUUM INTO`, which asks SQLite for one consistent
file including the WAL, then opens the result, runs `integrity_check`, and
compares row counts against the source before it will write the archive.

On demand:

```sh
docker compose -f deploy/compose.yml run --rm backup node /app/scripts/backup.mjs
```

That command used not to work. The service ran its loop through
`entrypoint: ["/bin/sh","-c"]`, so the arguments above became
`sh -c node /app/scripts/backup.mjs` — `sh` took `node` as the whole command
and the path as `$0`, opened a REPL, read EOF, and **exited 0 having backed up
nothing**. The loop is a `command` now, which this overrides properly.

**Encrypted, and kept 30 days.** Every upload asks S3 to encrypt it at rest
(S3's own keys, or `BACKUP_S3_KMS_KEY` when you name a KMS key, in which case
the role also needs `kms:GenerateDataKey` and `kms:Decrypt` on it) and reads
the object back to confirm it is; an unencrypted copy fails the run. Add a
lifecycle rule on the bucket that expires the backup prefix after **30
days**: a snapshot holds up to 30 days of email bodies, so keeping snapshots
much longer keeps the email longer than the app promises. `/setup` shows the
encryption, how many snapshots there are and the oldest one's age, and warns
past 35 days.

## The scheduler

The `scheduler` service is a loop that asks the app every five minutes what
is due (DECISIONS #38). It needs one thing: `SCHEDULER_SECRET` in `.env`, any
random string of 32 characters or more (`openssl rand -hex 32`). The same value
reaches `web`, which refuses any knock without it, and the proxy refuses
`/api/internal/` from outside whatever the secret. Without it the loop logs why
and keeps trying, and the assistants run only when someone presses Run now.

Whether it is working is on the Assistants page: "The scheduler last checked
in at …". Monthly budgets start from `AI_MONTHLY_CAP_CENTS` and
`AI_PEOPLE_SHARE_CENTS`; once someone saves them on that page, the page wins.

## Calendars

`/calendar` reads customer meetings from calendars and offers them as meetings
to add (DECISIONS #42). Three sources, in any mix:

- **A published iCal link.** Nothing to set up on the box. In Outlook: Settings,
  Calendar, Shared calendars, Publish a calendar, ICS link. In Google: the
  calendar's settings, Secret address in iCal format. Read every 15 minutes.
- **Strategy's own Outlook mailbox** (e.g. `strategy@example.com`, a shared
  mailbox needs no licence). IT creates one Entra app registration with the
  Microsoft Graph *application* permission `Calendars.Read`, then restricts it
  to that mailbox (Exchange RBAC for Applications, or an Application Access
  Policy). Put its tenant, client id and secret in `MS_TENANT_ID`,
  `MS_CLIENT_ID`, `MS_CLIENT_SECRET`. People forward customer invites to the
  mailbox, or invite it.
- **A Google calendar shared with Strategy.** A Google Cloud project with the
  Calendar API on, and a service account with a key; put the key JSON (or its
  base64) in `GOOGLE_SERVICE_ACCOUNT_JSON`, then share the calendar with the
  service account's address ("See all event details").

For the last two, the box tells the provider to call
`https://APP_HOSTNAME/api/calendar/hook/<id>` when something changes, renews
that before it lapses, and still reads every 15 minutes in case a call is
missed. Each call must carry the channel's own secret, and only ever causes a
read. All of it needs the scheduler (`SCHEDULER_SECRET`).

## Email

Each person connects their own mailbox under **Settings → Connections**
(DECISIONS #102, #103). The box reads only mail with a customer on an
account, keeps bodies 30 days (cleared on every scheduler tick), and sends
only a draft its owner pressed Send on, from their own mailbox, after they
turned sending on.

- **Microsoft 365.** The same Entra app registration as calendars, with the
  Graph *application* permissions `Mail.Read`, `Mail.Send` and
  `Calendars.ReadWrite` (invites are written to the sender's calendar), admin
  consent granted, and restricted to the team's own mailboxes with Exchange
  RBAC for Applications or an Application Access Policy. Without the
  restriction the registration can read every mailbox in the tenant.
- **Google Workspace.** The same service account, with domain-wide delegation
  for its client id on the scopes `gmail.readonly`, `gmail.send`,
  `calendar.readonly` and `calendar.events`
  (`https://www.googleapis.com/auth/...`).

To prove it on one mailbox: connect it, press **Read now** (it says what it
kept or why it failed), turn sending on, press **Send myself a test**, and
send that draft from the Inbox under To send. `/setup` lists the providers,
how many mailboxes are connected and failing, and whether any body has
outlived 30 days.

`INTEGRATIONS_KEY` (`openssl rand -base64 32`) seals each person's Slack and
Teams webhook. Losing it means everyone reconnects; changing it does too.

## The team

`USER1_*` and `USER2_*` create the first one or two people on an empty
database, as admins; after that they are not read. Everyone else is added
under **Settings, Team** by an admin, with a first password you hand them and
they change there. Someone who leaves is turned off there: signed out at
once, unable to sign in, and their name kept on what they did. The same page
sets the app's name, the team's name, a logo and the colour decks use, and
each person's role in the playbook.

## Salesforce (optional)

Off until someone turns it on under Settings, Salesforce, and only usable
once the box has its credentials in `deploy/.env` (see `.env.example`):
either a connected app for the REST API (client-credentials flow, with a
run-as user limited to what the team may see) or a Salesforce MCP server
URL and token. Reads arrive as changes to review; the scorecard is written
to an opportunity only when someone presses send after seeing exactly what
will be written. Every read and write is listed on that page. Salesforce
data goes only between this box and your Salesforce, and to Bedrock as part
of an account's records; it is never sent to the web research API
(DECISIONS #78).

## Releasing Phases 2–9 (the agents release)

The first release in a while, and the largest: the Inbox, Today's briefing
and digest, the living account page, web research in Ask, reading and
sending email, the Plan area, the Writer, and this hardening.

1. **Back up first**, while it is quiet, and restore that backup into a
   scratch volume with the new image (below). Migrations run at boot.
2. **`deploy/.env`**: add `SCHEDULER_SECRET` (`openssl rand -hex 32`) and
   `INTEGRATIONS_KEY` (`openssl rand -base64 32`); optionally
   `BACKUP_S3_KMS_KEY`. Keep the Bedrock and S3 settings as they are.
3. **IT**: the Graph or Google permissions under Email above. Until they are
   granted, everything else works and Connections says mail is not available.
4. **S3**: the 30-day lifecycle rule on the backup prefix.
5. **Deploy** as usual. `/setup` should then show migrations through
   `047_written` (six new: `042_inbox`, `043_connections`, `044_account_seen`,
   `045_mail`, `046_outbound`, `047_written`), the scheduler checking in within
   five minutes, the connections key set, and the backup encrypted.
6. **Check providers** on Home, then sign in as each person.
7. **Assistants**: turn on what you want running. The Writer and Mail reader
   are off until someone turns them on; each has its own monthly limit inside
   the total.
8. **One mailbox each**: Read now, Send myself a test, Send (Email above).

**Rolling back** is the previous image plus the backup from step 1. The new
tables are additive, so the previous image runs against the new database,
but anything written since is only in the new tables; restore the backup if
you need the old state exactly.

## Restoring

Deliberately manual. Stopping the app and moving a file is a thing to do on
purpose.

```sh
docker compose -f deploy/compose.yml stop web
docker compose -f deploy/compose.yml run --rm -v "$PWD:/restore" backup sh -c '
  cd /tmp && tar -xzf /restore/strategy-TIMESTAMP.tar.gz &&
  cp /tmp/strategy.sqlite /app/data/strategy.sqlite &&
  rm -f /app/data/strategy.sqlite-wal /app/data/strategy.sqlite-shm &&
  cp -r /tmp/docs/. /app/data/docs/ 2>/dev/null || true'
docker compose -f deploy/compose.yml start web
```

The `-wal` and `-shm` removal matters: leaving the old ones beside a restored
database is how you get a file that opens and then disagrees with itself.

**Do a restore drill before you need one.** Restore into a scratch directory,
point a local `DB_PATH` at it, and count what came back — that is the only
thing that proves a backup, and it is what caught the WAL problem above.

## What this does not do

GitHub Actions CI runs privacy, typecheck, unit tests, a build, and fake-AI
browser flows; it does not deploy or verify live providers. No blue/green,
no log shipping, no metrics. A restart loses any AI run
that was in flight (it is marked failed on boot and the searches are spent).
The build needs egress to `fonts.googleapis.com`, because `next/font/google`
downloads Archivo and Inter at build time and self-hosts them — the running
container needs no such access.
