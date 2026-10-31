# Digital passports and complete demonstration AAS models

The EU Digital Product Passport restores the printable nameplate layout: clear
identity rows, a prominent QR label and separate technical, materials and
maintenance sections. Open **Digital passport** in the editable demo, or choose
**Print EUDPP** from an authored demonstration asset. The same selected identity
is used by the passport and its downloadable AAS JSON.

## Demo QR links

The QR opens a standalone demonstration at `/passport/demo/<encoded identity>`.
It works in another browser without signing in or relying on the originating
browser's saved workspace. The versioned link contains only the selected demo
product's identifier, name, type, manufacturer label, model, serial and zone.
Other equipment, workspace settings, observations, account data and credentials
are not included. The content is clearly identified as synthetic demonstration
data. It neither publishes an operational asset nor creates a server record.

The identity is strictly validated, Unicode-safe and bounded for QR capacity.
Malformed or unsupported links show an unavailable state. An identity too large
for a reliable label keeps its model download available and explains why the QR
cannot be generated. Analytics is omitted from this standalone demonstration
view. The QR resolves an identity snapshot using the versioned authored profile;
it does not represent an immutable manufacturer publication or live telemetry.

## Complete authored models

Every supported demo family receives eleven populated submodels. Pumps, motors,
compressors, transformers, wind turbines, conveyors, tanks, valves, robot arms,
control cabinets and gateways have different specifications. Unknown types use
an explicitly generic demonstration profile.

| Submodel               | Included information                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Nameplate              | Stable asset and serial identifiers, supplied manufacturer/model labels, manufacture date, zone and clearly fictional demo contact  |
| TechnicalData          | Family-specific ratings, dimensions, mass, supply and operating characteristics with defined engineering units                      |
| HandoverDocumentation  | Three complete embedded text documents: datasheet, maintenance guide and disassembly/materials guide                                |
| Maintenance            | Example inspection tasks, service intervals, recorded history and replacement information                                           |
| MaterialComposition    | Material masses and fractions that add up to the complete illustrative assembly                                                     |
| Circularity            | Repair/disassembly guidance, service life, recovery assumptions and material streams                                                |
| SoftwareAndFirmware    | Authored component/version/support information and explicit non-deployable demo status                                              |
| BillOfMaterials        | Referenced assembly-level component breakdown, quantities and principal materials; the installed CAD/equipment BOM remains separate |
| OperationalData        | Dated synthetic observations, quality/provenance and an explicit absence of physical control                                        |
| DigitalProductPassport | Identity, profile version, issue date, scope and regulatory-status statement                                                        |
| CarbonFootprint        | An illustrative calculation with its unit, functional unit, system boundary and synthetic assumptions                               |

Normal AAS JSON includes the shell, all submodels and their ConceptDescriptions.
The models use AAS 3.0 core serialization and application-owned semantic IDs.
Measured properties carry their units in IEC 61360 concept definitions. Embedded
documents use base64 AAS Blobs, so the export does not depend on invented URLs.
These are rich application demonstrations, not claims of conformance to every
IDTA submodel template, manufacturer approval or EU DPP legal compliance.

The shared builder is deterministic: no current-time updates, random identities,
network access or live control are introduced when viewing or exporting a demo.
Existing historical fixture evidence remains intact. Newly installed fixtures
store full models. Legacy authored demo records are represented by the same
complete model in the engineering view and in API shell/export responses without
rewriting database records on read. The browser uses the shared builder for
authored demo display/export so it remains compatible during a staged API rollout.
Imported vendor AAS packages and operational assets retain their original models.

## Operational passport publication

The original authorization boundary remains in place. A private operational
preview has no public QR. An authorized engineer chooses fields, reviews guidance
and publishes an immutable snapshot. Only that reviewed snapshot receives a
public QR. Revocation makes the published link unavailable. Demo rendering never
adds generated specifications to a published operational snapshot.

## Verification

Routine CI validates all supported families and aliases using the independent,
pinned AAS Core 3.0 SDK. Additional checks resolve every model and semantic
reference, verify unique identities and engineering units, decode embedded
documents and check material/carbon arithmetic.

The browser suite decodes actual rendered QR pixels, opens the result in a fresh
anonymous browser with the API unavailable, downloads and checks the AAS JSON,
checks mobile and print layouts, and tests malformed links and field privacy.
Existing database-backed publication/revocation tests remain required.

```bash
node --import tsx scripts/showcase/export-aas.ts /tmp/smart-factory/demo-aas
python scripts/showcase/validate-aas.py /tmp/smart-factory/demo-aas
python -m pip install -r scripts/showcase/requirements-qr.txt
pnpm exec playwright test --config=playwright.passport.config.ts
```

References: [AAS normal serialization](https://industrialdigitaltwin.io/aas-specifications/IDTA-01001/v3.0.2/mappings/mappings.html),
[IEC 61360 data specification](https://industrialdigitaltwin.io/aas-specifications/IDTA-01003-a/v3.0.2/specification.html)
and the [IDTA submodel template catalog](https://github.com/admin-shell-io/submodel-templates).
