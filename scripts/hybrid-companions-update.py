"""Apply the AASX import and MQTT edge-sync changes to the two sibling repositories."""

from pathlib import Path

backend = Path(__file__).resolve().parents[2] / "smart-factory-backend"
edge = Path(__file__).resolve().parents[2] / "smart-factory-edge"


def write(repo: Path, relative: str, content: str) -> None:
    path = repo / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


controller = r'''using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SmartFactory.Services.DeviceService.Application.DTOs;
using SmartFactory.Services.DeviceService.Application.Services;

namespace SmartFactory.Services.DeviceService.API.Controllers;

[ApiController]
[Route("api/assets")]
public sealed class AssetsController(AasProvisioningService provisioner, EdgeConfigurationPublisher edgePublisher, IConfiguration configuration, ILogger<AssetsController> logger) : ControllerBase
{
    private const long MaxAasxBytes = 50L * 1024 * 1024;

    [HttpPost, AllowAnonymous]
    public async Task<IActionResult> Create([FromBody] AssetProvisionRequest asset, CancellationToken ct)
    {
        if (!HasProvisioningToken()) return Unauthorized(new { error = "A valid provisioning service token is required." });
        try { return Ok(await provisioner.CreateAsync(asset, ct)); }
        catch (AasProvisioningConfigurationException error) { return StatusCode(503, new { error = error.Message }); }
        catch (Exception error) { logger.LogError(error, "AAS asset provisioning failed."); return StatusCode(502, new { error = "AAS repository or registry provisioning failed." }); }
    }

    [HttpPut, AllowAnonymous]
    public async Task<IActionResult> Update([FromBody] AssetProvisionRequest asset, CancellationToken ct)
    {
        if (!HasProvisioningToken()) return Unauthorized(new { error = "A valid provisioning service token is required." });
        try { return Ok(await provisioner.UpdateAsync(asset, ct)); }
        catch (AasProvisioningConfigurationException error) { return StatusCode(503, new { error = error.Message }); }
        catch (Exception error) { logger.LogError(error, "AAS asset update failed."); return StatusCode(502, new { error = "AAS repository or registry update failed." }); }
    }

    [HttpDelete, AllowAnonymous]
    public async Task<IActionResult> Delete([FromBody] AssetProvisionRequest asset, CancellationToken ct)
    {
        if (!HasProvisioningToken()) return Unauthorized(new { error = "A valid provisioning service token is required." });
        try { return Ok(await provisioner.DeleteAsync(asset, ct)); }
        catch (AasProvisioningConfigurationException error) { return StatusCode(503, new { error = error.Message }); }
        catch (Exception error) { logger.LogError(error, "AAS asset compensation failed."); return StatusCode(502, new { error = "AAS repository or registry cleanup failed." }); }
    }

    [HttpPost("import"), AllowAnonymous, RequestSizeLimit(MaxAasxBytes + 64 * 1024), RequestFormLimits(MultipartBodyLengthLimit = MaxAasxBytes + 64 * 1024)]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Import([FromForm] IFormFile? file, CancellationToken ct)
    {
        if (!HasProvisioningToken()) return Unauthorized(new { error = "A valid provisioning service token is required." });
        if (file is null || file.Length is <= 0 or > MaxAasxBytes || !Path.GetExtension(file.FileName).Equals(".aasx", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "Upload one .aasx file no larger than 50 MB." });
        if (!string.IsNullOrWhiteSpace(file.ContentType) && file.ContentType is not ("application/aas+zip" or "application/octet-stream"))
            return BadRequest(new { error = "The uploaded file must use the AASX ZIP media type." });

        try
        {
            await using var input = file.OpenReadStream();
            await using var buffer = new MemoryStream(checked((int)file.Length));
            await input.CopyToAsync(buffer, ct);
            if (buffer.Length > MaxAasxBytes) return BadRequest(new { error = "AASX package exceeds the 50 MB limit." });
            var bytes = buffer.ToArray();
            if (bytes.Length < 4 || bytes[0] != (byte)'P' || bytes[1] != (byte)'K') return BadRequest(new { error = "The package is not a ZIP-based AASX file." });
            return Ok(await provisioner.ImportAasxAsync(bytes, Path.GetFileName(file.FileName), ct));
        }
        catch (InvalidDataException error) { return BadRequest(new { error = error.Message }); }
        catch (AasProvisioningConfigurationException error) { return StatusCode(503, new { error = error.Message }); }
        catch (Exception error) { logger.LogError(error, "AASX import failed."); return StatusCode(502, new { error = "AASX validation or repository import failed." }); }
    }

    [HttpDelete("import"), AllowAnonymous]
    public async Task<IActionResult> RollbackImport([FromBody] AasxImportReceipt receipt, CancellationToken ct)
    {
        if (!HasProvisioningToken()) return Unauthorized(new { error = "A valid provisioning service token is required." });
        try { await provisioner.RollbackAasxAsync(receipt, ct); return Ok(new { rolledBack = true }); }
        catch (Exception error) { logger.LogError(error, "AASX compensating cleanup failed."); return StatusCode(502, new { error = "AASX compensating cleanup failed." }); }
    }

    [HttpPost("sync"), AllowAnonymous]
    public async Task<IActionResult> Sync([FromBody] EdgeConfigurationRequest request, CancellationToken ct)
    {
        if (!HasProvisioningToken()) return Unauthorized(new { error = "A valid provisioning service token is required." });
        try { await edgePublisher.PublishAsync(request, ct); return Ok(new { published = true }); }
        catch (ArgumentException error) { return BadRequest(new { error = error.Message }); }
        catch (InvalidOperationException error) { return StatusCode(503, new { error = error.Message }); }
        catch (Exception error) { logger.LogError(error, "Edge configuration publish failed."); return StatusCode(502, new { error = "MQTT configuration publication failed." }); }
    }

    private bool HasProvisioningToken()
    {
        var expected = configuration["AAS_PROVISIONING_TOKEN"];
        if (string.IsNullOrWhiteSpace(expected) || Encoding.UTF8.GetByteCount(expected) < 32) return false;
        var provided = Request.Headers["X-AAS-Provisioning-Token"].ToString();
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(provided));
    }
}

public sealed record AasxImportReceipt(string PackageId, string[] AssetIds, string[] SubmodelIds, string[] ConceptDescriptionIds);
'''
write(backend, "src/Services/DeviceService/API/Controllers/AssetsController.cs", controller)

