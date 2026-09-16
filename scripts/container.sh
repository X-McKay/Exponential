#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
image="${E2E_IMAGE:-localhost/exponential:release}"

if [[ -n "${CONTAINER_ENGINE:-}" ]]; then
  engine="$CONTAINER_ENGINE"
elif command -v podman >/dev/null 2>&1; then
  engine="podman"
elif command -v docker >/dev/null 2>&1; then
  engine="docker"
else
  echo "Install Podman or Docker, or set CONTAINER_ENGINE to its executable." >&2
  exit 1
fi

build() {
  if [[ "$engine" == "podman" ]]; then
    "$engine" build --format docker -t "$image" .
  else
    "$engine" build -t "$image" .
  fi
}

case "$action" in
  build)
    build
    ;;
  test)
    if ! "$engine" image inspect "$image" >/dev/null 2>&1; then build; fi
    E2E_IMAGE="$image" CONTAINER_ENGINE="$engine" bun packages/server/e2e/release.ts
    ;;
  ui)
    if ! "$engine" image inspect "$image" >/dev/null 2>&1; then build; fi
    E2E_IMAGE="$image" CONTAINER_ENGINE="$engine" bash scripts/ui-test.sh
    ;;
  *)
    echo "Usage: scripts/container.sh build|test|ui" >&2
    exit 2
    ;;
esac
