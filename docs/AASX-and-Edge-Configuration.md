# AASX Import and Edge Configuration

## Create an industrial asset

The **Assets** page offers **Quick Create (Form)** for an internally described machine and **Import Package (.aasx)** for a vendor package. Both paths create the same application asset record and AAS repository entries. AASX imports retain the original package and its embedded attachments in the configured IDTA AASX File Server. Existing vendor shells are protected from accidental form replacement; form edits create a versioned revision and reject stale updates.

The browser sends the import to `POST /api/assets/import` with multipart field `file`. The Node API checks the signed-in engineer/admin role and forwards the package to the private .NET DeviceService using a server-only provisioning token. The parser validates the OPC package relationships and reads model parts without extracting ZIP paths to disk. The configured limits are 50 MB compressed, 250 MB expanded, 25 MB per AAS model, 2,000 package parts, and 25 shells per import.

## Parser SDK and supported model versions

DeviceService uses the official generated AAS Core 3.1 C# SDK (`AasCore.Aas3_1`) for model validation. Its validation reader is stricter and older than the model data accepted by the package boundary:

- AAS JSON is validated through a temporary copy with AAS 3.2 `administration.createdAt` and `administration.updatedAt` removed. The imported JSON retains the original fields and other model data.
- AAS XML with the AAS 3.0 or 3.2 namespace is normalized in memory to the namespace expected by the 3.1 reader. AAS 3.2 administration dates are restored to the parsed JSON model.
- Embedded files remain in the original package and are uploaded to the AASX File Server; the parser does not unpack arbitrary package paths onto the host filesystem.

This compatibility path does not make the 3.1 SDK a full AAS 3.2 validator. Validate vendor content against the target repository's advertised profile, the current IDTA metamodel, and each applicable submodel template before production ingestion. The package version and the embedded AAS metamodel version are separate: for example, the IDTA AASX Package File Format 3.2.0 example contains an AAS model using the AAS 3.0 XML namespace.

### Run the real package parser test

The repository test project accepts a local corpus through `AASX_TEST_CORPUS_DIR`. The downloaded IDTA specification ZIP includes `examples/IDTA-01005_Example.aasx`; unzip the source ZIP, point the variable to its `examples` directory, and run the focused tests from the backend repository:

```bash
unzip -q ~/Downloads/aas-specs-aasx-3.2.0.zip -d /tmp/aas-specs-aasx-3.2.0
cd /path/to/smart-factory-backend
AASX_TEST_CORPUS_DIR=/tmp/aas-specs-aasx-3.2.0/aas-specs-aasx-3.2.0/examples \
  dotnet test src/SmartFactory.Tests/SmartFactory.Tests.csproj \
  --filter FullyQualifiedName~AasxPackageParserTests
```

The external package is a test input and is not copied into this repository. The test verifies parsing from the real OPC container and checks the extracted shell and submodel model. Add licensed vendor packages to a private CI corpus to broaden coverage; record package provenance and expected model profile with each sample.

## Gateway synchronization

Industrial machines are created as **Assets**. **Devices** registers the Raspberry Pi edge gateway identity and shows connectivity; attach a machine to a gateway and configure its protocol and tag mapping from the asset's AAS management view. Supported mapping types include MQTT, OPC UA, Modbus TCP/RTU, and serial.

After an engineer provisions or changes a gateway mapping, DeviceService publishes a complete retained QoS 1 `replace_asset_configuration` desired-state message to the gateway command topic. The Raspberry Pi validates the schema and gateway identity, writes the profile atomically with owner-only permissions, reloads its polling loop, and publishes an acknowledgement. Broker publication means the message was accepted by the broker; check the gateway acknowledgement before treating the configuration as applied.

The gateway relays sensor telemetry to the platform. The WROVER connects only to the Raspberry Pi's local broker; it does not connect directly to CloudAMQP or the dashboard. Keep per-gateway topic ACLs, TLS, protocol credentials, and machine safety controls configured at the site. This platform is not a safety-rated control system.

See the [Raspberry Pi gateway guide](https://github.com/DruHustle/smart-factory-edge/blob/master/raspberry-pi/README.md), [ESP32 WROVER guide](https://github.com/DruHustle/smart-factory-edge/blob/master/esp32-wrover/README.md), and the [AAS permissions and deployment guide](authorization-and-aas.md).
