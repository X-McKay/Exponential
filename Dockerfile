FROM docker.io/oven/bun:1.3.11 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json oxlint.json ./
COPY README.md ./
COPY docs ./docs
COPY scripts ./scripts
COPY .agents ./.agents
COPY .claude ./.claude
COPY packages ./packages
RUN bun install --frozen-lockfile && bun run check && BUILD_SOURCEMAPS=off bun run build \
    && bun build packages/server/src/index.ts --target=bun --minify --define 'process.env.NODE_ENV="production"' --outdir=/out \
    && mkdir -p /out/data

FROM docker.io/oven/bun:1.3.11-alpine
WORKDIR /app
COPY --from=build --chown=1000:1000 /out/index.js /app/packages/server/src/index.js
COPY --from=build --chown=1000:1000 /app/packages/web/dist /app/packages/web/dist
COPY --from=build --chown=1000:1000 /out/data /app/data
USER 1000:1000
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SYNC_SOURCE=none AGENT_SCHEDULE=off EVAL_JUDGE=off GLANCE_CURATE=off VALUEFLOW_DB=/app/data/valueflow.sqlite
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD ["bun", "-e", "const r=await fetch('http://localhost:'+ (process.env.PORT || '3000') +'/api/health',{headers:process.env.VALUEFLOW_ACCESS_TOKEN?{authorization:'Bearer '+process.env.VALUEFLOW_ACCESS_TOKEN}:{}});process.exit(r.ok?0:1)"]
CMD ["bun", "/app/packages/server/src/index.js"]
