# ValueFlow task runner. `just` lists recipes; `just <recipe>` runs one.
# Every recipe wraps a `bun run` script or a `nix` command, so nothing here
# is required: it is a memorable front door to the workflows in README.md.

set shell := ["bash", "-euo", "pipefail", "-c"]

port := env_var_or_default("PORT", "3000")
pidfile := justfile_directory() / ".valueflow.pid"
logfile := justfile_directory() / "data" / "valueflow.log"

# List recipes.
default:
    @just --list --unsorted

# ---- setup ----------------------------------------------------------------

# Install dependencies and seed the database (safe to re-run).
setup: deps seed
    @echo "ready: run 'just dev' and open http://localhost:{{port}}"

# Install dependencies from the lockfile.
deps:
    @command -v bun >/dev/null || { echo "bun not found: https://bun.sh (brew install oven-sh/bun/bun)"; exit 1; }
    bun install --frozen-lockfile

# Wipe the database and re-seed it from the mockup fixtures.
seed:
    bun run seed

# ---- run -------------------------------------------------------------------

# Dev server with HMR in the foreground (PORT={{port}}).
dev:
    PORT={{port}} bun run dev

# Start the dev server in the background; see `just stop`, `just logs`.
start:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f '{{pidfile}}' ] && kill -0 "$(cat '{{pidfile}}')" 2>/dev/null; then
        echo "ValueFlow already running (pid $(cat '{{pidfile}}')) on http://localhost:{{port}}"; exit 0
    fi
    mkdir -p "$(dirname '{{logfile}}')"
    PORT={{port}} nohup bun run dev >'{{logfile}}' 2>&1 &
    echo $! >'{{pidfile}}'
    for _ in $(seq 1 40); do
        if curl -sf "http://localhost:{{port}}/api/state" >/dev/null; then
            echo "ValueFlow running (pid $(cat '{{pidfile}}')) on http://localhost:{{port}}"; exit 0
        fi
        if ! kill -0 "$(cat '{{pidfile}}')" 2>/dev/null; then
            echo "ValueFlow exited during startup; last log lines:" >&2; tail -n 20 '{{logfile}}' >&2; rm -f '{{pidfile}}'; exit 1
        fi
        sleep 0.25
    done
    echo "ValueFlow did not answer on port {{port}} in time; see 'just logs'" >&2; exit 1

# Stop the background dev server.
stop:
    @if [ -f '{{pidfile}}' ]; then \
        pid=$(cat '{{pidfile}}'); \
        kill "$pid" 2>/dev/null && echo "stopped ValueFlow (pid $pid)" || echo "ValueFlow was not running (stale pid $pid)"; \
        rm -f '{{pidfile}}'; \
    else echo "ValueFlow is not running"; fi

# Restart the background dev server.
restart: stop start

# Show whether the background dev server is running.
status:
    @if [ -f '{{pidfile}}' ] && kill -0 "$(cat '{{pidfile}}')" 2>/dev/null; then \
        echo "ValueFlow running (pid $(cat '{{pidfile}}')) on http://localhost:{{port}}"; \
    else echo "ValueFlow is not running"; fi

# Tail the background dev server log.
logs:
    tail -n 50 -f '{{logfile}}'

# Production bundle, then serve it (no HMR).
serve: build
    PORT={{port}} bun run start

# ---- quality ---------------------------------------------------------------

# Typecheck, lint, and test (the CI gate).
check:
    bun run check

# TypeScript strict typecheck only.
typecheck:
    bun run typecheck

# oxlint only.
lint:
    bun run lint

# Run the test suite; pass a filter to narrow it, e.g. `just test glance`.
test *args:
    bun test {{args}}

# Re-run tests on change.
watch:
    bun test --watch

# Production bundle → packages/web/dist.
build:
    bun run build

# Exactly what the GitHub Actions Bun job runs.
ci: deps typecheck lint
    bun test
    bun run build

# ---- nix -------------------------------------------------------------------

# Typecheck + lint + tests inside the Nix sandbox.
nix-check:
    nix flake check --print-build-logs

# Build the production package to ./result.
nix-build:
    nix build --print-build-logs

# Run the production package from the flake.
nix-run:
    PORT={{port}} nix run

# Recompute the dependency hash after bun.lock changes and write it to flake.nix.
nix-hash:
    #!/usr/bin/env bash
    set -uo pipefail
    perl -0pi -e 's/outputHash = "sha256-[^"]*";/outputHash = lib.fakeHash;/' flake.nix
    hash=$(nix build .#nodeModules 2>&1 | sed -nE 's/^ *got: +(sha256-[A-Za-z0-9+\/=]+).*/\1/p')
    if [ -z "$hash" ]; then echo "could not obtain hash; flake.nix now has lib.fakeHash" >&2; exit 1; fi
    perl -0pi -e "s/outputHash = lib.fakeHash;/outputHash = \"$hash\";/" flake.nix
    echo "flake.nix: outputHash = $hash"
    nix build .#nodeModules

# ---- housekeeping ----------------------------------------------------------

# Remove the database (a new one is seeded on the next start).
reset: stop
    rm -f data/valueflow.sqlite data/valueflow.sqlite-wal data/valueflow.sqlite-shm
    @echo "database removed"

# Remove dependencies, build output, database, logs, and Nix result links.
clean: stop
    rm -rf node_modules packages/*/node_modules packages/web/dist data result result-*
