#!/usr/bin/env bash
set -euo pipefail

required_only="${1:-}"
failed=0

if command -v git >/dev/null 2>&1; then
  echo "ok  git $(git --version | awk '{print $3}')"
else
  echo "err git is required" >&2
  failed=1
fi

if command -v bun >/dev/null 2>&1; then
  bun_version="$(bun --version)"
  IFS=. read -r major minor patch <<<"${bun_version%%-*}"
  patch="${patch:-0}"
  if (( major > 1 || (major == 1 && minor > 3) || (major == 1 && minor == 3 && patch >= 11) )); then
    echo "ok  bun $bun_version"
  else
    echo "err Bun 1.3.11 or newer is required; found $bun_version" >&2
    failed=1
  fi
else
  echo "err Bun 1.3.11 or newer is required: https://bun.sh/docs/installation" >&2
  failed=1
fi

if [[ "$required_only" != "--required-only" ]]; then
  [[ -f .env ]] && echo "ok  .env exists" || echo "note .env is absent; 'bun run setup' creates it"
  [[ -d node_modules ]] && echo "ok  dependencies installed" || echo "note dependencies are absent; run 'bun run setup'"

  if command -v docker >/dev/null 2>&1; then
    echo "ok  Docker installed ($(docker --version))"
  elif command -v podman >/dev/null 2>&1; then
    echo "ok  Podman installed ($(podman --version))"
  else
    echo "note Docker or Podman is optional and needed only for container workflows"
  fi

  command -v just >/dev/null 2>&1 && echo "ok  just installed (optional)" || echo "note just is optional"
  command -v nix >/dev/null 2>&1 && echo "ok  Nix installed (optional)" || echo "note Nix is optional"
fi

exit "$failed"
