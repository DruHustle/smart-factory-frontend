# AutomationML Interoperability

## Supported export

Engineers and administrators can download a plant hierarchy as CAEX 3.0 from **Assets → Export AutomationML**. The authenticated route is `GET /api/assets/export/automationml`; it returns `application/xml` as `smart-factory.aml`. The export includes each asset's stable AAS id, type, AAS revision, lifecycle stage, manufacturer, model, and serial number. Assets are grouped by their recorded zone and location. Missing locations are represented as `Unassigned` groups.

Asset and group IDs are deterministic hashes of their source identity, so changing a display name does not change identity. The exporter escapes XML text and attributes. It does not export telemetry, protocol credentials, gateway addresses, or tag mappings.

This is a hierarchy and asset metadata exchange. It does not currently import AML, map gateway tag mappings to `DataVariable`, include AutomationML RoleClass/SystemUnitClass libraries, or perform Formal Description OWL/SHACL validation. CAEX schema validity alone does not establish semantic interoperability.

## Validation

The official CAEX 3.0 XSD used by the local validation script is stored at [`docs/schemas/CAEX_ClassModel_V.3.0.xsd`](schemas/CAEX_ClassModel_V.3.0.xsd). With `xmllint` installed, validate an exported document with:

```bash
scripts/validate-automationml.sh exported-plant.aml
```

The unit suite checks escaping, stable identity, hierarchy fields, and—when `xmllint` is present—validity against the bundled CAEX schema:

```bash
pnpm test -- server/automationml.test.ts
```

## Mapping boundary

| AutomationML information | Current export behavior |
|---|---|
| Plant/machine `InternalElement` hierarchy | Zone → location → asset grouping |
| Asset identity and classification | `AASAssetId` and `AssetType` attributes |
| AAS lifecycle/version | `LifecycleStage` and `AASVersion` attributes |
| Manufacturer product identity | `Manufacturer`, `Model`, and `SerialNumber` attributes when present |
| OPC UA, Modbus, serial, or MQTT connection details | Omitted; connection secrets and machine addressing stay on the gateway |
| Semantic libraries and `DataVariable` definitions | Not emitted by the current export |

For a future AML import or richer export, use stable CAEX identities and references, map OPC UA variables using namespace URI plus NodeId, and retain Modbus unit id, register/function, type, byte order, scale, and unit. Never use display names as identifiers or put credentials in AAS/AML documents.

## Standards references

- [AutomationML standards and specifications](https://www.automationml.org/about-automationml/specifications/)
- [AutomationML CAEX 3.0 practical guide and schema downloads](https://www.automationml.org/about-automationml/publications/amlbook/a-practical-guide/chapter-2-the-caex-and-automationml-guide/)
- [AutomationML Formal Description recommendation](https://www.automationml.org/news/application-recommendation-formal-description-for-automationml-is-available/)
- [AutomationML DataVariable best-practice recommendation](https://www.automationml.org/news/bpr-datavariable-available/)
- [IDTA submodel template repository](https://github.com/admin-shell-io/submodel-templates)
