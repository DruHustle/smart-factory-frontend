FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM dependencies AS development
COPY . .
ENV NODE_ENV=development
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node fixtures/equipment ./fixtures/equipment
COPY --chown=node:node docs/equipment-view.md ./docs/equipment-view.md
COPY --chown=node:node docs/onesa ./docs/onesa
COPY --chown=node:node README.md API_DOCUMENTATION.md AUTHENTICATION.md LOGIN_TROUBLESHOOTING.md IMPLEMENTATION_GUIDE.md RENDER_DEPLOYMENT.md SYSTEM_DIAGRAMS.md ARCHITECTURE_DOCUMENTATION.md ./
COPY --chown=node:node docs/architecture.md docs/system-architecture.md docs/authorization-and-aas.md docs/AASX-and-Edge-Configuration.md docs/automationml-integration.md docs/api-flows.md docs/database-schema.md docs/assistant.md docs/troubleshooting.md ./docs/
COPY --from=build --chown=node:node /app/dist/public ./dist/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