parser = r'''using System.IO.Compression;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using System.Text.Json.Nodes;
using AasJsonization = AasCore.Aas3_1.Jsonization;
using AasXmlization = AasCore.Aas3_1.Xmlization;

namespace SmartFactory.Services.DeviceService.Application.Services;

/// <summary>Reads package relationships without extracting untrusted ZIP paths to disk.</summary>
public static class AasxPackageParser
{
    private const string PackageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string AasRelationships = "http://admin-shell.io/aasx/relationships";
    private const string LegacyAasRelationships = "http://www.admin-shell.io/aasx/relationships";
    private const long MaxExpandedBytes = 250L * 1024 * 1024;
    private const long MaxModelBytes = 25L * 1024 * 1024;

    public static JsonObject Parse(byte[] package)
    {
        if (package.Length is <= 0 or > 50 * 1024 * 1024) throw new InvalidDataException("AASX package must be between 1 byte and 50 MB.");
        using var memory = new MemoryStream(package, writable: false);
        using var archive = new ZipArchive(memory, ZipArchiveMode.Read, leaveOpen: false);
        if (archive.Entries.Count is < 1 or > 2_000) throw new InvalidDataException("AASX package has an invalid number of ZIP entries.");
        long expandedBytes = 0;
        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.Ordinal);
        foreach (var entry in archive.Entries)
        {
            ValidatePartName(entry.FullName);
            expandedBytes = checked(expandedBytes + entry.Length);
            if (entry.Length > MaxExpandedBytes || expandedBytes > MaxExpandedBytes) throw new InvalidDataException("AASX package expands beyond the 250 MB safety limit.");
            if (!entry.FullName.EndsWith('/') && !entries.TryAdd(entry.FullName, entry)) throw new InvalidDataException("AASX package contains duplicate part names.");
        }

        var rootRels = ReadRelationships(Required(entries, "_rels/.rels"));
        var originRelationship = rootRels.FirstOrDefault(r => IsType(r.Type, "aasx-origin"));
        var originTarget = originRelationship?.Target;
        if (originRelationship is null || originRelationship.External || string.IsNullOrWhiteSpace(originTarget)) throw new InvalidDataException("AASX package is missing its required internal aasx-origin relationship.");
        var originPart = ResolvePart("", originTarget);
        _ = Required(entries, originPart);
        var originRelsPart = RelationshipPart(originPart);
        var modelParts = ReadRelationships(Required(entries, originRelsPart))
            .Where(r => IsType(r.Type, "aas-spec") && !r.External)
            .Select(r => ResolvePart(originPart, r.Target))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (modelParts.Length == 0) throw new InvalidDataException("AASX package has no aas-spec model relationship.");

        Exception? lastError = null;
        foreach (var partName in modelParts)
        {
            var entry = Required(entries, partName);
            if (entry.Length > MaxModelBytes) throw new InvalidDataException("AAS core model exceeds the 25 MB model limit.");
            try { return Deserialize(ReadEntry(entry)); }
            catch (Exception error) when (error is JsonException or XmlException or InvalidOperationException or ArgumentException)
            { lastError = error; }
        }
        throw new InvalidDataException("No supported AAS 3.1 JSON or XML core model was found in the AASX package.", lastError);
    }

    private static JsonObject Deserialize(byte[] bytes)
    {
        // Package tools commonly emit a UTF-8 BOM. Ignore it for format detection
        // and JSON parsing; XmlReader handles BOM and declared XML encodings itself.
        var jsonOffset = bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }) ? 3 : 0;
        var firstIndex = jsonOffset;
        while (firstIndex < bytes.Length && char.IsWhiteSpace((char)bytes[firstIndex])) firstIndex++;
        var first = firstIndex < bytes.Length ? bytes[firstIndex] : (byte)0;
        if (first == (byte)'{')
        {
            var node = JsonNode.Parse(bytes.AsSpan(jsonOffset)) ?? throw new InvalidDataException("AAS JSON model is empty.");
            var environment = AasJsonization.Deserialize.EnvironmentFrom(node);
            return AasJsonization.Serialize.ToJsonObject(environment);
        }
        var hasUnicodeXmlBom = bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE }) || bytes.AsSpan().StartsWith(new byte[] { 0xFE, 0xFF }) ||
            bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE, 0x00, 0x00 }) || bytes.AsSpan().StartsWith(new byte[] { 0x00, 0x00, 0xFE, 0xFF });
        if (first == (byte)'<' || hasUnicodeXmlBom)
        {
            using var input = new MemoryStream(bytes, writable: false);
            using var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxModelBytes });
            reader.MoveToContent();
            var environment = AasXmlization.Deserialize.EnvironmentFrom(reader);
            return AasJsonization.Serialize.ToJsonObject(environment);
        }
        throw new InvalidDataException("AAS core model must be JSON or XML.");
    }

    private sealed record PackageRelationship(string Type, string Target, bool External);

    private static List<PackageRelationship> ReadRelationships(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 1_000_000 });
        var root = XDocument.Load(reader).Root;
        if (root?.Name != XName.Get("Relationships", PackageRelationships)) throw new InvalidDataException("AASX package relationship part is malformed.");
        return root.Elements(XName.Get("Relationship", PackageRelationships)).Select(element =>
        {
            var type = (string?)element.Attribute("Type") ?? "";
            var target = (string?)element.Attribute("Target") ?? "";
            if (target.Length == 0) throw new InvalidDataException("AASX relationship target is missing.");
            return new PackageRelationship(type, target, string.Equals((string?)element.Attribute("TargetMode"), "External", StringComparison.OrdinalIgnoreCase));
        }).ToList();
    }

    private static bool IsType(string type, string suffix) => type.Equals($"{AasRelationships}/{suffix}", StringComparison.Ordinal) || type.Equals($"{LegacyAasRelationships}/{suffix}", StringComparison.Ordinal);

    private static string RelationshipPart(string part)
    {
        var slash = part.LastIndexOf('/');
        return slash < 0 ? $"_rels/{part}.rels" : $"{part[..slash]}/_rels/{part[(slash + 1)..]}.rels";
    }

    private static string ResolvePart(string source, string target)
    {
        if (target.Contains('?') || target.Contains('#') || target.Contains('\\')) throw new InvalidDataException("AASX relationship target is not a package path.");
        var decoded = Uri.UnescapeDataString(target);
        var pieces = decoded.StartsWith('/') ? new List<string>() : source.Split('/', StringSplitOptions.RemoveEmptyEntries).SkipLast(1).ToList();
        foreach (var piece in decoded.TrimStart('/').Split('/'))
        {
            if (piece is "" or ".") continue;
            if (piece == "..")
            {
                if (pieces.Count == 0) throw new InvalidDataException("AASX relationship escapes the package root.");
                pieces.RemoveAt(pieces.Count - 1);
                continue;
            }
            pieces.Add(piece);
        }
        if (pieces.Count == 0) throw new InvalidDataException("AASX relationship target is empty.");
        return string.Join('/', pieces);
    }

    private static void ValidatePartName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.StartsWith('/') || name.Contains('\\') || name.Contains(':') || name.Any(char.IsControl))
            throw new InvalidDataException("AASX package contains an unsafe ZIP part name.");
        if (name.Split('/').Any(part => part is ".." or ".")) throw new InvalidDataException("AASX package contains a non-normalized ZIP part name.");
    }

    private static ZipArchiveEntry Required(IReadOnlyDictionary<string, ZipArchiveEntry> entries, string path) =>
        entries.TryGetValue(path, out var entry) ? entry : throw new InvalidDataException($"AASX package is missing required part '{path}'.");

    private static byte[] ReadEntry(ZipArchiveEntry entry)
    {
        using var input = entry.Open();
        using var output = new MemoryStream(checked((int)entry.Length));
        var buffer = new byte[81920];
        var total = 0L;
        int read;
        while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
        {
            total += read;
            if (total > MaxModelBytes) throw new InvalidDataException("AAS core model expands beyond the 25 MB model limit.");
            output.Write(buffer, 0, read);
        }
        return output.ToArray();
    }
}
'''
write(backend, "src/Services/DeviceService/Application/Services/AasxPackageParser.cs", parser)

