#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
command -v uv >/dev/null || { echo 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js 22 and npm first.' >&2; exit 1; }
venv_path="${HA_LISTS_VENV:-.venv}"
if [[ ! -d "$venv_path" ]]; then
  uv venv --python 3.14 "$venv_path"
fi
"$venv_path/bin/python" -c 'import sys; assert sys.version_info >= (3, 14, 2) and sys.version_info < (3, 15), "Use a Python 3.14 virtual environment; rename an older environment before setup"'
uv pip sync --python "$venv_path/bin/python" requirements-test.lock
npm ci
echo 'Setup complete. Run bash dev/check.sh; add --browser for the Docker/browser suite.'
