# Development

## Prerequisites

| Tool | Required | Purpose |
| --- | --- | --- |
| Git | Yes | Clone and contribute to the repository |
| Bun 1.3.11+ | Yes | Install packages, run TypeScript, test, bundle, and serve |
| Podman or Docker | No | Build and test the production container |
| just | No | Short aliases for repository commands |
| Nix | No | Reproducible development shell and CI check |

Install Git with the operating system package manager or from [git-scm.com](https://git-scm.com/downloads). Install Bun using the [official instructions](https://bun.sh/docs/installation). On macOS with Homebrew:

```sh
brew install oven-sh/bun/bun
```

The application uses Bun's built-in SQLite driver. It does not require Node.js, a separate database server, Python, or a globally installed TypeScript compiler.

## Automated setup

```sh
git clone https://github.com/X-McKay/Exponential.git
cd Exponential
bun run setup
bun run dev
```

`bun run setup` checks Git and Bun, creates `.env` only when it is absent, creates the local data directory, and runs `bun install --frozen-lockfile`. It never replaces configuration or loads demo data.

Use `bun run doctor` for a read-only environment report. Open [http://localhost:3000](http://localhost:3000) after the server starts.

## Manual setup

The equivalent commands are:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Do not replace an existing `.env`; merge new example settings deliberately.

## Development workflow

The server imports the HTML entry point in development, and Bun bundles the React client with hot module replacement. Production uses the output from `packages/web/dist`.

```sh
bun run check
bun run test:e2e
bun run build
bun run start
```

`bun run check` includes TypeScript, oxlint, all unit and integration tests, local documentation links, and a byte-for-byte comparison of `.agents/skills` with `.claude/skills`. The E2E suite uses temporary databases and a token-protected local OpenAI-compatible fixture. It does not call an external model.

Useful focused commands:

```sh
bun test packages/domain
bun test packages/server/test/release.test.ts
bun run typecheck
bun run lint
bun run docs:check
bun run skills:check
```

Run `just` to see equivalent task-runner recipes. `nix develop` opens the pinned toolchain; `nix flake check` runs the Nix quality gate.

## Local data

The default database is `data/valueflow.sqlite`; runtime model settings default to `data/valueflow.sqlite.settings.json`. Both are ignored by Git. SQLite WAL and SHM files belong to the same database and must stay together during backups.

Normal startup creates an empty workspace with an owner and built-in agent definitions. It is safe to stop and restart without creating sample projects. `bun run demo:reset` deletes the configured database and writes demo fixtures, so use it only for a disposable local environment.

To use a separate database while testing manually:

```sh
VALUEFLOW_DB=/tmp/exponential-dev.sqlite PORT=3100 bun run dev
```

## Containers

Start Docker Desktop, or start the Podman machine on macOS with `podman machine start`. Then:

```sh
bun run container:build
bun run container:test
```

The helper prefers Podman when both engines are installed. Set `CONTAINER_ENGINE=docker` or `CONTAINER_ENGINE=podman` to choose explicitly, and set `E2E_IMAGE` to override the default `localhost/exponential:release` tag.

The first build needs access to the Bun and container registries and runs the complete quality gate inside the build stage.

## Troubleshooting

- Run `bun run doctor` first.
- If port 3000 is occupied, run `PORT=3100 bun run dev` and open that port.
- If the browser reports an origin error, make `VALUEFLOW_ORIGINS` contain its exact `http://` or `https://` origin.
- If model actions are disabled, configure a connection in Workspace settings or check the variables in [configuration](configuration.md).
- If a build behaves inconsistently after dependency changes, remove `node_modules` and rerun `bun run setup`; do not delete application data.