aasx_service = r'''using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using SmartFactory.Services.DeviceService.API.Controllers;

namespace SmartFactory.Services.DeviceService.Application.Services;

public sealed partial class AasProvisioningService
{
    public async Task<Dictionary<string, object?>> ImportAasxAsync(byte[] package, string fileName, CancellationToken ct)
    {
        var environment = AasxPackageParser.Parse(package);
        var shells = environment["assetAdministrationShells"] as JsonArray ?? throw new InvalidDataException("AAS environment contains no shells.");
        var submodels = environment["submodels"] as JsonArray ?? [];
        var concepts = environment["conceptDescriptions"] as JsonArray ?? [];
        if (shells.Count is < 1 or > 25) throw new InvalidDataException("An AASX package must contain 1 to 25 shells.");

        var shellIds = shells.Select(node => node?["id"]?.GetValue<string>()).ToArray();
        var submodelIds = submodels.Select(node => node?["id"]?.GetValue<string>()).ToArray();
        var conceptIds = concepts.Select(node => node?["id"]?.GetValue<string>()).ToArray();
        if (shellIds.Any(string.IsNullOrWhiteSpace) || shellIds.Distinct(StringComparer.Ordinal).Count() != shellIds.Length ||
            submodelIds.Any(string.IsNullOrWhiteSpace) || submodelIds.Distinct(StringComparer.Ordinal).Count() != submodelIds.Length ||
            conceptIds.Any(string.IsNullOrWhiteSpace) || conceptIds.Distinct(StringComparer.Ordinal).Count() != conceptIds.Length)
            throw new InvalidDataException("AAS package contains missing or duplicate global identifiers.");

        var createdSubmodels = new List<string>();
        var createdConcepts = new List<string>();
        var createdShells = new List<string>();
        var createdDescriptors = new List<string>();
        string? packageId = null;
        try
        {
            foreach (var model in submodels)
            {
                var id = model!["id"]!.GetValue<string>();
                await SendJsonAsync(HttpMethod.Post, RepositoryUri("submodels"), model, ct);
                createdSubmodels.Add(id);
            }
            foreach (var concept in concepts)
            {
                var id = concept!["id"]!.GetValue<string>();
                await SendJsonAsync(HttpMethod.Post, RepositoryUri("concept-descriptions"), concept, ct);
                createdConcepts.Add(id);
            }
            foreach (var shell in shells)
            {
                var id = shell!["id"]!.GetValue<string>();
                await SendJsonAsync(HttpMethod.Post, RepositoryUri("shells"), shell, ct);
                createdShells.Add(id);
                await SendJsonAsync(HttpMethod.Post, RegistryUri("shell-descriptors"), BuildImportedDescriptor(shell), ct);
                createdDescriptors.Add(id);
            }
            packageId = await UploadAasxAsync(package, fileName, shellIds.Select(id => id!).ToArray(), ct);
            return new Dictionary<string, object?>
            {
                ["packageId"] = packageId,
                ["assetAdministrationShells"] = shells,
                ["submodels"] = submodels,
                ["conceptDescriptions"] = concepts,
            };
        }
        catch (Exception error)
        {
            await RollbackRecordsAsync(createdDescriptors, createdShells, createdSubmodels, createdConcepts, ct);
            if (packageId is not null) await DeletePackageIfPresentAsync(packageId, ct);
            throw new InvalidOperationException("AASX repository or package-service registration failed.", error);
        }
    }

    public async Task RollbackAasxAsync(AasxImportReceipt receipt, CancellationToken ct)
    {
        await RollbackRecordsAsync(receipt.AssetIds, receipt.AssetIds, receipt.SubmodelIds, receipt.ConceptDescriptionIds, ct);
        await DeletePackageIfPresentAsync(receipt.PackageId, ct);
    }

    private Dictionary<string, object?> BuildImportedDescriptor(JsonNode shell)
    {
        var id = shell["id"]?.GetValue<string>() ?? throw new InvalidDataException("AAS shell is missing its identifier.");
        var globalAssetId = shell["assetInformation"]?["globalAssetId"]?.GetValue<string>();
        var repository = ConfiguredUri("AAS_REPOSITORY_URL");
        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["globalAssetId"] = globalAssetId,
            ["endpoints"] = new[] { new Dictionary<string, object?>
            {
                ["interface"] = "AAS-3.0",
                ["protocolInformation"] = new Dictionary<string, object?>
                {
                    ["href"] = repository.ToString().TrimEnd('/'),
                    ["endpointProtocol"] = repository.Scheme == "https" ? "HTTPS" : "HTTP",
                    ["endpointProtocolVersion"] = new[] { "1.1" }, ["securityAttributes"] = Array.Empty<object>(),
                },
            } },
        };
    }

    private async Task<string> UploadAasxAsync(byte[] package, string fileName, string[] shellIds, CancellationToken ct)
    {
        var packageService = JoinBase(ConfiguredUri("AASX_FILE_SERVER_URL"), "packages");
        var query = string.Join("&", shellIds.Select(id => $"aasIds={Uri.EscapeDataString(id)}"));
        packageService = new UriBuilder(packageService) { Query = query }.Uri;
        var token = await GetAccessTokenAsync(ct);
        using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(package);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/aas+zip");
        content.Add(file, "file", Path.GetFileName(fileName.Replace('\\', '/')));
        using var request = new HttpRequestMessage(HttpMethod.Post, packageService) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"AASX File Server returned HTTP {(int)response.StatusCode}.", null, response.StatusCode);
        await using var body = await response.Content.ReadAsStreamAsync(ct);
        using var document = await JsonDocument.ParseAsync(body, cancellationToken: ct);
        if (!document.RootElement.TryGetProperty("packageId", out var id) || id.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(id.GetString()))
            throw new InvalidDataException("AASX File Server did not return a packageId.");
        return id.GetString()!;
    }

    private async Task RollbackRecordsAsync(IReadOnlyCollection<string> descriptorIds, IReadOnlyCollection<string> shellIds, IReadOnlyCollection<string> submodelIds, IReadOnlyCollection<string> conceptIds, CancellationToken ct)
    {
        foreach (var id in descriptorIds.Reverse()) await DeleteBestEffortAsync(RegistryUri($"shell-descriptors/{EncodeId(id)}"), ct);
        foreach (var id in shellIds.Reverse()) await DeleteBestEffortAsync(RepositoryUri($"shells/{EncodeId(id)}"), ct);
        foreach (var id in submodelIds.Reverse()) await DeleteBestEffortAsync(RepositoryUri($"submodels/{EncodeId(id)}"), ct);
        foreach (var id in conceptIds.Reverse()) await DeleteBestEffortAsync(RepositoryUri($"concept-descriptions/{EncodeId(id)}"), ct);
    }

    private async Task DeleteBestEffortAsync(Uri uri, CancellationToken ct)
    {
        try { await DeleteIfPresentAsync(uri, ct); }
        catch (Exception error) { logger.LogError(error, "AASX rollback could not remove {ResourcePath}.", uri.AbsolutePath); }
    }

    private async Task DeletePackageIfPresentAsync(string packageId, CancellationToken ct)
    {
        var uri = JoinBase(ConfiguredUri("AASX_FILE_SERVER_URL"), $"packages/{EncodeId(packageId)}");
        await DeleteBestEffortAsync(uri, ct);
    }
}
'''
write(backend, "src/Services/DeviceService/Application/Services/AasProvisioningService.Aasx.cs", aasx_service)

