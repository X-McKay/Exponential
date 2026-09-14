---
name: exponential-release
description: Prepare, verify, document, containerize, or publish an Exponential release. Use for deployment work, release checks, image-size review, and release documentation.
---

# Exponential release

Follow the user's request when it conflicts with this workflow.

1. Read `docs/deployment.md` and the current release validation record.
2. Preserve the supported boundary: one trusted shared workspace, one application process, one SQLite database, and self-declared user/role selection while authentication remains deferred.
3. Never include `.env`, provider tokens, SQLite data, runtime settings, source maps, dependency trees, or local preview artifacts in an image or commit.
4. Keep ordinary startup neutral. Sample documents are fictional inputs; demo seeding is destructive and explicit.
5. Run `bun run release:check`. When a container engine is available, build the image and run `bun run container:test` against it.
6. Confirm the process runs as a non-root user, the image has health metadata, and its local uncompressed size stays below the CI ceiling.
7. Update maintained documentation and remove point-in-time notes that no longer describe the code. Run the documentation and Claude/Codex skill synchronization checks.
8. Commit, tag, push, or deploy only when the user explicitly asks for that external action.
