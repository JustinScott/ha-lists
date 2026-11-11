# Local development and testing on Windows

Everything needed for development and tests is versioned in this repository.
No cloud workspace, cloud account, or cloud test data is required.

Use **WSL2 Ubuntu**, **Node.js 22**, **uv**, and **Docker Desktop**. Enable Docker
Desktop's WSL integration for Ubuntu. Install uv using its official instructions:
https://docs.astral.sh/uv/getting-started/installation/

Clone into the WSL Linux filesystem (for example `~/projects/ha-lists`), rather
than `/mnt/c`, for Linux permissions and better dependency-install performance.
If you already have this repository locally, commit or stash local edits before
pulling; do not overwrite them.

```bash
git clone https://github.com/JustinScott/ha-lists.git
cd ha-lists
bash dev/setup.sh
bash dev/check.sh
```

Setup creates a Python 3.14 virtual environment, installs the exact dependencies
in `requirements-test.lock`, and runs `npm ci`. It does not modify a real Home
Assistant instance. If `.venv` uses an older Python, rename that directory and
rerun setup. Keep your old environment until you no longer need it.

For installed-HA browser tests, start Docker Desktop and install Playwright's
Chromium and Linux libraries once:

```bash
npx playwright install --with-deps chromium
bash dev/check.sh --browser
```

The browser suite starts a disposable HA 2026.11.1 container on a random loopback
port. It creates synthetic credentials/tasks, tests mobile and desktop sessions,
and removes its container and configuration afterward. Allow several GB of free
disk space for the full HA image. It never connects to your real HA instance.
The normal test suite does not need Docker.

For an interactive development HA instance:

```bash
npm run dev
```

Open `http://localhost:8123`, complete fresh onboarding, create a Local To-do list,
and configure HA Lists. Keep port 8123 free. State lives in the ignored
`.dev-config/` directory. Stop with `docker compose -f compose.dev.yaml down`;
state is retained. No cloud account or cloud test tasks are transferred.

## Where the test infrastructure lives

- `dev/`: local setup/check scripts, this Windows/WSL guide, and sample HA config.
- `tests/`: packaging and basic contract checks.
- `tests_ha/`: HA fixtures, lifecycle, authorization, malformed requests, storage.
- `tests_behavior/`: panel behavior tests without a running HA server.
- `tests_browser/`: installed-HA browser tests and disposable native runtime helper.
- `.github/workflows/validate.yml`: GitHub CI using the same commands.
- Root manifests/lockfiles and `compose.dev.yaml`: shared configuration used by
  both local scripts and CI; keep these paths intact.

Run commands from the repository root. Installed environments, caches,
credentials, test accounts, and generated task data are not checked into Git.