publisher = r'''using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;
using MQTTnet;
using MQTTnet.Client;
using MQTTnet.Protocol;

namespace SmartFactory.Services.DeviceService.Application.Services;

public sealed record EdgeConfigurationRequest(int SchemaVersion, string GatewayDeviceId, List<EdgeAssetConfiguration> Assets);
public sealed record EdgeAssetConfiguration(string AssetId, string AssetName, string Protocol, string? Endpoint, List<Dictionary<string, JsonElement>> TagMappings);

/// <summary>Publishes a complete desired-state profile; commands cannot execute arbitrary code.</summary>
public sealed class EdgeConfigurationPublisher(IConfiguration configuration, IHostEnvironment environment)
{
    private static readonly Regex SafeTopicPart = new("^[A-Za-z0-9_-]{1,64}$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public async Task PublishAsync(EdgeConfigurationRequest request, CancellationToken ct)
    {
        if (request.SchemaVersion != 1 || !SafeTopicPart.IsMatch(request.GatewayDeviceId) || request.Assets is null || request.Assets.Count > 25)
            throw new ArgumentException("Edge profile version, gateway id, or asset count is invalid.");
        foreach (var asset in request.Assets)
        {
            if (string.IsNullOrWhiteSpace(asset.AssetId) || asset.AssetId.Length > 128 || asset.AssetId.Any(char.IsControl) ||
                !new[] { "mqtt", "opcua", "modbus_tcp", "modbus_rtu", "serial" }.Contains(asset.Protocol, StringComparer.Ordinal) ||
                (asset.Endpoint?.Length ?? 0) > 512 || (asset.Endpoint is not null && Regex.IsMatch(asset.Endpoint, @"://[^/]*@")) ||
                asset.TagMappings.Count > 100)
                throw new ArgumentException("Edge asset profile contains an invalid identifier, protocol, endpoint, or mapping count.");
        }

        var host = configuration["MqttBrokerHost"] ?? configuration["Mqtt:Host"];
        if (string.IsNullOrWhiteSpace(host)) throw new InvalidOperationException("MQTT broker is not configured.");
        var port = int.TryParse(configuration["MqttBrokerPort"] ?? configuration["Mqtt:Port"], out var value) ? value : 1883;
        var username = configuration["MqttUsername"] ?? configuration["Mqtt:Username"];
        var password = configuration["MqttPassword"] ?? configuration["Mqtt:Password"];
        var tlsSetting = configuration["MqttUseTls"] ?? configuration["Mqtt:UseTls"];
        var useTls = string.Equals(tlsSetting, "true", StringComparison.OrdinalIgnoreCase) || tlsSetting == "1";
        if (environment.IsProduction() && !useTls) throw new InvalidOperationException("MQTT TLS is required in Production.");

        var site = configuration["EDGE_SITE_ID"] ?? "factory-a";
        var line = configuration["EDGE_LINE_ID"] ?? "line-1";
        if (!SafeTopicPart.IsMatch(site) || !SafeTopicPart.IsMatch(line)) throw new InvalidOperationException("EDGE_SITE_ID and EDGE_LINE_ID must be safe MQTT topic segments.");
        var topicTemplate = configuration["EDGE_COMMAND_TOPIC_TEMPLATE"] ?? "factory/{site}/{line}/{device}/commands";
        var topic = topicTemplate.Replace("{site}", site, StringComparison.Ordinal)
            .Replace("{line}", line, StringComparison.Ordinal).Replace("{device}", request.GatewayDeviceId, StringComparison.Ordinal);
        if (topic.Contains('{') || topic.Contains('}') || topic.Contains('+') || topic.Contains('#')) throw new InvalidOperationException("MQTT command topic template is invalid.");

        var command = JsonSerializer.SerializeToUtf8Bytes(new { action = "replace_asset_configuration", configuration = request });
        if (command.Length > 64 * 1024) throw new ArgumentException("Edge configuration exceeds the 64 KB MQTT message limit.");
        var factory = new MqttFactory();
        using var client = factory.CreateMqttClient();
        var builder = new MqttClientOptionsBuilder().WithTcpServer(host, port).WithClientId($"smart-factory-provisioner-{Guid.NewGuid():N}").WithCleanSession().WithTimeout(TimeSpan.FromSeconds(10));
        if (!string.IsNullOrWhiteSpace(username)) builder.WithCredentials(username, password ?? "");
        if (useTls) builder.WithTlsOptions(options => options.UseTls());
        await client.ConnectAsync(builder.Build(), ct);
        try
        {
            var message = new MqttApplicationMessageBuilder().WithTopic(topic).WithPayload(command)
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce).WithRetainFlag(true).Build();
            await client.PublishAsync(message, ct);
        }
        finally
        {
            if (client.IsConnected) await client.DisconnectAsync(new MqttClientDisconnectOptionsBuilder().Build(), ct);
        }
    }
}
'''
write(backend, "src/Services/DeviceService/Application/Services/EdgeConfigurationPublisher.cs", publisher)

# Reuse the AAS OAuth client and repository helpers from the existing service.
service_path = backend / "src/Services/DeviceService/Application/Services/AasProvisioningService.cs"
service_text = service_path.read_text().replace("public sealed class AasProvisioningService(", "public sealed partial class AasProvisioningService(")
service_path.write_text(service_text)

project_path = backend / "src/Services/DeviceService/DeviceService.csproj"
project_text = project_path.read_text()
if 'PackageReference Include="AasCore.Aas3_1"' not in project_text:
    project_text = project_text.replace('    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer"', '    <PackageReference Include="AasCore.Aas3_1" Version="1.0.0" />\n    <PackageReference Include="MQTTnet" Version="4.3.6.1152" />\n    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer"')
project_path.write_text(project_text)

