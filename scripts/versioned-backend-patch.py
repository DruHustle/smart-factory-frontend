"""Add optimistic AAS revisions and update compensation to DeviceService."""

from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "smart-factory-backend"


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text()
    if old not in source:
        if new in source:
            return
        raise RuntimeError(f"Expected source block not found in {path}")
    path.write_text(source.replace(old, new, 1))


dto = BACKEND / "src/Services/DeviceService/Application/DTOs/AssetProvisionRequest.cs"
replace_once(
    dto,
    '    [StringLength(32)] public string? RatedUnit { get; init; }\n',
    '    [StringLength(32)] public string? RatedUnit { get; init; }\n'
    '    [Range(1, int.MaxValue)] public int AasVersion { get; init; } = 1;\n'
    '    [Range(1, int.MaxValue)] public int? ExpectedAasVersion { get; init; }\n',
)

builder = BACKEND / "src/Services/DeviceService/Application/Services/AasDocumentsBuilder.cs"
replace_once(
    builder,
    '            ["assetInformation"] = new Dictionary<string, object?>\n',
    '            ["administration"] = new Dictionary<string, object?> { ["version"] = asset.AasVersion.ToString(System.Globalization.CultureInfo.InvariantCulture), ["revision"] = "0" },\n'
    '            ["assetInformation"] = new Dictionary<string, object?>\n',
)
for old_template_version in ('"3", nameplateElements.ToArray()', '"2", new object[]', '"1", new object[]'):
    replace_once(
        builder,
        old_template_version,
        'asset.AasVersion.ToString(System.Globalization.CultureInfo.InvariantCulture), ' + old_template_version.split(', ', 1)[1],
    )

