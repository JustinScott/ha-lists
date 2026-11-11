#!/usr/bin/env bash
# Workspace-local tools for Windows/WSL; no shell profile changes.
set -euo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PWD/.dev-tools/node/bin:$PWD/.dev-tools/bin:$PATH"
# Python's large package tree needs Linux rename semantics, outside OneDrive.
workspace_key="$(printf '%s' "$PWD" | sha256sum | cut -c1-16)"
local_root="${XDG_CACHE_HOME:-$HOME/.cache}/ha-lists/$workspace_key"
export UV_PYTHON_INSTALL_DIR="$local_root/python"
export UV_CACHE_DIR="$local_root/uv-cache"
export HA_LISTS_VENV="$local_root/venv"
export PLAYWRIGHT_BROWSERS_PATH="$local_root/browsers"
action="${1:-check}"
case "$action" in
  setup)
    mkdir -p .dev-tools/bin
    if [[ ! -x .dev-tools/node/bin/node ]]; then
      # Verify the archive against the checksum published by Node.js.
      version=v22.23.5
      archive="node-$version-linux-x64.tar.xz"
      curl -fsSL "https://nodejs.org/dist/$version/SHASUMS256.txt" -o .dev-tools/SHASUMS256.txt
      curl -fsSL "https://nodejs.org/dist/$version/$archive" -o ".dev-tools/$archive"
      (cd .dev-tools; grep " $archive$" SHASUMS256.txt | sha256sum --check)
      mkdir -p .dev-tools/node
      tar -xJf ".dev-tools/$archive" -C .dev-tools/node --strip-components=1
    fi
    if [[ ! -x .dev-tools/bin/uv ]]; then
      curl -fsSL https://astral.sh/uv/install.sh -o .dev-tools/install-uv.sh
      UV_INSTALL_DIR="$PWD/.dev-tools/bin" UV_NO_MODIFY_PATH=1 sh .dev-tools/install-uv.sh
    fi
    bash dev/setup.sh
    npx playwright install chromium
    ;;
  check) bash dev/check.sh ;;
  browser-deps) npx playwright install-deps chromium ;;
  browser) bash dev/check.sh --browser ;;
  start) docker compose -f compose.dev.yaml up -d ;;
  stop) docker compose -f compose.dev.yaml stop ;;
  status) docker compose -f compose.dev.yaml ps ;;
  *) echo 'Usage: bash dev/local.sh {setup|check|browser|browser-deps|start|stop|status}' >&2; exit 2 ;;
esac