program_path = backend / "src/Services/DeviceService/Program.cs"
program_text = program_path.read_text()
if "MaxRequestBodySize = 55 * 1024 * 1024" not in program_text:
    program_text = program_text.replace("var builder = WebApplication.CreateBuilder(args);", "var builder = WebApplication.CreateBuilder(args);\nbuilder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 55 * 1024 * 1024);")
if "AddScoped<EdgeConfigurationPublisher>" not in program_text:
    program_text = program_text.replace("builder.Services.AddHttpClient<AasProvisioningService>()", "builder.Services.AddScoped<EdgeConfigurationPublisher>();\nbuilder.Services.AddHttpClient<AasProvisioningService>(client => client.Timeout = TimeSpan.FromMinutes(2))")
elif "AddHttpClient<AasProvisioningService>()" in program_text:
    program_text = program_text.replace("AddHttpClient<AasProvisioningService>()", "AddHttpClient<AasProvisioningService>(client => client.Timeout = TimeSpan.FromMinutes(2))")
program_path.write_text(program_text)

compose_path = backend / "docker-compose.yml"
compose_text = compose_path.read_text()
aasx_env = "      AASX_FILE_SERVER_URL: ${AASX_FILE_SERVER_URL:-}\n"
if "AASX_FILE_SERVER_URL:" not in compose_text:
    compose_text = compose_text.replace("      AAS_REPOSITORY_URL: ${AAS_REPOSITORY_URL:-}\n", "      AAS_REPOSITORY_URL: ${AAS_REPOSITORY_URL:-}\n" + aasx_env)
if "MqttBrokerHost: rabbitmq" not in compose_text:
    compose_text = compose_text.replace("      AAS_OIDC_CLIENT_SECRET: ${AAS_OIDC_CLIENT_SECRET:-}\n", "      AAS_OIDC_CLIENT_SECRET: ${AAS_OIDC_CLIENT_SECRET:-}\n      MqttBrokerHost: rabbitmq\n      MqttBrokerPort: 1883\n      MqttUsername: ${RABBITMQ_DEFAULT_USER}\n      MqttPassword: ${RABBITMQ_DEFAULT_PASS}\n      MqttUseTls: \"false\"\n      EDGE_SITE_ID: ${EDGE_SITE_ID:-factory-a}\n      EDGE_LINE_ID: ${EDGE_LINE_ID:-line-1}\n")
    compose_text = compose_text.replace("depends_on: { postgres: { condition: service_healthy } }\n    ports: [\"127.0.0.1:5001:80\"]", "depends_on: { postgres: { condition: service_healthy }, rabbitmq: { condition: service_healthy } }\n    ports: [\"127.0.0.1:5001:80\"]", 1)
compose_path.write_text(compose_text)

env_path = backend / ".env.local.example"
env_text = env_path.read_text()
if "AASX_FILE_SERVER_URL=" not in env_text:
    env_text += "AASX_FILE_SERVER_URL=\nEDGE_SITE_ID=factory-a\nEDGE_LINE_ID=line-1\n"
env_path.write_text(env_text)

# Edge command handling accepts one safe desired-state operation only.
config_path = edge / "raspberry-pi/src/config.py"
adapter_path = edge / "raspberry-pi/src/asset_adapters.py"
adapter_text = adapter_path.read_text()
if "import hashlib\n" not in adapter_text:
    adapter_text = adapter_text.replace("import json\n", "import json\nimport hashlib\nimport math\nimport os\nimport tempfile\n")
start = adapter_text.find("def load_asset_connections(path: str) -> list[dict]:")
end = adapter_text.find("\n\ndef _metric_name", start) if start >= 0 else -1
adapter_text = adapter_text[:start] + '''def validate_asset_profile(profile: dict, expected_gateway_id: str) -> list[dict]:
    """Validate a complete, versioned desired-state profile before it reaches polling."""
    if not isinstance(profile, dict) or profile.get("schemaVersion") != 1:
        raise ValueError("Unsupported edge configuration schema version")
    if profile.get("gatewayDeviceId") != expected_gateway_id:
        raise ValueError("Edge configuration targets a different gateway")
    assets = profile.get("assets")
    if not isinstance(assets, list) or len(assets) > 25:
        raise ValueError("Edge profile must contain at most 25 assets")
    validated = []
    for asset in assets:
        if not isinstance(asset, dict):
            raise ValueError("Edge asset entry must be an object")
        asset_id = asset.get("assetId")
        protocol = str(asset.get("protocol", "")).lower()
        endpoint = asset.get("endpoint") or ""
        mappings = asset.get("tagMappings") or []
        if not isinstance(asset_id, str) or not asset_id or len(asset_id) > 128 or any(char in asset_id for char in "\\r\\n+#"):
            raise ValueError("Edge asset identifier is invalid")
        if protocol not in {"mqtt", "opcua", "modbus_tcp", "modbus_rtu", "serial"}:
            raise ValueError("Edge protocol is unsupported")
        if not isinstance(endpoint, str) or len(endpoint) > 512 or ("@" in endpoint.split("://", 1)[-1].split("/", 1)[0]):
            raise ValueError("Machine endpoint is invalid or contains credentials")
        if not isinstance(mappings, list) or len(mappings) > 100 or any(not isinstance(item, dict) for item in mappings):
            raise ValueError("Tag mappings must be an array of at most 100 objects")
        for mapping in mappings:
            if set(mapping) - {"metric", "address", "nodeId", "registerType", "scale", "offset", "unit", "name"}:
                raise ValueError("Tag mapping contains unsupported fields")
            metric = mapping.get("metric")
            if metric is not None and str(metric).lower() not in SUPPORTED_METRICS:
                raise ValueError("Tag mapping contains an unsupported metric")
            scale = mapping.get("scale", 1)
            if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale):
                raise ValueError("Tag mapping scale must be a finite number")
            if "address" in mapping and (isinstance(mapping["address"], bool) or not isinstance(mapping["address"], int) or not 0 <= mapping["address"] <= 65535):
                raise ValueError("Modbus address is outside the supported range")
            if "nodeId" in mapping and (not isinstance(mapping["nodeId"], str) or len(mapping["nodeId"]) > 512):
                raise ValueError("OPC UA node id is invalid")
        validated.append({
            "assetId": asset_id,
            "assetName": str(asset.get("assetName") or asset_id)[:255],
            "protocol": protocol,
            "endpoint": endpoint,
            "tagMappings": mappings,
        })
    return validated


def save_asset_profile(path: str, profile: dict, expected_gateway_id: str) -> str:
    """Atomically persist validated configuration so it survives gateway restarts."""
    assets = validate_asset_profile(profile, expected_gateway_id)
    normalized = {"schemaVersion": 1, "gatewayDeviceId": expected_gateway_id, "assets": assets}
    payload = json.dumps(normalized, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > 64 * 1024:
        raise ValueError("Edge configuration exceeds the 64 KB limit")
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    fd, temporary = tempfile.mkstemp(prefix=".assets-", suffix=".json", dir=str(destination.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
        os.chmod(destination, 0o600)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return hashlib.sha256(payload).hexdigest()


def load_asset_connections(path: str, expected_gateway_id: str | None = None) -> list[dict]:
    if not path or not Path(path).is_file():
        return []
    with open(path, "r", encoding="utf-8") as config_file:
        config = json.load(config_file)
    gateway_id = expected_gateway_id or config.get("gatewayDeviceId")
    if not isinstance(gateway_id, str) or not gateway_id:
        raise ValueError("Edge profile has no gateway identity")
    return validate_asset_profile(config, gateway_id)
''' + adapter_text[end:] if start >= 0 and "def validate_asset_profile(" not in adapter_text else adapter_text
if "Tag mapping contains unsupported fields" not in adapter_text:
    adapter_text = adapter_text.replace(
        "        for mapping in mappings:\n",
        "        for mapping in mappings:\n            if set(mapping) - {\"metric\", \"address\", \"nodeId\", \"registerType\", \"scale\", \"offset\", \"unit\", \"name\"}:\n                raise ValueError(\"Tag mapping contains unsupported fields\")\n",
        1,
    )
