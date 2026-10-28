# Build with the dashboard as the default context and a pinned backend named context:
# docker buildx build --build-context backend=../smart-factory-backend -f deploy/render/Dockerfile .
FROM node:22-bookworm-slim AS node-build
ARG SOURCE_REVISION
ARG BACKEND_SOURCE_REVISION
ARG EDGE_SOURCE_REVISION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY server ./server
COPY shared ./shared
COPY drizzle ./drizzle
COPY scripts/bootstrap-admin.ts scripts/migrate-dashboard.ts ./scripts/
COPY scripts/showcase ./scripts/showcase
COPY scripts/infrastructure ./scripts/infrastructure
RUN pnpm exec esbuild server/_core/index.ts --bundle --platform=node --target=node22 --format=esm --packages=external --external:../../vite.config --outfile=/compiled/server/_core/index.mjs \
    && pnpm exec esbuild scripts/showcase/install.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=/compiled/scripts/showcase/install.mjs \
    && pnpm exec esbuild scripts/infrastructure/record-recovery.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=/compiled/scripts/infrastructure/record-recovery.mjs \
    && pnpm exec esbuild scripts/bootstrap-admin.ts scripts/migrate-dashboard.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outdir=/compiled/scripts --out-extension:.js=.mjs

FROM node:22-bookworm-slim AS node-dependencies
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY scripts/prepare-runtime.mjs ./scripts/
RUN node scripts/prepare-runtime.mjs && pnpm install --prod --frozen-lockfile

FROM mcr.microsoft.com/dotnet/sdk:10.0.403-noble AS backend-build
WORKDIR /source
COPY --from=backend global.json ./
COPY --from=backend src/ ./src/
RUN dotnet publish src/Services/DeviceService/DeviceService.csproj -c Release -o /published/device /p:UseAppHost=false
RUN dotnet publish src/Services/TelemetryService/TelemetryService.csproj -c Release -o /published/telemetry /p:UseAppHost=false
RUN dotnet publish src/Services/IdentityService/IdentityService.csproj -c Release -o /published/identity /p:UseAppHost=false
RUN dotnet publish src/Services/AnalyticsService/AnalyticsService.csproj -c Release -o /published/analytics /p:UseAppHost=false
RUN dotnet publish src/Services/NotificationService/NotificationService.csproj -c Release -o /published/notification /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0.14-noble AS runtime
ARG SOURCE_REVISION
ARG BACKEND_SOURCE_REVISION
ARG EDGE_SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION io.smartfactory.backend.revision=$BACKEND_SOURCE_REVISION io.smartfactory.edge.revision=$EDGE_SOURCE_REVISION
ENV SOURCE_REVISION=$SOURCE_REVISION BACKEND_SOURCE_REVISION=$BACKEND_SOURCE_REVISION EDGE_SOURCE_REVISION=$EDGE_SOURCE_REVISION
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends supervisor python3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=node-dependencies /usr/local/bin/node /usr/local/bin/node
RUN node -e 'for(const name of ["SOURCE_REVISION","BACKEND_SOURCE_REVISION","EDGE_SOURCE_REVISION"])if(!/^[a-f0-9]{40}$/.test(process.env[name]??""))throw Error("Invalid build source identity: "+name)'
WORKDIR /app
COPY --from=node-dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=node-dependencies --chown=app:app /app/package.json ./
COPY --from=node-build --chown=app:app /compiled/ ./
COPY --chown=app:app drizzle ./drizzle
COPY --chown=app:app fixtures/equipment ./fixtures/equipment
COPY --chown=app:app docs/equipment-view.md ./docs/equipment-view.md
COPY --chown=app:app docs/onesa ./docs/onesa
COPY --chown=app:app README.md API_DOCUMENTATION.md AUTHENTICATION.md LOGIN_TROUBLESHOOTING.md IMPLEMENTATION_GUIDE.md RENDER_DEPLOYMENT.md SYSTEM_DIAGRAMS.md ARCHITECTURE_DOCUMENTATION.md ./
COPY --chown=app:app docs/*.md ./docs/
COPY --from=backend-build --chown=app:app /published/device /services/device
COPY --from=backend-build --chown=app:app /published/telemetry /services/telemetry
COPY --from=backend-build --chown=app:app /published/identity /services/identity
COPY --from=backend-build --chown=app:app /published/analytics /services/analytics
COPY --from=backend-build --chown=app:app /published/notification /services/notification
COPY --from=backend deploy/migrations/ /app/telemetry-migrations/
COPY --chown=app:app deploy/render/ ./deploy/render/
ENV NODE_ENV=production ASPNETCORE_ENVIRONMENT=Production DOTNET_ENVIRONMENT=Production \
    API_ONLY=true BACKEND_DEPLOYMENT_MODE=render-bundle \
    AAS_PROVISIONING_API_URL=http://127.0.0.1:3102/api/assets \
    INTERNAL_TELEMETRY_SINK_URL=http://127.0.0.1:10000/api/internal/telemetry \
    TELEMETRY_MIGRATIONS_DIR=/app/telemetry-migrations \
    TRUST_PROXY=loopback RENDER_SERVICE_ROLE=all
USER app
EXPOSE 10000
HEALTHCHECK --interval=15s --timeout=6s --start-period=60s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:${PORT:-10000}/health/live || exit 1
ENTRYPOINT ["python3", "/app/deploy/render/entrypoint.py"]
