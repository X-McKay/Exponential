#!/usr/bin/env bash
# Browser suite: install the separate Playwright package, build the web bundle,
# and run the specs. Pass Playwright arguments through, e.g. `--grep inbox`.
#   E2E_IMAGE=…      test a container image instead of the local server
#   E2E_BASE_URL=…   test an application you started (must be empty; the suite seeds it)
#   PW_CHROMIUM=…    use a preinstalled Chromium binary instead of downloading one
set -euo pipefail
cd "$(dirname "$0")/.."
(cd tests/ui && bun install --frozen-lockfile --silent)
if [[ -z "${PW_CHROMIUM:-}" && -z "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" ]]; then
  (cd tests/ui && node node_modules/.bin/playwright install chromium >/dev/null)
fi
if [[ -z "${E2E_IMAGE:-}" && -z "${E2E_BASE_URL:-}" ]]; then bun run build >/dev/null; fi
cd tests/ui && exec node node_modules/.bin/playwright test "$@"
