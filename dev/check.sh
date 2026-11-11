#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --browser ) ]]; then
  echo 'Usage: bash dev/check.sh [--browser]' >&2
  exit 2
fi
[[ -f .venv/bin/activate ]] || { echo 'Run bash dev/setup.sh first.' >&2; exit 1; }
source .venv/bin/activate
npm run test:all
if [[ "${1:-}" == --browser ]]; then
  npm run test:browser
fi
