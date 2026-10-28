"""Keep backend AAS deployment and API documentation aligned with revisions."""

from pathlib import Path

backend = Path(__file__).resolve().parents[2] / "smart-factory-backend"

def replace_once(relative: str, old: str, new: str) -> None:
    path = backend / relative
    content = path.read_text()
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f"Expected documentation text not found: {relative}")
    path.write_text(content.replace(old, new, 1))


replace_once(
    "docs/AASX-and-Edge-Configuration.md",
    "Configure `AASX_FILE_SERVER_URL` to the private IDTA AASX File Server base, plus the repository, registry, and OAuth client settings. The file server must implement the IDTA package endpoint `POST /packages`.\n",
    """Configure these private DeviceService endpoints and credentials in the runtime secret/config store:

| Variable | Purpose |
|---|---|
| `AAS_REPOSITORY_URL` | AAS Repository API for shell and submodel records |
| `AAS_REGISTRY_URL` | AAS Registry API for shell descriptors |
| `AAS_OIDC_TOKEN_URL`, `AAS_OIDC_CLIENT_ID`, `AAS_OIDC_CLIENT_SECRET` | OAuth client credentials used by DeviceService for both AAS services |
| `AASX_FILE_SERVER_URL` | AASX package and attachment service; must implement `POST /packages` |
| `AAS_PROVISIONING_TOKEN` | Shared Node-to-DeviceService credential; keep it out of browser and edge configuration |
| `MQTT_BROKER_URL` and TLS credentials | Private retained desired-state delivery to gateways |

Use the IDTA API 3.2 registry interface descriptor (`AAS-3.2`) with a matching repository endpoint. Keep these services on private networks and allow only the required service identities.

### Revision-aware form updates

`PUT /api/assets` requires `expectedAasVersion` and `aasVersion = expectedAasVersion + 1`. DeviceService reads the current shell and generated submodel revisions before updating the repository and registry. A stale edit returns HTTP 409. It keeps prior remote JSON in memory during the update and attempts compensating PUTs if a later resource update fails. The dashboard stores append-only snapshots in PostgreSQL and serializes edits per asset; the remote AAS services do not share a transaction with PostgreSQL. Imported AASX models are preserved and are not edited through this form endpoint.
""",
)

replace_once(
    "docs/Deployment_Guide.md",
    "DeviceService requires the repository, registry, OAuth client credentials, `AASX_FILE_SERVER_URL`, and MQTT service credentials.",
    "DeviceService requires `AAS_REPOSITORY_URL`, `AAS_REGISTRY_URL`, OAuth client credentials, `AASX_FILE_SERVER_URL`, and MQTT service credentials. Keep the repository and registry private; descriptors advertise the configured AAS API 3.2 interface.",
)

replace_once(
    "README.md",
    "The importer uses the AAS Core 3.1 SDK and does not assert arbitrary AAS 3.2 metamodel conformance.",
    "The importer uses the AAS Core 3.1 SDK and does not assert arbitrary AAS 3.2 metamodel conformance. Form edits require an expected AAS revision, return HTTP 409 for stale clients, and attempt compensation if a multi-resource repository/registry update fails.",
)

replace_once(
    "API-SPEC.md",
    "## TelemetryService\n",
    """## Asset provisioning API

DeviceService also exposes private dashboard-to-service endpoints under `/api/assets`. Every endpoint requires the separate `X-AAS-Provisioning-Token` service credential, compared in constant time; do not send a user JWT or expose DeviceService publicly.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/assets` | Create and register a form-generated AAS shell, submodels, and registry descriptor. |
| PUT | `/api/assets` | Update a form-managed AAS with `expectedAasVersion` and the next `aasVersion`; returns 409 for stale revisions. |
| POST | `/api/assets/import` | Validate and import an AASX package, bounded to 50 MB and 25 shells. |
| DELETE | `/api/assets/import` | Compensate a failed cross-service AASX database commit using the receipt returned by the importer. |
| POST | `/api/assets/sync` | Validate and publish a gateway's complete desired-state profile. |

Set `AAS_REPOSITORY_URL` for shells/submodels and `AAS_REGISTRY_URL` for shell descriptors. DeviceService obtains OAuth tokens from `AAS_OIDC_TOKEN_URL` using its client id and secret. `AASX_FILE_SERVER_URL` points to the private package service. `PUT` checks the repository revision before writing and returns HTTP 409 when the expected revision is stale; the dashboard keeps the immutable revision snapshots in PostgreSQL.

## TelemetryService
""",
)

print("Updated backend AAS configuration and revision documentation.")