adapter_path.write_text(adapter_text)

gateway_path = edge / "raspberry-pi/src/sensor_gateway.py"
gateway = gateway_path.read_text()
gateway = gateway.replace("from threading import Event, Thread", "from threading import Event, Lock, Thread")
gateway = gateway.replace("from asset_adapters import load_asset_connections, read_asset", "from asset_adapters import load_asset_connections, read_asset, save_asset_profile")
start = gateway.find("def make_mqtt_client(settings):")
end = gateway.find("\n\ndef parse_serial_line", start) if start >= 0 else -1
gateway = gateway[:start] + '''def make_mqtt_client(settings, apply_configuration=None):
    client = mqtt.Client(client_id=settings.mqtt_client_id, clean_session=True)
    if settings.mqtt_username:
        client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
    if settings.mqtt_use_tls:
        client.tls_set(ca_certs=settings.mqtt_ca_cert or None)

    expected_topic = command_topic(settings.site_id, settings.line_id, settings.device_id)

    def on_connect(_client, _userdata, _flags, rc):
        if rc == 0:
            print("[MQTT] connected")
            _client.subscribe(expected_topic, qos=1)
        else:
            print(f"[MQTT] connect failed rc={rc}")

    def on_message(_client, _userdata, msg):
        ack = {"deviceId": settings.device_id, "status": "rejected", "timestamp": int(time.time() * 1000)}
        try:
            if msg.topic != expected_topic:
                raise ValueError("Command topic does not match this gateway")
            if len(msg.payload) > 64 * 1024:
                raise ValueError("Command payload exceeds the supported size")
            command = json.loads(msg.payload.decode("utf-8", errors="strict"))
            if not isinstance(command, dict) or command.get("action") != "replace_asset_configuration":
                raise ValueError("Command action is not supported")
            profile = command.get("configuration")
            if not isinstance(profile, dict) or apply_configuration is None:
                raise ValueError("Gateway configuration handler is unavailable")
            ack["configurationHash"] = apply_configuration(profile)
            ack["status"] = "applied"
        except Exception as exc:
            ack["reason"] = str(exc)[:160]
            print(f"[MQTT] rejected edge configuration: {exc}")
        ack_topic = expected_topic + "/ack"
        _client.publish(ack_topic, json.dumps(ack), qos=1, retain=False)

    client.on_connect = on_connect
    client.on_message = on_message
    return client
''' + gateway[end:] if start >= 0 else gateway
gateway = gateway.replace("def asset_poll_loop(settings, asset_connections, publish_fn):\n    while not STOP.is_set():\n        for asset in asset_connections:", "def asset_poll_loop(settings, asset_connections, publish_fn, configuration_lock=None):\n    while not STOP.is_set():\n        if configuration_lock is None:\n            current_assets = list(asset_connections)\n        else:\n            with configuration_lock:\n                current_assets = list(asset_connections)\n        for asset in current_assets:")
gateway = gateway.replace("""    client = make_mqtt_client(settings)

    def publish_telemetry(data: dict):""".replace("\n+", "\n"), """    configuration_lock = Lock()

    def apply_configuration(profile):
        digest = save_asset_profile(settings.asset_config_file, profile, settings.device_id)
        with configuration_lock:
            asset_connections[:] = load_asset_connections(settings.asset_config_file, settings.device_id)
        return digest

    client = make_mqtt_client(settings, apply_configuration)

    def publish_telemetry(data: dict):""".replace("\n+", "\n"))
gateway = gateway.replace("Thread(target=asset_poll_loop, args=(settings, asset_connections, publish_telemetry), daemon=True).start()", "Thread(target=asset_poll_loop, args=(settings, asset_connections, publish_telemetry, configuration_lock), daemon=True).start()")
gateway = gateway.replace("    if asset_connections:\n        Thread(target=asset_poll_loop, args=(settings, asset_connections, publish_telemetry, configuration_lock), daemon=True).start()", "    Thread(target=asset_poll_loop, args=(settings, asset_connections, publish_telemetry, configuration_lock), daemon=True).start()")
gateway_path.write_text(gateway)

# Keep the Pi settings dataclass single-sourced after an earlier accidental duplicate.
config_path = edge / "raspberry-pi/src/config.py"
config = config_path.read_text()
lines = config.splitlines()
seen_ca = False
cleaned = []
for line in lines:
    if line == "    mqtt_ca_cert: str":
        if seen_ca:
            continue
        seen_ca = True
    cleaned.append(line)
config_path.write_text("\n".join(cleaned) + "\n")

tests_path = edge / "raspberry-pi/tests/test_e2e_smoke.py"
tests_text = tests_path.read_text()
if "test_gateway_applies_only_valid_configuration_command" not in tests_text:
    tests_text = tests_text.replace("""    def test_synthetic_telemetry_published_when_serial_disabled(self):""", """    def test_gateway_applies_only_valid_configuration_command(self):
        sensor_gateway = importlib.import_module("sensor_gateway")
        settings = types.SimpleNamespace(mqtt_client_id="pi-edge-01", mqtt_username="", mqtt_password="", mqtt_use_tls=False, mqtt_ca_cert="", site_id="factory-a", line_id="line-1", device_id="pi-edge-01")
        applied = []
        client = sensor_gateway.make_mqtt_client(settings, lambda profile: applied.append(profile) or "profile-hash")
        profile = {"schemaVersion": 1, "gatewayDeviceId": settings.device_id, "assets": []}
        message = types.SimpleNamespace(topic=sensor_gateway.command_topic(settings.site_id, settings.line_id, settings.device_id), payload=json.dumps({"action": "replace_asset_configuration", "configuration": profile}).encode())
        client.on_message(client, None, message)
        self.assertEqual(applied, [profile])
        ack = json.loads(client.published[-1][1])
        self.assertEqual(ack["status"], "applied")
        self.assertEqual(ack["configurationHash"], "profile-hash")

    def test_gateway_rejects_unsupported_command_action(self):
        sensor_gateway = importlib.import_module("sensor_gateway")
        settings = types.SimpleNamespace(mqtt_client_id="pi-edge-01", mqtt_username="", mqtt_password="", mqtt_use_tls=False, mqtt_ca_cert="", site_id="factory-a", line_id="line-1", device_id="pi-edge-01")
        client = sensor_gateway.make_mqtt_client(settings, lambda _profile: "never")
        message = types.SimpleNamespace(topic=sensor_gateway.command_topic(settings.site_id, settings.line_id, settings.device_id), payload=b'{"action":"execute"}')
        client.on_message(client, None, message)
        self.assertEqual(json.loads(client.published[-1][1])["status"], "rejected")

    def test_synthetic_telemetry_published_when_serial_disabled(self):""")
    tests_path.write_text(tests_text)

