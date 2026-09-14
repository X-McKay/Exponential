# Exponential task runner. `just` lists recipes; `just <recipe>` runs one.
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

# Check prerequisites, create .env when absent, and install locked dependencies.
# This never seeds or replaces application data.
setup:
    bash scripts/setup.sh

# Report required and optional development tools without changing anything.
doctor:
    bash scripts/doctor.sh

# Install dependencies from the lockfile.
deps:
    @command -v bun >/dev/null || { echo "bun not found: https://bun.sh (brew install oven-sh/bun/bun)"; exit 1; }
    bun install --frozen-lockfile

# Wipe the configured database and replace it with disposable demo fixtures.
demo-reset:
    bun run demo:reset

# Pull development facts for every project from SYNC_SOURCE (sample|github).
sync:
    bun run sync

# Run an agent against a project through the running server, e.g. `just agent audie ima "focus on audit trails"`.
agent agent project instruction="":
    @curl -sf -X POST "http://localhost:{{port}}/api/agents/{{agent}}/runs" -H 'content-type: application/json' \
        -d '{"proj":"{{project}}","instruction":"{{instruction}}"}' \
        | bun -e 'const r = await new Response(Bun.stdin).json(); console.log(`${r.state}: ${r.summary}\n`); console.log(r.output || r.error)'

# Write this week's brief through the running server and print it.
brief:
    @curl -sf -X POST "http://localhost:{{port}}/api/agents/monday/runs" -H 'content-type: application/json' -d '{}' \
        | bun -e 'const r = await new Response(Bun.stdin).json(); console.log(`${r.state}: ${r.summary}\n`); console.log(r.output || r.error)'

# Ask Coach to study an agent and propose a prompt change, e.g. `just tune audie`.
tune agent:
    @curl -sf -X POST "http://localhost:{{port}}/api/agents/coach/runs" -H 'content-type: application/json' -d '{"target":"{{agent}}"}' \
        | bun -e 'const r = await new Response(Bun.stdin).json(); console.log(`${r.state}: ${r.summary}\n`); console.log(r.output || r.error)'

# Benchmark candidate models (LLM_MODELS) against the current one; poll `just jobs` for progress.
scout:
    @curl -sf -X POST "http://localhost:{{port}}/api/evals/scout" -H 'content-type: application/json' -d '{}'; echo

# Status of the background benchmark or scout job.
jobs:
    @curl -sf "http://localhost:{{port}}/api/evals/benchmark"; echo

# ---- run -------------------------------------------------------------------

# Dev server with HMR in the foreground (PORT={{port}}).
dev:
    PORT={{port}} bun run dev

# Start the dev server in the background; see `just stop`, `just logs`.
start:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f '{{pidfile}}' ] && kill -0 "$(cat '{{pidfile}}')" 2>/dev/null; then
        echo "Exponential already running (pid $(cat '{{pidfile}}')) on http://localhost:{{port}}"; exit 0
    fi
    mkdir -p "$(dirname '{{logfile}}')"
    PORT={{port}} nohup bun run dev >'{{logfile}}' 2>&1 &
    echo $! >'{{pidfile}}'
    for _ in $(seq 1 40); do
        if curl -sf "http://localhost:{{port}}/api/state" >/dev/null; then
            echo "Exponential running (pid $(cat '{{pidfile}}')) on http://localhost:{{port}}"; exit 0
        fi
        if ! kill -0 "$(cat '{{pidfile}}')" 2>/dev/null; then
            echo "Exponential exited during startup; last log lines:" >&2; tail -n 20 '{{logfile}}' >&2; rm -f '{{pidfile}}'; exit 1
        fi
        sleep 0.25
    done
    echo "Exponential did not answer on port {{port}} in time; see 'just logs'" >&2; exit 1

# Stop the background dev server.
stop:
    @if [ -f '{{pidfile}}' ]; then \
        pid=$(cat '{{pidfile}}'); \
        kill "$pid" 2>/dev/null && echo "stopped Exponential (pid $pid)" || echo "Exponential was not running (stale pid $pid)"; \
        rm -f '{{pidfile}}'; \
    else echo "Exponential is not running"; fi

# Restart the background dev server.
restart: stop start

# Show whether the background dev server is running.
status:
    @if [ -f '{{pidfile}}' ] && kill -0 "$(cat '{{pidfile}}')" 2>/dev/null; then \
        echo "Exponential running (pid $(cat '{{pidfile}}')) on http://localhost:{{port}}"; \
    else echo "Exponential is not running"; fi

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

# Local release checks before the container build.
ci: deps
    bun run release:check

# Check links in maintained Markdown files.
docs-check:
    bun run docs:check

# Verify that repository skills are byte-identical for Claude and Codex.
skills-check:
    bun run skills:check

# Build the release image with Podman or Docker.
container-build:
    bun run container:build

# Run the production acceptance suite against the release image.
container-test:
    bun run container:test

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
    perl -0pi -e "s|outputHash = lib.fakeHash;|outputHash = \"$hash\";|" flake.nix
    echo "flake.nix: outputHash = $hash"
    nix build .#nodeModules

# ---- housekeeping ----------------------------------------------------------

# Remove the local database (the next start creates a neutral workspace).
reset: stop
    rm -f data/valueflow.sqlite data/valueflow.sqlite-wal data/valueflow.sqlite-shm
    @echo "database removed"

# Remove dependencies, build output, database, logs, and Nix result links.
clean: stop
    rm -rf node_modules packages/*/node_modules packages/web/dist data result result-*
