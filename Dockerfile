FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-fund

FROM dependencies AS pdf-tools
RUN apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install --yes --no-install-recommends cmake g++ make pkg-config libjpeg-dev zlib1g-dev
COPY scripts/install-pdf-tools.mjs ./scripts/install-pdf-tools.mjs
COPY release/toolchain.json ./release/toolchain.json
RUN node scripts/install-pdf-tools.mjs

FROM dependencies AS builder
COPY next.config.ts next-env.d.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts/build-server.mjs ./scripts/build-server.mjs
COPY release/toolchain.json ./release/toolchain.json
COPY release/third-party ./release/third-party
RUN npm run build

FROM dependencies AS runtime-dependencies
RUN npm ci --omit=dev --ignore-scripts --no-fund

FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CREST_BIND_ADDRESS=0.0.0.0 PORT=3000
COPY --from=runtime-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/.local/server ./server
COPY --from=pdf-tools --chown=node:node /app/.local/tools/pdf/qpdf ./.local/tools/pdf/qpdf
COPY --from=builder --chown=node:node /app/release/third-party ./release/third-party
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server/main.mjs"]
