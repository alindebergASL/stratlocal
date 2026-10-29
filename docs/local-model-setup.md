# Optional Mac setup: exchange folder and local models

First complete [the base installation and persistence check](../deploy/local/README.md). These options are independent. You can use manual MyAgent file import with neither option enabled. Run commands from the repository root.

**Mac execution is not yet verified.** These steps include transport, permissions, and actual-task checks instead of assuming Docker Desktop, Apple Intelligence, or Ollama is ready. A capability response alone is not an inference test. Keep Bedrock/external AI disabled throughout.

## A. Optional MyAgent exchange folder

1. Create a dedicated, non-synced folder:

   ```sh
   mkdir -p "$HOME/StrategyLocal-exchange"
   printf '%s\n' "$HOME/StrategyLocal-exchange"
   ```

2. Edit `deploy/local/.env`. Uncomment `STRATEGY_EXCHANGE_HOST_DIR` and replace its value with the **absolute path printed above**. Put quotes around a path containing spaces. Do not leave the example path or use `~`. Do not point it at the database, repository, or a broad directory such as your entire home folder.

3. Validate the combined configuration and test access as the actual container user:

   ```sh
   docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.exchange.yaml --env-file deploy/local/.env config --quiet
   docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.exchange.yaml --env-file deploy/local/.env run --rm --no-deps --entrypoint node app -e 'const fs=require("node:fs"),p="/exchange/.strategylocal-write-check"; fs.writeFileSync(p,"synthetic permission check",{flag:"wx",mode:0o600}); console.log("Container wrote permission check")'
   cat "$HOME/StrategyLocal-exchange/.strategylocal-write-check"
   rm "$HOME/StrategyLocal-exchange/.strategylocal-write-check"
   ```

   Expected text from `cat`: `synthetic permission check`. This checks that the app can create a private file and your Mac user can read it. If the file already exists from a previous check, inspect and remove that check file before retrying. If Docker rejects the mount, allow this specific folder in Docker Desktop file sharing, then retry. If writing/reading fails, stop this option and continue using manual uploads; do not assume host/container user permissions match or make your whole home directory writable.

4. Check the other direction:

   ```sh
   (umask 077; printf '%s' 'synthetic incoming check' > "$HOME/StrategyLocal-exchange/.strategylocal-read-check")
   docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.exchange.yaml --env-file deploy/local/.env run --rm --no-deps --entrypoint node app -e 'const fs=require("node:fs"); if(fs.readFileSync("/exchange/.strategylocal-read-check","utf8")!=="synthetic incoming check") process.exit(1); console.log("Container can read host-created files")'
   rm "$HOME/StrategyLocal-exchange/.strategylocal-read-check"
   ```

   Only continue if both directions succeed. Test-file names start with a dot so the watcher ignores them.

5. Start with the exchange override:

   ```sh
   docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.exchange.yaml --env-file deploy/local/.env up -d
   ```

6. In **Settings**, confirm the folder mount says `configured`, check **Watch configured exchange folder**, and save. After a few seconds, confirm `Requests`, `Incoming`, and `Processed` exist inside the folder. Prepare a synthetic MyAgent request with **Also write to the configured exchange folder** checked. Confirm a ZIP appears in `Requests` and that you can open it from the Mac. This verifies the actual request path, not just mount access.

7. Put a supported response ZIP into `Incoming`. Finish copying before expecting import; the scanner waits until the size and modification time are unchanged for at least five seconds. Confirm it appears in **Imports & tasks**. A valid parsed file moves to `Processed` before proposals are accepted; that move is not approval of its claims. Failed files remain in `Incoming`. `.part`, `.tmp`, `.download`, hidden files, and symlinks are ignored. Correct the contents of a failed package to resubmit it; an identical file is deduplicated.

The app does not automatically tell MyAgent to read or write this folder. You must give MyAgent the files or configure its folder access separately. That MyAgent configuration is not part of this repository.

## B. Optional local-model helper

### B1. Verify host prerequisites

```sh
node --version
npm --version
xcode-select -p
xcrun --find swiftc
xcrun --sdk macosx --show-sdk-version
```