service = BACKEND / "src/Services/DeviceService/Application/Services/AasProvisioningService.cs"
old_update = '''    public async Task<Dictionary<string, object?>> UpdateAsync(AssetProvisionRequest input, CancellationToken ct)
    {
        var documents = AasDocumentsBuilder.Build(input);
        foreach (var submodel in documents.Submodels)
            await SendJsonAsync(HttpMethod.Put, RepositoryUri($"submodels/{EncodeId((string)submodel["id"]!)}"), submodel, ct);
        await SendJsonAsync(HttpMethod.Put, RepositoryUri($"shells/{EncodeId(input.AssetId)}"), documents.Shell, ct);
        await SendJsonAsync(HttpMethod.Put, RegistryUri($"shell-descriptors/{EncodeId(input.AssetId)}"), BuildDescriptor(input), ct);
        return Result(documents);
    }
'''
new_update = '''    public async Task<Dictionary<string, object?>> UpdateAsync(AssetProvisionRequest input, CancellationToken ct)
    {
        if (input.ExpectedAasVersion is null || input.AasVersion != input.ExpectedAasVersion.Value + 1)
            throw new AasVersionConflictException("AAS update must include the next revision and expected current revision.");

        var documents = AasDocumentsBuilder.Build(input);
        var currentSubmodels = new List<PreviousAasResource>();
        foreach (var submodel in documents.Submodels)
        {
            var id = (string)submodel["id"]!;
            var current = await ReadCurrentResourceAsync(RepositoryUri($"submodels/{EncodeId(id)}"), ct);
            var idShort = (string)submodel["idShort"]!;
            if (!HasExpectedRevision(current.Payload, idShort, input.ExpectedAasVersion.Value))
                throw new AasVersionConflictException($"AAS submodel {idShort} has changed since revision {input.ExpectedAasVersion.Value}.");
            currentSubmodels.Add(current);
        }

        var shell = await ReadCurrentResourceAsync(RepositoryUri($"shells/{EncodeId(input.AssetId)}"), ct);
        if (!HasExpectedRevision(shell.Payload, "AssetAdministrationShell", input.ExpectedAasVersion.Value))
            throw new AasVersionConflictException("AAS shell has changed since the expected revision.");
        var descriptor = await ReadCurrentResourceAsync(RegistryUri($"shell-descriptors/{EncodeId(input.AssetId)}"), ct);

        var updated = new List<PreviousAasResource>();
        try
        {
            for (var index = 0; index < documents.Submodels.Count; index++)
            {
                var model = documents.Submodels[index];
                await SendJsonAsync(HttpMethod.Put, currentSubmodels[index].Uri, model, ct);
                updated.Add(currentSubmodels[index]);
            }
            await SendJsonAsync(HttpMethod.Put, shell.Uri, documents.Shell, ct);
            updated.Add(shell);
            await SendJsonAsync(HttpMethod.Put, descriptor.Uri, BuildDescriptor(input), ct);
            updated.Add(descriptor);
        }
        catch (Exception error)
        {
            foreach (var resource in updated.AsEnumerable().Reverse())
            {
                try { await SendJsonAsync(HttpMethod.Put, resource.Uri, resource.Payload, ct); }
                catch (Exception rollbackError) { logger.LogError(rollbackError, "AAS revision rollback failed for {ResourcePath}.", resource.Uri.AbsolutePath); }
            }
            if (error is HttpRequestException { StatusCode: HttpStatusCode.Conflict or HttpStatusCode.PreconditionFailed })
                throw new AasVersionConflictException("AAS repository rejected a stale revision update.");
            throw;
        }
        return Result(documents);
    }

    private sealed record PreviousAasResource(Uri Uri, JsonElement Payload);

    private async Task<PreviousAasResource> ReadCurrentResourceAsync(Uri uri, CancellationToken ct)
    {
        var token = await GetAccessTokenAsync(ct);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new AasVersionConflictException("The expected AAS resource no longer exists in the repository.");
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Configured AAS service returned HTTP {(int)response.StatusCode} while reading the current revision.", null, response.StatusCode);
        await using var body = await response.Content.ReadAsStreamAsync(ct);
        using var document = await JsonDocument.ParseAsync(body, cancellationToken: ct);
        return new PreviousAasResource(uri, document.RootElement.Clone());
    }

    private static bool HasExpectedRevision(JsonElement resource, string idShort, int expectedVersion)
    {
        if (!resource.TryGetProperty("administration", out var administration) ||
            !administration.TryGetProperty("version", out var versionElement) ||
            versionElement.ValueKind != JsonValueKind.String ||
            !int.TryParse(versionElement.GetString(), out var actualVersion))
            return idShort == "AssetAdministrationShell" && expectedVersion == 1;

        if (actualVersion == expectedVersion) return true;
        // Accept the original template-major values once for assets created
        // before this revision ledger was introduced.
        var legacyTemplateVersion = idShort switch { "Nameplate" => 3, "TechnicalData" => 2, "MaintenanceInstructions" => 1, _ => 0 };
        return expectedVersion == 1 && actualVersion == legacyTemplateVersion;
    }
'''
replace_once(service, old_update, new_update)
replace_once(
    service,
    'public sealed class AasProvisioningConfigurationException(string message) : Exception(message);\n',
    'public sealed class AasProvisioningConfigurationException(string message) : Exception(message);\n'
    'public sealed class AasVersionConflictException(string message) : Exception(message);\n',
)

controller = BACKEND / "src/Services/DeviceService/API/Controllers/AssetsController.cs"
replace_once(
    controller,
    '        catch (AasProvisioningConfigurationException error) { return StatusCode(503, new { error = error.Message }); }\n'
    '        catch (Exception error) { logger.LogError(error, "AAS asset update failed.");',
    '        catch (AasProvisioningConfigurationException error) { return StatusCode(503, new { error = error.Message }); }\n'
    '        catch (AasVersionConflictException error) { return Conflict(new { error = error.Message }); }\n'
    '        catch (Exception error) { logger.LogError(error, "AAS asset update failed.");',
)

# Registry descriptors must advertise the same AAS interface profile as the
# configured API release. The AASX importer creates equivalent descriptors.
for relative in (
    "src/Services/DeviceService/Application/Services/AasProvisioningService.cs",
    "src/Services/DeviceService/Application/Services/AasProvisioningService.Aasx.cs",
):
    path = BACKEND / relative
    replace_once(path, '["interface"] = "AAS-3.0"', '["interface"] = "AAS-3.2"')

print("Applied version-checked AAS updates and repository rollback handling.")
