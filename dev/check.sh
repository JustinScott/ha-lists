#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --browser ) ]]; then
  echo 'Usage: bash dev/check.sh [--browser]' >&2
  exit 2
fi
venv_path="${HA_LISTS_VENV:-.venv}"
[[ -f "$venv_path/bin/activate" ]] || { echo 'Run the matching setup command first.' >&2; exit 1; }
source "$venv_path/bin/activate"
npm run test:all
if [[ "${1:-}" == --browser ]]; then
  npm run test:browser
fi
