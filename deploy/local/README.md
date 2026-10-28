# StrategyLocal: Mac setup, with verification at each step

Use this guide for the local Docker installation. MyAgent is used separately; **Bedrock, AWS credentials, and an AI subscription are not required**. Optional models come after the basic app works.

The application and browser workflow were tested in Linux. Compose configuration and non-root secret-file access have also been checked in Linux. **The complete Docker Desktop installation, native Apple model, and Keychain flow have not been run on a Mac.** The checks below establish what works on your machine; stop at a failed check instead of assuming the next step will work. See [validation details](VALIDATION.md).

## 1. Verify the Mac and Docker Desktop

Open Terminal and run these separately:

```sh
sw_vers
uname -m
git --version
docker compose version
docker context show
docker info
```

- `sw_vers` must identify macOS. `uname -m` identifies your architecture; do not assume Apple silicon.
- If Git is missing, run `xcode-select --install`, complete the macOS dialog, then retry `git --version`.
- If Docker is missing, install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) for the architecture you just checked. Open Docker Desktop and wait for its engine to start, then retry the Docker commands.
- `docker compose version` must report Compose v2. `docker info` must succeed against **your local Docker Desktop engine**, not a remote Docker context. If unsure which engine is selected, check Docker Desktop and `docker context ls` before continuing.

Internet is needed for the initial image/dependency downloads. Node is included in the app image; **you do not need host Node for the base installation**. Check the engine's CPU count explicitly:

```sh
docker info --format '{{.NCPU}}'
```

The app defaults to a 2-CPU limit; the maintenance worker has a 1-CPU limit. These are per-container ceilings, not dedicated CPU reservations. If the engine reports only 1 CPU, set `APP_CPU_LIMIT=1` in `deploy/local/.env`. Any custom `APP_CPU_LIMIT` must not exceed the reported count. The earlier hardcoded 4-CPU app limit prevented container creation on 2-CPU Docker Desktop installations; updating the checkout fixes that default without rebuilding the image.

The Compose configuration caps the app at 3,500 MiB and the maintenance worker at 512 MiB; build memory needs are not measured. If Docker reports out-of-memory errors, stop and check its resource allocation.

## 2. Get the correct source

The implemented workspace is on `codex/local-workspace`; do not assume it is on `main`.

For a new checkout, run from a directory where you want the project stored:

```sh
git clone --branch codex/local-workspace https://github.com/alindebergASL/stratlocal.git
cd stratlocal
git branch --show-current
test -f deploy/local/compose.yaml && test -f docs/local-workspace.md
```

Expected branch: `codex/local-workspace`; the last command must exit successfully. If GitHub denies access, sign in to an account with access to this repository or download this branch's ZIP from GitHub. For a ZIP download, open Terminal in the extracted directory containing `package.json` and `deploy/local/compose.yaml`; its directory name is not assumed.

If you already have a checkout or data, **do not re-run initialization over existing files**. Inspect `git status`, back up the existing installation using the Backup section, and keep its `.env`, password, and data volume. The following initialization block deliberately refuses to overwrite local configuration.

For an existing Git checkout with a clean working tree, after backing up:

```sh
git fetch origin codex/local-workspace
git switch codex/local-workspace
git pull --ff-only origin codex/local-workspace
```

Stop if Git reports local changes, a conflict, or divergent history; do not use reset/force commands to get past it. Skip initialization and continue at step 4 with your existing local configuration. An existing ZIP-based installation needs a separate new extraction and deliberate transfer of local configuration; these Git commands do not apply to it.

All remaining commands start from the repository root unless a step explicitly says otherwise.

## 3. Create the local login files

First check `openssl version`. If it is unavailable, stop; the following password-generation command requires it.

Run this entire block once for a new installation:

```sh
(
  set -eu
  test ! -e deploy/local/.env || { echo 'Existing .env: keep it and use the upgrade instructions.'; exit 1; }
  test ! -e deploy/local/secrets || { echo 'Existing secrets directory: inspect it before initializing.'; exit 1; }
  umask 077
  mkdir deploy/local/secrets
  cp deploy/local/.env.example deploy/local/.env
  openssl rand -hex 24 > deploy/local/secrets/bootstrap-password.txt
  chmod 700 deploy/local/secrets
  chmod 600 deploy/local/.env
  chmod 444 deploy/local/secrets/bootstrap-password.txt
)
```

Now run `nano deploy/local/.env`. Replace `you@example.com` with the email you want to use for local login and set `USER1_NAME`. Leave `BOOTSTRAP_PASSWORD_FILE=./secrets/bootstrap-password.txt` as supplied. Save with Control-O, Enter, then exit with Control-X. This email does not connect an email account.

The password file is readable inside the non-root container; its **parent directory is private (700)** on the Mac. This avoids assuming a container running as UID 10001 can read a host-owned 600 file. Do not move the 444 file outside that private directory. Both the directory and `.env` are excluded from Git and Docker build inputs.

To copy the generated password for login without printing it:

```sh
pbcopy < deploy/local/secrets/bootstrap-password.txt
```

