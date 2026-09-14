# Exponential deployment

This release supports one shared workspace, one SQLite database, and one application process. User/role selection is explicitly self-declared; authentication integration is deferred. All reachable users can read shared project data, impersonate another listed user, select Administrator, and configure a provider. Use a trusted internal access path, not public unauthenticated hosting.

## Container deployment

`docker compose up --build -d` builds the pinned Bun image, runs the quality gate and production build, and starts a non-root process. The default host binding is loopback. The `valueflow-data` volume contains the database and server-only LLM settings. Set `VALUEFLOW_ORIGINS` to the exact browser origin when using an internal reverse proxy, for example `https://valueflow.internal.example`. Preserve streaming responses and allow long model requests (up to four minutes).

The container sets `VALUEFLOW_TRUSTED_WORKSPACE=on` explicitly. This does not grant browser origins by itself; configure exact origins as well. Leave the backend privately reachable. If an instance token is configured, a proxy must inject it on assets, API requests, and event streams; never embed it in browser JavaScript.

Do not scale replicas against the same SQLite volume. Set a durable absolute database path for non-container deployment. Keep the database and `.settings.json` file together in backups. Saved credentials are protected by file permissions, not application-level encryption.

### Podman

The image is tested with Podman 6.1.0 on Linux ARM64 through its macOS VM. A Compose provider is optional; the following commands work directly:

```sh
podman build --format docker -t localhost/exponential:release .
podman volume create valueflow-data
podman run -d --name exponential --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e VALUEFLOW_TRUSTED_WORKSPACE=on \
  -e VALUEFLOW_ORIGINS=http://localhost:3000 \
  -v valueflow-data:/app/data \
  localhost/exponential:release
podman healthcheck run exponential
```

Use `--format docker` when building with Podman: its default OCI format drops Dockerfile health checks. If publishing a different host port or using a proxy hostname, include that exact browser origin in `VALUEFLOW_ORIGINS`.

Run the full acceptance suite against the image with:

```sh
E2E_IMAGE=localhost/exponential:release bun packages/server/e2e/release.ts
```

This creates and removes a dedicated test container and volume, leaving the deployed workspace alone. The fixture provider listens on the host for the duration of the test and the container reaches it through `host.containers.internal`.

The final image uses the [official Bun](https://bun.sh/docs/installation) 1.3.11 Alpine runtime and UID/GID 1000. It includes only the bundled server and built browser assets; development dependencies, tests, original source files, and source maps stay out of the runtime. The browser assets include an approximately 85 kB Latin WOFF2 subset of Google Sans Flex so interface typography does not depend on installed fonts or an external font service. Its SIL Open Font License notice is included in the production bundle. Other scripts use a system sans-serif fallback. The ARM64 image is 108.6 MB versus 320.9 MB before optimization (about 66% smaller, local uncompressed sizes). Alpine was smaller than the tested official distroless base. Source maps remain enabled for ordinary local builds.

## First-use acceptance

1. Start with a new volume. Confirm zero projects, no historical measurements or runs, and built-in agents available.
2. Rename Workspace owner. Add colleagues and exercise the user/role selector from two tabs. Verify each tab keeps its own actor.
3. As Administrator, configure the API base, model, and token in Workspace settings. Test invalid credentials, save the correct credentials, and test the connection. Reopen settings and verify the token remains masked.
4. Create one project manually. Upload a fictional sample charter for a second project. Review suggested fields and explicitly confirm creation. Do not include an approval without evidence.
5. Add/edit milestones, record a measurement, inspect Value and Roadmap, and run a PM assessment and communications draft. Check that the draft is not approved or sent automatically.
6. Switch to Viewer and verify attempted writes are refused. Switch back to edit. Observe shared changes in a second open session.
7. Restart with the same volume. Verify projects, users, model configuration, and artifacts survive. In a disposable validation instance, remove all projects and restart; the workspace must stay empty.

## Provider and automation policy

Model configuration changes affect new operations. Active operations retain their captured provider and price configuration. Environment-defined prices, scout candidates, alternate providers and judge selection are retained when saving the default connection. A token is never implicitly copied to a new default endpoint.

Automatic scheduling, model judging and background curation are off unless their respective variables equal `on`. Ordinary opening of a project page does not generate its brief. Enabling these features can incur provider usage even when no browser is open. Configure budgets and observe a manual run before enabling automation.

## Backup, upgrade and restore

Before upgrading, stop the application cleanly and copy the **entire data directory/volume**, including SQLite WAL/SHM files if present and the secret settings file. Restrict backup access. Never copy only the active SQLite main file while discarding its WAL. An online backup should instead use SQLite's backup API.

Start the new image against a copy of the backup first. Migrations run on startup. Verify health, users, project count, selected records, artifacts, model settings, and a manual workflow before replacing the running image. Do not run `seed`, `reset`, or `clean` against live data.

For rollback, stop the new application and restore the complete pre-upgrade backup together with the previous image. Do not assume an older binary can read a newer schema. Test restore procedures before relying on them.

SIGTERM stops accepting requests and allows HTTP work to drain for up to 15 seconds. Long or background operations interrupted by shutdown are marked failed at next startup; uncertain provider usage remains held for reconciliation. The service is not a durable job queue.

## Release checks

Run `bun run check` and `bun run test:e2e`. CI includes both tests and the production-process acceptance suite. The release image also passed the Podman acceptance suite above. Validate the intended deployment architecture and backup/restore procedure before publishing. Review [release validation](release-validation.md) for the exact checks performed and their limits.

No public hosting, DNS changes, image publication, or external message delivery is part of this preparation. Authentication, verified role-based access, private workspaces, high availability, and durable job execution remain future work.
