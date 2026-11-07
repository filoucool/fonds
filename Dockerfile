FROM node:22-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin archiver
WORKDIR /app
COPY --from=build /src /app
COPY scripts/git-askpass.sh /usr/local/bin/archiver-askpass
COPY docker/entrypoint.sh /usr/local/bin/archiver-entrypoint
RUN chmod 755 /usr/local/bin/archiver-askpass /usr/local/bin/archiver-entrypoint
ENV HOST=0.0.0.0 \
  PORT=8080 \
  DATA_DIR=/data \
  ARCHIVER_ASKPASS=/usr/local/bin/archiver-askpass \
  NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/archiver-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