tests_text = tests_path.read_text()
tests_text = tests_text.replace("""    def publish(self, topic, payload, qos=0):
        self.published.append((topic, payload, qos))""".replace("\n+", "\n"), """    def publish(self, topic, payload, qos=0, retain=False):
        self.published.append((topic, payload, qos, retain))""".replace("\n+", "\n"))
tests_text = tests_text.replace("sensor_gateway.make_mqtt_client = lambda _settings: fake_client", "sensor_gateway.make_mqtt_client = lambda _settings, *_args: fake_client")
tests_text = tests_text.replace("""    def start(self):
        if self.target is not None:
            self.target(*self.args)""".replace("\n+", "\n"), """    def start(self):
        if self.target is not None:
            if getattr(self.target, \"__name__\", \"\") == \"asset_poll_loop\" and not self.args[1]:
                return
            self.target(*self.args)""".replace("\n+", "\n"))
if "test_asset_profile_is_saved_atomically_with_private_permissions" not in tests_text:
    tests_text = tests_text.replace("""    def test_opcua_fails_closed_without_secure_channel_settings(self):""", """    def test_asset_profile_is_saved_atomically_with_private_permissions(self):
        from asset_adapters import load_asset_connections, save_asset_profile
        profile = {"schemaVersion": 1, "gatewayDeviceId": "pi-edge-01", "assets": [{"assetId": "urn:test:pump", "protocol": "modbus_tcp", "endpoint": "modbus://plc:502", "tagMappings": [{"metric": "pressure", "address": 4, "registerType": "holding", "scale": 0.1}]}]}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "nested" / "assets.json"
            profile_hash = save_asset_profile(str(target), profile, "pi-edge-01")
            self.assertEqual(len(profile_hash), 64)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(load_asset_connections(str(target), "pi-edge-01")[0]["assetId"], "urn:test:pump")

    def test_asset_profile_rejects_arbitrary_mapping_fields(self):
        from asset_adapters import validate_asset_profile
        profile = {"schemaVersion": 1, "gatewayDeviceId": "pi-edge-01", "assets": [{"assetId": "urn:test:pump", "protocol": "mqtt", "endpoint": "mqtt://broker", "tagMappings": [{"metric": "pressure", "password": "must-not-be-stored"}]}]}
        with self.assertRaisesRegex(ValueError, "unsupported fields"):
            validate_asset_profile(profile, "pi-edge-01")

    def test_opcua_fails_closed_without_secure_channel_settings(self):""")
tests_path.write_text(tests_text)

write(backend, "src/SmartFactory.Tests/AasxPackageParserTests.cs", r'''using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using SmartFactory.Services.DeviceService.Application.Services;

namespace SmartFactory.Tests;

public sealed class AasxPackageParserTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ParsesAasCoreJsonAndXmlModels(bool xml)
    {
        var model = xml
            ? """<environment xmlns="https://admin-shell.io/aas/3/1"><assetAdministrationShells><assetAdministrationShell><id>urn:test:aas</id><assetInformation><assetKind>Instance</assetKind><globalAssetId>urn:test:asset</globalAssetId></assetInformation></assetAdministrationShell></assetAdministrationShells><submodels/><conceptDescriptions/></environment>"""
            : """{"assetAdministrationShells":[{"modelType":"AssetAdministrationShell","id":"urn:test:aas","assetInformation":{"assetKind":"Instance","globalAssetId":"urn:test:asset"}}],"submodels":[],"conceptDescriptions":[]}""";

        var parsed = AasxPackageParser.Parse(CreatePackage(model, xml ? "data.xml" : "data.json"));

        var shells = Assert.IsType<JsonArray>(parsed["assetAdministrationShells"]);
        Assert.Equal("urn:test:aas", shells[0]?["id"]?.GetValue<string>());
    }

    [Fact]
    public void RejectsPackagePathsThatCouldEscapeTheContainer()
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            archive.CreateEntry("../outside.txt");
        Assert.Throws<InvalidDataException>(() => AasxPackageParser.Parse(stream.ToArray()));
    }

    [Fact]
    public void RejectsPackagesWithoutTheRequiredOriginRelationship()
    {
        var package = CreatePackage("{}", "data.json", includeOrigin: false);
        Assert.Throws<InvalidDataException>(() => AasxPackageParser.Parse(package));
    }

    private static byte[] CreatePackage(string model, string modelPart, bool includeOrigin = true)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var rootRelationships = archive.CreateEntry("_rels/.rels");
            using (var writer = new StreamWriter(rootRelationships.Open(), Encoding.UTF8))
                writer.Write(includeOrigin
                    ? """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r0" Type="http://admin-shell.io/aasx/relationships/aasx-origin" Target="aasx/aasx-origin"/></Relationships>"""
                    : """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>""");
            archive.CreateEntry("aasx/aasx-origin");
            var originRelationships = archive.CreateEntry("aasx/_rels/aasx-origin.rels");
            using (var writer = new StreamWriter(originRelationships.Open(), Encoding.UTF8))
                writer.Write($"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://admin-shell.io/aasx/relationships/aas-spec" Target="{modelPart}"/></Relationships>""");
            var modelEntry = archive.CreateEntry($"aasx/{modelPart}");
            using var modelWriter = new StreamWriter(modelEntry.Open(), Encoding.UTF8);
            modelWriter.Write(model);
        }
        return stream.ToArray();
    }
}
''')