For an existing installation, keep its password path. If `BOOTSTRAP_PASSWORD_FILE` is absent, Compose still uses the original `deploy/local/bootstrap-password.txt`. Run the read-access check below before restarting; if it fails, copy that same password into the private directory layout and update the path—do not generate a new password expecting it to reset an existing account.

## 4. Validate, build, and check file access

```sh
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env config --quiet
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env build app
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env run --rm --no-deps --entrypoint node app -e 'const fs=require("node:fs"); const p=fs.readFileSync("/run/secrets/bootstrap_password","utf8").trimEnd(); if(p.length<12) throw Error("Password must have at least 12 characters"); fs.accessSync("/app/data",fs.constants.W_OK); console.log("Password readable; data directory writable; uid="+process.getuid())'
```

Each command must succeed. The last should print `Password readable; data directory writable; uid=10001`, without printing the password. `EACCES` means a permissions problem; do not proceed to login. A download/build failure must be resolved before starting. The check may create the named data volume, but it does not initialize the database or change existing records.

## 5. Start and verify the app

```sh
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env up -d
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env ps
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env logs --tail=60 app worker
```

The app must become **healthy**, and the worker must be running. Health checks run every 30 seconds; repeat `ps` if it still says `starting`. A restarting/unhealthy container is a failure, not a completed installation. Logs may contain customer filenames or other local information; redact them before sharing.

Open **http://localhost:3000**, sign in with the email from `.env` and the password from step 3. Expect the Accounts page. Create a clearly named test account, then run:

```sh
docker compose -p strategylocal -f deploy/local/compose.yaml --env-file deploy/local/.env restart app
```

After the app is healthy again, reload and confirm the test account remains. The commands explicitly select project `strategylocal`; its database and originals live in `strategylocal_local_data`. Do not change the project name or use `down -v` to troubleshoot login; that can select a different volume or delete data. Bootstrap login details are only applied when the users table is empty. Editing the password file or email later does **not** reset an existing login.

Continue with [the first workflow](../../docs/local-workspace.md#first-workflow). MyAgent import and manual editing work without a model. Keep external AI disabled.

## Optional features

Follow the complete instructions in [optional Mac setup](../../docs/local-model-setup.md) for the exchange folder, Ollama, or Apple models. The guide includes a combined Compose command; running a base-only `up` after adding options can remove those options from recreated containers.

The base app has an internal Docker network; the maintenance worker has no network. The optional model gateway has a second network and forwards fixed authenticated operations to the Mac helper. Runtime isolation on a physical Mac still needs testing. A failed external HTTP request alone does not prove complete isolation; DNS, certificates, or the destination could also cause failure.

## Backup

From the repository root:

```sh
sh deploy/local/backup.sh
```

This targets the default `strategylocal` project in this checkout. It stops app/worker, snapshots `strategy.sqlite`, `jobs.sqlite` if present, and `docs`, then restarts **only the app/worker containers that were running beforehand**, even after a snapshot failure. It uses `start`, preserving existing optional mounts. It does not back up the exchange folder, Mac Keychain, bridge configuration/token, or bootstrap files. Back up any still-unimported MyAgent files separately.

Expected output: `Backup saved: local-backups/snapshot-<UTC>/`. If the command fails, inspect its output and run the `ps` command from step 5; do not treat a partial directory as a usable backup. Backups contain login password hashes, sessions, customer records, and any stored integration settings. Keep them private.

## Restore trial without replacing live data

Use the actual snapshot directory printed by the backup command. The example below uses a placeholder that you must replace; it is not a real snapshot name.

```sh
docker run --rm --network none \
  -v "$PWD/local-backups:/backups" \
  --user 0 --entrypoint node strategylocal-app \
  /app/snapshot.mjs restore /backups/snapshot-REPLACE-WITH-ACTUAL-NAME /backups/restored
```

The built `strategylocal-app` image must exist. `local-backups/restored` must not already exist; the script refuses to overwrite it. Successful output includes `"status":"ok"`. The restored files retain database paths used by this Docker deployment (`/app/data`); do not assume a restore to a different host-app path is portable.

Copy into an empty trial volume:

```sh
docker run --rm --network none --user 0 --entrypoint sh \
  -v "$PWD/local-backups/restored:/restore:ro" \
  -v strategylocal_restore_test:/destination strategylocal-app \
  -c 'test -z "$(ls -A /destination)" && cp -a /restore/. /destination/ && chown -R 10001:10001 /destination'
docker compose -p strategylocal-restore -f deploy/local/restore-test.yaml --env-file deploy/local/.env up -d
docker compose -p strategylocal-restore -f deploy/local/restore-test.yaml --env-file deploy/local/.env ps
```

If the copy command fails, stop; the volume may contain an earlier trial. Do not delete it without inspecting it. Once healthy, visit **http://localhost:3001**, using the login stored in the backup. Confirm the test account and download an imported original to check its contents. The startup script still needs a readable bootstrap file even though the database already contains users. The trial has no model/exchange override; new model tasks cannot run there.

Stop the trial after inspection:

```sh
docker compose -p strategylocal-restore -f deploy/local/restore-test.yaml --env-file deploy/local/.env down
```

This leaves the trial volume for inspection and does not replace the live volume. Switching a restored volume into production is not covered by these trial commands.
