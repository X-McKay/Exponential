# Configuration

Exponential loads the repository-root `.env` file through Bun. Existing process variables take precedence. Copy `.env.example` for local development and keep tokens out of Git.

## Application

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `127.0.0.1` | HTTP listener address |
| `VALUEFLOW_DB` | `data/valueflow.sqlite` | SQLite database path |
| `VALUEFLOW_SETTINGS` | `<database>.settings.json` | Server-only runtime model settings |
| `VALUEFLOW_NOW` | Current clock | Optional ISO timestamp for controlled demos and tests |
| `SEED_SYNTHETIC` | unset | `bun run demo:reset` only: generate a synthetic workspace from this seed instead of the demo fixtures (`SEED_PROJECTS` sets how many projects) |

Runtime model settings are written atomically with file mode `0600`. They are not encrypted at rest. Keep the settings file and database together in backups.

## Model providers

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_BASE_URL` | Unset | Default OpenAI-compatible API base, usually ending in `/v1` |
| `LLM_MODEL` | First listed model | Default model ID |
| `LLM_API_KEY` | Unset | Token for the default endpoint |
| `LLM_THINKING` | Off | Set exactly `on` to enable model reasoning |
| `LLM_MODELS` | Unset | Comma-separated model candidates; alternate endpoints use `model@url` |
| `LLM_PROVIDER_<NAME>_BASE_URL` | Unset | Named alternate endpoint allowed by the server |
| `LLM_PROVIDER_<NAME>_API_KEY` | Unset | Credential bound to that named endpoint |
| `LLM_PRICES` | Unset | `model=input/output` USD per million tokens |
| `EVAL_JUDGE_MODEL` | Default model | Optional judge model selection |

The Workspace settings panel manages the default endpoint, model, token, reasoning flag, and enabled state. Saved values override the matching default environment variables. Prices, candidates, named providers, and judge selection remain active when settings are saved.

Credentials stay bound to their configured API base. Changing the default base through the UI clears its saved token unless a replacement is supplied. Redirects are refused, and a model that names another endpoint must match an explicitly configured provider.

## Integrations and background work

| Variable | Default | Purpose |
| --- | --- | --- |
| `SYNC_SOURCE` | `none` | Development source: `none`, `github`, or explicit demo-only `sample` |
| `GITHUB_TOKEN` | Unset | GitHub connector token |
| `SYNC_INTERVAL_MIN` | `0` | Periodic sync interval; zero disables the timer |
| `AGENT_SCHEDULE` | Off | Set exactly `on` to enable scheduled agent work |
| `EVAL_JUDGE` | Off | Set exactly `on` to enable background model judging |
| `GLANCE_CURATE` | Off | Set exactly `on` to enable background Glance curation |
| `BRIEF_WEBHOOK_URL` | Unset | Optional JSON delivery endpoint for the weekly brief |

Background model work is opt-in. Opening a page does not generate a brief. Manual generation, document analysis, conversations, and agent runs can still call the provider when AI is enabled.

## Shared deployment access

| Variable | Default | Purpose |
| --- | --- | --- |
| `VALUEFLOW_TRUSTED_WORKSPACE` | Off | Set `on` to allow non-loopback hosting while authentication is deferred |
| `VALUEFLOW_ACCESS_TOKEN` | Unset | Optional instance bearer token of at least 32 characters |
| `VALUEFLOW_ORIGINS` | Local listener origins | Additional exact, comma-separated browser origins |

Non-loopback startup fails unless the trusted-workspace flag is on or a sufficiently long instance token is configured. The instance token is intended for a trusted proxy to inject; never put it in browser JavaScript. It does not provide individual identity. See [deployment](deployment.md) for the supported boundary.
