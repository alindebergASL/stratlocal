# StrategyLocal local workspace

Pinned source: alindebergASL/strategy commit `590acd78141ec0f8ef4599fd4e5e337019a7440b`.
Upstream was checked on 2026-10-27 and had advanced to `399ca168d01a6b0a57eafd1bc66a315d5a4b926a` (22 commits ahead). This pilot deliberately uses the reviewed baseline. No changes have been pushed to the original repository. The distributed source is a snapshot, not an upstream Git history clone.

## Start on your Mac

Requires Docker Desktop with Compose. Initial image/dependency downloads require internet. Runtime app and worker use isolated networks. Run from the extracted `strategy-local` directory:

```sh
cp deploy/local/.env.example deploy/local/.env
```

Edit `deploy/local/.env` with your email and display name (these are local login details; they do not connect an email account). Create `deploy/local/bootstrap-password.txt` with a unique password of at least 12 characters, then:

```sh
chmod 600 deploy/local/.env deploy/local/bootstrap-password.txt
docker compose -f deploy/local/compose.yaml --env-file deploy/local/.env up --build -d
```

Visit http://localhost:3000 and sign in. The bootstrap account is created only when the users table is empty. Changing the bootstrap file later does not reset an existing password. Keep the file available for subsequent container starts; it is excluded from the image and source control.

The database and original documents persist in the `strategylocal_local_data` Docker volume. `docker compose down` preserves it; **do not use `down -v`** unless deliberately deleting your data. This volume belongs to one installation. Never place the SQLite files in OneDrive or share this volume between Macs.

## Workspace behavior

Bedrock and Anthropic are off by default. No AWS or MyAgent API setup is required. The account-first workspace supports reviewed MyAgent packages, source citations, territory observations, meetings, customer confirmations, and optional local-model drafting. See [the workspace guide](../../docs/local-workspace.md) for the package contract, exchange folder, Mac model helper, and advanced external-AI opt-in.

The base deployment has no runtime internet connection. Optional Compose overrides add a restricted model gateway and/or a dedicated exchange folder. The application owns a durable queue for package import and model tasks; the separate worker retains maintenance jobs. All workspace records live in the local SQLite volume and original files under `docs`.

Actual Apple inference and Mac Docker connectivity still require Mac validation. This configuration is for localhost, not a public deployment.

## Backup

From the source root:

```sh
sh deploy/local/backup.sh
```

This stops the app and worker, snapshots SQLite (including the job queue when present) and original documents, writes SHA-256 checksums, then restarts the services. Output is under `local-backups/snapshot-<UTC>/`. Protect backups like the original account data: they include the database's user password hashes, sessions and any integration settings already in that database. Bootstrap secret files are not copied. Use a fresh local database for this pilot, not a cloud production database.

## Restore into a fresh directory

Restore never overwrites an existing destination. First validate and restore the snapshot into a new directory, using the built image (substitute the actual snapshot name):

```sh
docker run --rm --network none \
  -v "$PWD/local-backups:/backups" \
  --user 0 --entrypoint node strategylocal-app \
  /app/snapshot.mjs restore /backups/snapshot-YYYYMMDDTHHMMSSZ /backups/restored
```

This produces `local-backups/restored` with a checked database and documents. To test it as a separate installation without touching the original volume:

```sh
docker run --rm --network none --user 0 --entrypoint sh \
  -v "$PWD/local-backups/restored:/restore:ro" \
  -v strategylocal_restore_test:/destination strategylocal-app \
  -c 'test -z "$(ls -A /destination)" && cp -a /restore/. /destination/ && chown -R 10001:10001 /destination'
```

Start the included isolated restore trial:

```sh
docker compose -f deploy/local/restore-test.yaml up -d
```

Visit http://localhost:3001 and use the login stored in the backup. Do not replace the live volume until that restored instance has been reviewed. Stop the trial with `docker compose -f deploy/local/restore-test.yaml down`.

## Mac acceptance checks still required

1. Build/start on Apple silicon, log in, create a synthetic account, restart, and confirm persistence.
2. Confirm port 3000 is unavailable from another device.
3. Test rejected external fetch from the container:
   `docker compose -f deploy/local/compose.yaml --env-file deploy/local/.env exec app node -e "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>{console.error('UNEXPECTED NETWORK ACCESS');process.exit(1)}).catch(()=>console.log('network blocked'))"`
4. Check browser developer tools for third-party network requests; verify all required UI assets load.
5. Run backup and restore into a new directory; verify synthetic account and document bytes.
6. Stop/start the worker and confirm queued maintenance jobs survive.

No physical Mac/container isolation verification has been claimed. See `VALIDATION.md` for checks completed in the development workspace.
