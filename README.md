# Smart Factory IoT

One industrial workspace for AAS-backed assets, independent devices, gateways, native 3D equipment and OT security evidence. React, Vite and the existing orange/white/cyan themes share an Express/tRPC API and PostgreSQL inventory.

Production topology is **Vercel UI → Oracle ARM64 API**, with a separate **singleton Oracle telemetry/notification worker** and the existing private BaSyx stack. Render workflows are retained only for gated rollback history. See the [current deployment runbook](deploy/oracle/README.md), [architecture](docs/architecture.md) and [operating guide](docs/operations.md). Dated qualification documents establish only their recorded revision and environment; they do not establish the current runtime.

[Product redesign, F01–F20 disposition and acceptance](docs/product-experience-qualification.md) · [Before/after screenshots](docs/evidence/product-experience/README.md)

## Local development

Use Node 22.12+, pnpm 10, PostgreSQL 16 and Redis. Companion services use the pinned .NET 10 LTS SDK in the backend repository; edge dependencies are pinned in the edge repository.

```bash
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

Replace all placeholder credentials with distinct random values. Bind local dependencies to loopback. Configure `DATABASE_URL`, `DATABASE_SSL_MODE=disable`, `REDIS_URL` and a unique `JWT_SECRET` of at least 32 bytes. Production connections require verified TLS and provider CA material. Never commit environment files.

```bash
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. Create the first individual administrator using the [documented private bootstrap and recovery workflow](docs/access-and-publication.md). Public registration cannot grant factory access.

## Workspaces

- **Overview** leads with supported counts, attention and actual observation evidence.
- **Assets & devices** is the authoritative searchable, paginated inventory. Contextual item sections expose telemetry, AAS, connectivity, diagnostics, activity, security and 3D only where supported.
- **Monitoring** retains values, source units, acquisition/receipt times, quality and freshness on mobile. Gateways open their connectivity workspace.
- **Alerts** contains process investigations, assignment, notes and explicit downtime confirmation. **Cybersecurity** owns separate findings, evidence, sources, incidents and reviewed policies.
- **Analytics** aggregates the complete selected evidence range in SQL; bounded chart buckets retain missing-data gaps. Exports describe scope and completeness.
- **3D inspection** runs independently with the existing detailed reference geometry, component tree, inspector, explode/reassemble, section caps, ghost housings, saved views and accessible BOM fallback. A reference model is illustrative; parent observations are not component measurements.
- **Assistant** is read-only and uses the same authorized evidence scope. Local fallback works without a provider. **Administration** contains users, integrations, recorded audits, settings and operating evidence. Notifications remain owner-scoped in the header.

Registration saves identity, explicit links and a reviewed software route. It does not install credentials, publish a gateway profile or establish physical commissioning. Protocol secrets stay outside browser records and published mappings. Native OTA remains unavailable until a verified updater is installed.

## Access and evidence

Individual viewer/operator/engineer/admin roles apply on private installations. Shared reserved demo identities and public-demo deployments are read-only and see approved demonstration records only. They cannot mutate operational data, create privileged users, issue commands, export private data or retry email. Fixture targets also remain read-only for individual users.

Manual production readings are retired. Ingestion validates identity, source/asset links, provenance, engineering conversions, route and duplicate delivery. Unknown identities and route mismatches enter bounded quarantine. Delayed, retained, bad-quality, simulated, replayed or unclassified evidence may be historical without becoming current physical state. Explicit live mode is still subject to current-observation eligibility. Unknown units remain unknown.

Demo visibility is persisted, administrator controlled and refreshed per request. Viewing never seeds. The deterministic showcase is an explicit CLI operation limited to disposable local `_e2e` storage:

```bash
SHOWCASE_SEED=true DOTENV_CONFIG_PATH=/dev/null node --import tsx scripts/showcase/seed.ts
```

The showcase retains its recorded simulation period and labels; a disconnected commissioning example is separate. Existing unverified production records are not deleted by this workflow.

Public product passports require private preview, authorized selected-field publication and a revocable public identity. Reviewed maintenance/end-of-life guidance is asset-specific. The voluntary-prototype disclaimer remains.

## Verification

```bash
pnpm check
pnpm test
pnpm build
pnpm e2e:workspace
pnpm e2e:experience
pnpm e2e:equipment
pnpm e2e:security
pnpm deployment:check
pnpm docs:check
```

Database-backed suites require explicit disposable local test storage. Browser runners own and remove their own Compose projects. They do not commission physical hardware or send real email. See [operating and acceptance evidence](docs/operations.md) for cross-service, image and recovery qualification.

The backend is one non-root image with six supervised processes split into four API and two worker processes. Vercel remains a separate static artifact. A runtime contract exposes actual build sources, migration hashes and capabilities. The UI rejects incompatible APIs; promotion additionally requires a compatible recent worker receipt and a final current-main check. Readiness alone is not release compatibility.

## Boundaries

Software acknowledgement and broker acceptance do not prove physical movement or recipient delivery. Commanded servo angles are not measured feedback. Software control is not an emergency stop. OEE/RUL, calibrated energy/emissions, financial metrics and predictive maintenance require validated inputs. Security findings are not compliance certificates. Physical commissioning, external Onesa consumer acceptance and production promotion are separate acceptance outcomes.

[API workflows](docs/api-flows.md) · [AAS and authorization](docs/authorization-and-aas.md) · [Equipment](docs/equipment-view.md) · [Onesa contract](docs/onesa/CONSUMER_HANDOFF.md)

The bundled native equipment catalogue also includes an [illustrative Raspberry Pi 4 Model B](fixtures/equipment/raspberry-pi-4b/README.md). See [3D delivery and loading](docs/3d-model-loading.md) for the loading pipeline and verification.

**Assets & devices → Factory models** opens a graphical, read-only catalogue of seven native references, including a conveyor, six-axis robot, control cabinet, ball valve and process tank. Explore their components, explosion, sections and ghost housings without creating factory records. See the [factory model inventory and generation guide](fixtures/equipment/factory/README.md).
