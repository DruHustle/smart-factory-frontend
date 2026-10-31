# Documentation Index

## Setup and operations

- [README](README.md): prerequisites, local setup, roles, assets, and verification
- [Implementation guide](IMPLEMENTATION_GUIDE.md)
- [Oracle API/worker and Vercel production release](deploy/oracle/README.md)
- [Operating and recovery guide](docs/operations.md)
- [Historical local/Render reference](RENDER_DEPLOYMENT.md)
- [Production readiness review and acceptance evidence](docs/production-readiness-review.md)
- [Factory troubleshooting](docs/troubleshooting.md)

## Application

- [API overview](API.md)
- [Authentication and roles](AUTHENTICATION.md)
- [Login troubleshooting](LOGIN_TROUBLESHOOTING.md)
- [Smart Factory Assistant configuration and data boundaries](docs/assistant.md)
- [Factory layouts, mouse grabbing and fullscreen](docs/factory-layouts.md)
- [Floor plan, process/P&ID and electrical diagrams](docs/factory-diagrams.md)
- [Editable, resettable demo sandbox](docs/editable-demo.md)
- [Complete demonstration and capability boundaries](docs/complete-demonstration.md)
- [Digital passport publication and printing](docs/access-and-publication.md)
- [Factory loading, storage and exit screenshots](docs/evidence/factory-flow-20261030/README.md)
- [Released factory graphics and FX/TSN screenshots](docs/evidence/release-20261030/README.md)
- [Architecture](docs/architecture.md)
- [Request flows](docs/api-flows.md)
- [Database and migrations](docs/database-schema.md)

## Industrial interoperability

- [Industrial device connectivity: drivers, typed tags, FX and TSN commissioning](docs/industrial-device-connectivity.md)
- [Industrial connectivity implementation verification](docs/industrial-connectivity-verification.md)
- [Connected Raspberry Pi 5, ESP32 WROVER and DHT11 bench test](docs/pi-dht11-bench.md)
- [OPC UA FX and TSN: concepts, diagnostics and commissioning](docs/fx-tsn.md)
- [Assistant explanations of FX, TSN and evidence](docs/assistant-concepts.md)
- [System diagrams and image downloads](SYSTEM_DIAGRAMS.md)

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
- [OPC UA FX and TSN](docs/fx-tsn.pdf)

Edit Markdown sources and regenerate PDFs with `pnpm docs:pdf`. The generator updates `docs/pdf-manifest.json`; `pnpm docs:check` rejects missing, modified or stale PDF/source pairs and diagram images. The same command exports the architecture and FX/TSN diagrams as SVG and PNG.
