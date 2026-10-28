"""Add a backend regression test for version-checked repository updates."""

from pathlib import Path

backend = Path(__file__).resolve().parents[2] / "smart-factory-backend"
test_file = backend / "src/SmartFactory.Tests/AasProvisioningTests.cs"
source = test_file.read_text()
anchor = '''    [Fact]
    public void RejectsMissingRequiredManufacturerAddress()
'''
addition = '''    [Fact]
    public async Task UpdatesExpectedRevisionAndRejectsAStaleEditor()
    {
        var handler = new RevisionHandler();
        var service = CreateService(handler);
        await service.CreateAsync(Asset(), CancellationToken.None);

        var revisionTwo = Asset() with { AasVersion = 2, ExpectedAasVersion = 1, ManufacturerStreet = "Updated Street 2" };
        await service.UpdateAsync(revisionTwo, CancellationToken.None);
        var writesAfterUpdate = handler.Requests.Count(request => request.Method == HttpMethod.Put);
        Assert.Equal(5, writesAfterUpdate);

        foreach (var request in handler.Requests.Where(request => request.Method == HttpMethod.Put && request.Body.Contains("administration", StringComparison.Ordinal)))
        {
            using var model = JsonDocument.Parse(request.Body);
            Assert.Equal("2", model.RootElement.GetProperty("administration").GetProperty("version").GetString());
        }

        await Assert.ThrowsAsync<AasVersionConflictException>(() => service.UpdateAsync(revisionTwo, CancellationToken.None));
        Assert.Equal(writesAfterUpdate, handler.Requests.Count(request => request.Method == HttpMethod.Put));
    }

'''
if addition not in source:
    if anchor not in source:
        raise RuntimeError(f"Expected insertion point not found in {test_file}")
    source = source.replace(anchor, addition + anchor, 1)

source = source.replace(
    '["AAS_OIDC_TOKEN_URL"] = "https://identity.example/token", ["AAS_OIDC_CLIENT_ID"] = "test-client", ["AAS_OIDC_CLIENT_SECRET"] = "test-secret",',
    '["AAS_OIDC_TOKEN_URL"] = "https://identity.example/token", ["AAS_OIDC_CLIENT_ID"] = $"test-client-{Guid.NewGuid():N}", ["AAS_OIDC_CLIENT_SECRET"] = "test-secret",',
    1,
)
source = source.replace(
    "private static AasProvisioningService CreateService(CaptureHandler handler)",
    "private static AasProvisioningService CreateService(HttpMessageHandler handler)",
    1,
)

class_anchor = '''    private sealed record CapturedRequest(HttpMethod Method, string Path, string Body, string? BearerToken);
'''
handler_addition = '''    private sealed class RevisionHandler : HttpMessageHandler
    {
        private readonly Dictionary<string, string> resources = new(StringComparer.Ordinal);
        public List<CapturedRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add(new CapturedRequest(request.Method, path, body, request.Headers.Authorization?.Parameter));
            if (path == "/token")
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { access_token = "test-aas-token", expires_in = 300 }), Encoding.UTF8, "application/json") };
            if (request.Method == HttpMethod.Get && resources.TryGetValue(path, out var existing))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(existing, Encoding.UTF8, "application/json") };
            if (request.Method == HttpMethod.Put)
            {
                if (!resources.ContainsKey(path)) return new HttpResponseMessage(HttpStatusCode.NotFound);
                resources[path] = body;
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }
            if (request.Method == HttpMethod.Post)
            {
                using var document = JsonDocument.Parse(body);
                var root = document.RootElement;
                var id = root.TryGetProperty("id", out var idProperty) ? idProperty.GetString() : null;
                var targetPath = path.EndsWith("/shells", StringComparison.Ordinal)
                    ? path + "/" + Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(id!))
                    : path.EndsWith("/submodels", StringComparison.Ordinal)
                        ? path + "/" + Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(id!))
                        : path + "/" + Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(id!));
                resources[targetPath] = body;
                return new HttpResponseMessage(HttpStatusCode.Created);
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }
    }

'''
if handler_addition not in source:
    if class_anchor not in source:
        raise RuntimeError(f"Expected handler insertion point not found in {test_file}")
    source = source.replace(class_anchor, handler_addition + class_anchor, 1)

test_file.write_text(source)
print("Added backend AAS revision and stale-editor regression coverage.")
