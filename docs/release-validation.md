# Exponential release validation

Validated on 2026-09-13/14 for a trusted, shared-workspace pilot with authentication deferred. This is preparation evidence, not a record of a public deployment.

## Automated checks

| Check | Result |
| --- | --- |
| `bun run check` | Passed: 218 tests, zero failures, 1,375 assertions, plus the configured static checks |
| `bun run test:e2e` | Passed: production build and 30 acceptance checks, five calls to the local fixture provider |
| `git diff --check` | Passed |

### Follow-up: templates, updates from documents, synthetic data, browser suite

After the project-template, update-from-documents, generic-fixture, and validation work: `bun run check` passed with 244 tests (6,058 assertions), `bun run test:e2e` passed its 30 checks, and the new Playwright suite (`bun run test:ui`) passed all 26 browser checks against the production server on a synthetic workspace, including phone-width layouts. The container path for the browser suite (`bun run container:ui`, also wired into CI) was not exercised in that environment because no container engine was available; the HTTP acceptance suite against the image was last run as recorded above.

### Podman follow-up

The optimized release image was built and tested with Podman 6.1.0 on ARM64. The container build ran the static checks and 218 tests using the pinned Bun 1.3.11 toolchain. Its 31-check acceptance suite covered production assets, the image health endpoint, provider calls, conflict protection, and persistence through two container replacements using the same named volume. Test containers and their volume were removed afterward.

The image runs as UID/GID 1000 and contains the server bundle plus built browser assets. No dependency tree or source maps are shipped. The browser bundle now includes an approximately 85 kB Latin WOFF2 subset of Google Sans Flex, its SIL Open Font License notice, and the Exponential SVG mark. A separate runtime check successfully fetched the real vLLM models endpoint over HTTPS (HTTP 200).

After the shared-edit, typography, and brand changes, local static checks, all 218 tests, the production-process acceptance suite, and the 31-check Podman acceptance suite passed again. A production browser preview also loaded the self-hosted font, favicon, and sidebar mark without console or rendering errors.

| ARM64 image | Local uncompressed size |
| --- | ---: |
| Original release image | 320,851,307 bytes |
| Optimized Alpine release image | 108,579,965 bytes |
| Official Alpine runtime base | 107,559,240 bytes |
| Compared official distroless runtime base | 126,096,748 bytes |

The reduction is 66%. These are local image sizes, not compressed registry transfer sizes. The tested image is available locally as `localhost/exponential:release`; it has not been published.

The production acceptance suite starts an isolated application process and a token-protected compatible provider. It covers an empty first boot, manual creation, uploads of all three sample charters, measurements, PM assessment, communications artifacts and approval/download, zero-budget behavior, user attribution and role restrictions, invalid credentials, saved token use, persistence across restart, and restart after deleting the last project. Its temporary database and settings are separate from normal application data and are removed afterward.

Focused regression tests cover request-local identity, independent user state, initial workspace creation without sample projects, preservation of existing profile data, settings revisions and token redaction, endpoint changes without token forwarding, provider snapshots, retention of advanced environment configuration, conservative approval extraction, and streamed Unicode.

Repeat from the repository root:

```sh
bun run check
bun run test:e2e
```

## Browser and real-provider checks

The production preview uses `data/release-preview.sqlite` and its separate settings file. Existing application data and `.env` were preserved. The preview retains four projects and two selectable users for review:

- Support Triage Assistant, created by uploading its charter through the browser.
- Invoice Review Assistant — sample and Internal Knowledge Search — sample, created through the live-provider acceptance script.
- Manual Release Walkthrough, created from scratch through the browser.

The provider was vLLM at `https://llm.almckay.io/v1`, serving `Qwen3.6-35B-A3B-NVFP4`. Connection configuration and testing succeeded through Workspace settings. All three documents produced project suggestions; a real PM assessment produced a proposal, and a communications run persisted a draft. No external messages were sent. This endpoint did not require a token; correct/incorrect token handling and token persistence were exercised against the local token-required fixture instead.

Browser verification covered document review and creation, manual creation, profile editing, adding a workspace member, user/role selectors, administrator settings, disabled viewer edits, independent identities in two tabs, and cross-tab updates. Desktop and narrow layouts were inspected. Value, Roadmap, Development, Governance, and Agents rendered with the sample data, and the final browser log inspection reported no warnings or errors.

During the live document test, the model suggested an unsupported committee approval. It was excluded before project creation. The setup prompt and normalization were tightened, and committee approval is now excluded by default until explicitly selected during review. Model suggestions still require human review.

To repeat the live provider smoke test on a disposable instance after configuring its provider:

```sh
E2E_BASE_URL=http://localhost:3100 bun packages/server/e2e/live.ts --confirm-fixtures
```

This command creates sample projects and consumes the configured provider. It deliberately retains its results for inspection.

## Remaining validation and scope

- Podman image build and container acceptance passed. Neither Docker Engine nor a Compose provider was installed, so Compose orchestration itself was not executed. AMD64 and backup/restore on the intended host remain to be validated.
- Local validation used Bun 1.4.2, and the container build verified the pinned Bun 1.3.11 toolchain. The local Nix flake check passed; hosted CI has not run yet.
- vLLM is the representative real compatible provider tested. Other providers, their authentication schemes, and every optional integration were not individually tested.
- User and role selection is self-declared, not authentication or verified authorization. The supported deployment is one application process and one shared SQLite workspace on a trusted access path.
- The checks exercise the principal release workflows; they are not exhaustive browser coverage of every control, load testing, or high-availability validation.

See [deployment instructions](deployment.md) for first-use checks, configuration, backups, rollback, and the remaining authentication boundary.