# Add the NuGet dependencies and configuration to the checked-in companion update source.
write(backend, "docs/AASX-and-Edge-Configuration.md", """# AASX Import and Edge Configuration\n\n## Create an asset\n\nThe dashboard exposes one Create Asset workflow with Quick Create and Import Package (.aasx). Both use the private DeviceService and the same AAS repository and registry. The Node API requires an engineer or administrator session, applies a 50 MB request limit, and keeps the DeviceService token server-side.\n\n`POST /api/assets` accepts the validated JSON form DTO. `POST /api/assets/import` accepts multipart field `file`; DeviceService validates the OPC package relationships, reads the AAS 3.1 JSON or XML core model without extracting ZIP paths, registers shell/submodel/concept-description records, and stores the original package and attachments with the AASX File Server. Imports are limited to 25 shells and each package must be below 50 MB and 250 MB expanded size.\n\nThe importer uses the AasCore AAS 3.1 SDK. This is not a claim of AAS metamodel 3.2 import conformance. Validate vendor packages against the exact metamodel and template profile used by the deployed AAS runtime before operational use.\n\nConfigure `AASX_FILE_SERVER_URL` to the private IDTA AASX File Server base, plus the repository, registry, and OAuth client settings. The file server must implement the IDTA package endpoint `POST /packages`.\n\n## Edge desired state\n\nWhen an asset is assigned to a live gateway, DeviceService publishes a retained, QoS 1 `replace_asset_configuration` desired-state message to `factory/{site}/{line}/{gateway}/commands`. The Python gateway accepts that single action, validates the schema and gateway id, atomically writes the profile with owner-only permissions, reloads its in-process polling loop, and sends an acknowledgement to the topic's `/ack` child. Protocol passwords and private keys are never part of the message. The broker ACL must permit each gateway to subscribe only to its own command topic and publish only to its telemetry, heartbeat, and acknowledgement topics.\n\nThe publish response confirms broker publication, not device application; monitor the gateway acknowledgement topic for application status. Use MQTT TLS and per-device credentials in production.\n""")

device_manifest = r'''apiVersion: apps/v1
kind: Deployment
metadata:
  name: smart-factory-device-service
  labels:
    app.kubernetes.io/name: smart-factory-device-service
spec:
  replicas: 2
  revisionHistoryLimit: 5
  selector:
    matchLabels:
      app.kubernetes.io/name: smart-factory-device-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app.kubernetes.io/name: smart-factory-device-service
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: device-service
          image: ghcr.io/REPLACE_ME/smart-factory-backend-device-service:REPLACE_WITH_IMMUTABLE_DIGEST
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 80
          env:
            - name: ASPNETCORE_ENVIRONMENT
              value: Production
            - name: ASPNETCORE_URLS
              value: http://+:80
            - name: ConnectionStrings__DefaultConnection
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: device-database-connection
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: dashboard-jwt-secret
            - name: AAS_PROVISIONING_TOKEN
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: aas-provisioning-token
            - name: AAS_OIDC_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: aas-oidc-client-id
            - name: AAS_OIDC_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: aas-oidc-client-secret
            - name: MqttUsername
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: mqtt-service-username
            - name: MqttPassword
              valueFrom:
                secretKeyRef:
                  name: smart-factory-backend-runtime
                  key: mqtt-service-password
            - name: AAS_REPOSITORY_URL
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: aas-repository-url
            - name: AAS_REGISTRY_URL
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: aas-registry-url
            - name: AASX_FILE_SERVER_URL
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: aasx-file-server-url
            - name: AAS_OIDC_TOKEN_URL
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: aas-oidc-token-url
            - name: MqttBrokerHost
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: mqtt-broker-host
            - name: MqttBrokerPort
              value: "8883"
            - name: MqttUseTls
              value: "true"
            - name: EDGE_SITE_ID
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: edge-site-id
            - name: EDGE_LINE_ID
              valueFrom:
                configMapKeyRef:
                  name: smart-factory-device-service
                  key: edge-line-id
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 768Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
          volumeMounts:
            - name: temporary-files
              mountPath: /tmp
          startupProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 5
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 20
            timeoutSeconds: 3
          readinessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 10
            timeoutSeconds: 5
      volumes:
        - name: temporary-files
          emptyDir:
            medium: Memory
            sizeLimit: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: smart-factory-device-service
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: smart-factory-device-service
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: smart-factory-device-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: smart-factory-device-service
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
'''
write(backend, "deploy/k8s/device-service.yaml", device_manifest)

backend_readme = backend / "README.md"
backend_readme_text = backend_readme.read_text()
if "## AASX import and edge configuration" not in backend_readme_text:
    backend_readme_text += "\n\n## AASX import and edge configuration\n\nDeviceService exposes private `POST /api/assets`, multipart `POST /api/assets/import`, and `POST /api/assets/sync` operations for the dashboard. Configure the dashboard and DeviceService with the same `AAS_PROVISIONING_TOKEN`; configure repository, registry, OAuth, `AASX_FILE_SERVER_URL`, and MQTT broker settings in the DeviceService runtime. See [AASX and Edge Configuration](docs/AASX-and-Edge-Configuration.md) and the [`deploy/k8s/device-service.yaml`](deploy/k8s/device-service.yaml) sample. The importer uses the AAS Core 3.1 SDK and does not assert arbitrary AAS 3.2 metamodel conformance.\n"
    backend_readme.write_text(backend_readme_text)

deployment_guide = backend / "docs/Deployment_Guide.md"
deployment_text = deployment_guide.read_text()
if "AASX_FILE_SERVER_URL" not in deployment_text:
    deployment_text += "\n\n## Asset provisioning, AASX, and edge publishing\n\nFor dashboard integration, keep DeviceService private inside the single Render backend image and configure the shared `AAS_PROVISIONING_TOKEN` in Render's secret settings. DeviceService requires the repository, registry, OAuth client credentials, `AASX_FILE_SERVER_URL`, and MQTT service credentials. The dashboard calls `/api/assets`, `/api/assets/import`, and `/api/assets/sync`. The AASX upload limit is 50 MB and the importer currently supports AAS core metamodel 3.1. Broker publication is not edge acknowledgement; watch the gateway `/ack` topic. Legacy Kubernetes manifests are not the supported production deployment.\n"
    deployment_guide.write_text(deployment_text)

edge_pi_readme = edge / "raspberry-pi/README.md"
edge_pi_text = edge_pi_readme.read_text()
if "## Live AAS edge profile updates" not in edge_pi_text:
    edge_pi_text += "\n\n## Live AAS edge profile updates\n\nThe gateway subscribes to `factory/{SITE_ID}/{LINE_ID}/{DEVICE_ID}/commands`. DeviceService publishes a retained QoS 1 `replace_asset_configuration` desired-state command; the gateway accepts that action only, validates `schemaVersion` and `gatewayDeviceId`, atomically persists `/etc/smart-factory/assets.json` (mode 0600), and reloads the active polling loop. A status acknowledgement is published to the command topic with `/ack` appended. The broker must enforce a per-device topic ACL and TLS; the service response means the broker accepted the publish, not that the edge host applied it.\n\nThe profile supports validated OPC UA, Modbus TCP/RTU, serial JSON, and MQTT mapping records. Do not put passwords, private keys, or user information in endpoints or mappings. Configure protocol secrets locally on the gateway. Offline desired-state is retained, so make sure broker ACLs restrict retained command publication and gateway subscription to the exact device topic.\n"
    edge_pi_readme.write_text(edge_pi_text)

print("Prepared hybrid AASX import and live edge desired-state changes for the backend and edge repositories.")