Host Node must report **v22.x** (the repository's supported range). If absent or a different major, install Node 22 using the [official Node 22 downloads](https://nodejs.org/download/release/latest-v22.x/), reopen Terminal, return to the repository root, and repeat the check. This is separate from Node inside Docker.

If Xcode tools are missing, run `xcode-select --install`, finish installation, and repeat the checks. Command-line tools alone do **not** establish Apple model support: the selected SDK must contain FoundationModels. Supported hardware, macOS 26 or later, enabled Apple Intelligence, and a ready system model are also required. The compiled helper's availability check below is the gate; do not assume a particular Mac model or OS.

Install repository dependencies, then compile the helper:

```sh
npm ci
bash deploy/host/install.sh
```

Both must exit successfully. `npm ci` downloads dependencies and may compile native modules. The installer creates a token and executable in `${STRATEGY_MODEL_HOME:-$HOME/.strategylocal-models}`; it does not start a service. The commands below use that same setting, so a custom location must be present in every Terminal running helper commands.

Check Apple availability without sending account data:

```sh
printf '%s' '{"operation":"availability"}' | "${STRATEGY_MODEL_HOME:-$HOME/.strategylocal-models}/model-helper"
```

`"available":true` is required to choose Apple in the app. `false` or a process error means Apple cannot be used yet. An older SDK can compile a helper that supports Keychain but reports Apple unavailable. Ollama can still be used if its own checks pass.

### B2. If using Ollama, verify it separately

Install/start [Ollama for macOS](https://ollama.com/download/mac) if not already installed. Then run:

```sh
ollama --version
ollama list
curl --fail --show-error --max-time 5 http://127.0.0.1:11434/api/tags
```

All must succeed. The JSON must contain at least one installed model. If no models are installed, choose/download a model in Ollama appropriate for your Mac's available memory; this guide does not assume a model size your hardware can run. Test that model in Ollama before continuing. Copy the **exact model name, including its tag**, from `/api/tags` for the app's model field. The app only lists/runs installed models and never downloads one automatically.

### B3. Start and check the host bridge

In a Terminal at the repository root, run:

```sh
node deploy/host/server.mjs
```

Expected startup line: `StrategyLocal model bridge listening on 127.0.0.1:4242`. Leave this Terminal open. The bridge runs in the foreground, not as an auto-start service; closing it or rebooting the Mac stops model access. An address-in-use error means port 4242 is occupied; resolve that before continuing. Do not run two copies.

In a **second Terminal**, return to this same repository directory and run this full block. It reads the token locally without printing it or putting it into command-line arguments:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=process.env.STRATEGY_MODEL_HOME || path.join(os.homedir(),'.strategylocal-models');
const token=fs.readFileSync(path.join(dir,'token'),'utf8').trim();
const r=await fetch('http://127.0.0.1:4242/v1/capabilities', {headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
if(!r.ok) throw Error(`Bridge check failed: ${r.status}`);
console.log(JSON.stringify(await r.json(),null,2));
JS
```

Require `externalEnabled:false` and `available:true` for your selected local provider. For Ollama, require your chosen model in `models`. If this installation had previously enabled external AI, turn it off through the app's Advanced settings and repeat the check; restarting the helper does not reset saved policy.

### B4. Give Docker a readable token and verify transport

The host token is private. The app and gateway run as UID 10001, so do not assume they can read a direct bind mount of the host's 600 token file. Make a Docker-readable copy **inside the private secrets directory created during base setup**:

```sh
(
  set -eu
  test -d deploy/local/secrets && test ! -L deploy/local/secrets
  chmod 700 deploy/local/secrets
  test ! -e deploy/local/secrets/model-bridge-token.txt || { echo 'Existing token copy: inspect it before replacing.'; exit 1; }
  install -m 444 "${STRATEGY_MODEL_HOME:-$HOME/.strategylocal-models}/token" deploy/local/secrets/model-bridge-token.txt
)
```

Edit `deploy/local/.env`: uncomment/set `MODEL_BRIDGE_TOKEN_PATH=./secrets/model-bridge-token.txt`. Paths beginning `./` here resolve relative to `deploy/local`, where the base Compose file lives. If the host token is regenerated later, replace the Docker copy with the new token and recreate the gateway/app; do not assume a previously mounted file tracks replacement.

```sh
docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.models.yaml --env-file deploy/local/.env config --quiet
docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.models.yaml --env-file deploy/local/.env up -d model-gateway
docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.models.yaml --env-file deploy/local/.env run --rm --no-deps --entrypoint node app -e 'const fs=require("node:fs"); const token=fs.readFileSync(process.env.MODEL_BRIDGE_TOKEN_FILE,"utf8").trim(); fetch("http://model-gateway:4243/v1/capabilities",{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw Error("Gateway status "+r.status); console.log(JSON.stringify(await r.json(),null,2))}).catch(e=>{console.error(e.message);process.exit(1)})'
```

Require the same capabilities as in B3. This tests the private-token mount, internal Docker DNS, gateway, and Docker Desktop's `host.docker.internal` route to the loopback-bound Mac helper. **That route has not been validated on a physical Mac.** If it fails, inspect gateway logs with the same Compose files and `logs --tail=40 model-gateway`. Stop this option if unresolved; manual MyAgent import remains usable. Do not expose the helper on `0.0.0.0` or assume a development-server fallback has been configured.

### B5. Enable the option and run a real draft

For models without the exchange folder:

```sh
docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.models.yaml --env-file deploy/local/.env up -d
```

For **both models and the exchange folder**, use the complete command:

```sh
docker compose -p strategylocal -f deploy/local/compose.yaml -f deploy/local/compose.models.yaml -f deploy/local/compose.exchange.yaml --env-file deploy/local/.env up -d
```

Use that same set of `-f` options for later `up` commands. Run `ps` with the same options; the app must be healthy and gateway/worker running.

In **Settings**, check model availability, select the local provider, enter the exact installed Ollama model if applicable, and save. Open a test account → **Evidence & MyAgent**, select a small readable source, and choose **Evidence summary**. Preview the context, then run it. In **Imports & tasks**, wait for completion and open **Review draft**. Verify citations open the expected evidence. A failed task means model setup or inference is not yet verified, even if capabilities looked correct. No automatic external fallback occurs.

Apple results may fail for context size, system model availability, or other model limits. Ollama can fail for unavailable models or insufficient memory. Leave failed tasks visible, resolve the reported cause, and create a fresh preview/task.

External providers remain optional under **Settings → Advanced → External AI**. Leave the switch off for the current workflow; no credential entry is part of these setup steps.
