#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then echo 'Run this installer on your Mac.' >&2; exit 1; fi
TASK_MODEL_HOME="${STRATEGY_MODEL_HOME:-$HOME/.strategylocal-models}"
mkdir -p "$TASK_MODEL_HOME"
chmod 700 "$TASK_MODEL_HOME"
umask 077
if [[ ! -e "$TASK_MODEL_HOME/token" ]]; then openssl rand -hex 32 > "$TASK_MODEL_HOME/token"; fi
xcrun swiftc -parse-as-library "$(dirname "$0")/ModelHelper.swift" -o "$TASK_MODEL_HOME/model-helper"
chmod 700 "$TASK_MODEL_HOME/model-helper"
echo "Helper installed. Run node deploy/host/server.mjs from the repository to start the bridge."
