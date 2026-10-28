# Documentation Index

## Setup and operations

- [README](README.md): prerequisites, local setup, roles, assets, and verification
- [Implementation guide](IMPLEMENTATION_GUIDE.md)
- [Complete local and Vercel/Render release guide](RENDER_DEPLOYMENT.md)
- [Production readiness review and acceptance evidence](docs/production-readiness-review.md)
- [Factory troubleshooting](docs/troubleshooting.md)

## Application

- [API overview](API.md)
- [Authentication and roles](AUTHENTICATION.md)
- [Login troubleshooting](LOGIN_TROUBLESHOOTING.md)
- [Smart Factory Assistant configuration and data boundaries](docs/assistant.md)
- [Architecture](docs/architecture.md)
- [Request flows](docs/api-flows.md)
- [Database and migrations](docs/database-schema.md)

## Industrial interoperability

- [Authorization, assets, and AAS](docs/authorization-and-aas.md)
- [AASX import and edge synchronization](docs/AASX-and-Edge-Configuration.md)
- [Smart Factory Assistant API and data boundaries](API.md#api-overview)
- [AutomationML integration boundary](docs/automationml-integration.md)
- [.NET API and MQTT contract](https://github.com/DruHustle/smart-factory-backend/blob/main/API-SPEC.md)
- [Raspberry Pi gateway](https://github.com/DruHustle/smart-factory-edge/blob/master/raspberry-pi/README.md)
- [ESP32 WROVER](https://github.com/DruHustle/smart-factory-edge/blob/master/esp32-wrover/README.md)

## PDF guides

- [Architecture](docs/architecture.pdf)
- [API flows](docs/api-flows.pdf)
- [Database schema](docs/database-schema.pdf)

Edit Markdown sources and regenerate PDFs with `pnpm docs:pdf`. The generator updates `docs/pdf-manifest.json`; `pnpm docs:check` rejects missing, modified or stale PDF/source pairs.
