#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun 1.3.11 or newer is required: https://bun.sh/docs/installation" >&2
  exit 1
fi

"$repo_dir/scripts/doctor.sh" --required-only

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example."
else
  echo "Kept existing .env."
fi

mkdir -p data
bun install --frozen-lockfile

echo
echo "Exponential is ready. Run 'bun run dev' and open http://localhost:3000."
echo "The first start creates an empty workspace; sample data is never loaded automatically."
