using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Frank.Api.Services;

namespace Frank.Api.Tests;

// Regresja: "Sprawdź połączenie" KSeF zwracało 502 na KAŻDYM środowisku.
// 1) Send() wysyłał ścieżki z wiodącym "/", więc HttpClient porzucał segment
//    /v2 z BaseAddress i requesty lądowały w .../auth/challenge zamiast
//    .../v2/auth/challenge (KSeF: 404).
// 2) POST /auth/ksef-token zwraca 202 z authenticationToken jako OBIEKT
//    { token, validUntil }, a klient czytał go jak płaski string — polling
//    statusu szedłby z Bearer "<json>" i dostał 401.
public sealed class KsefClientTests
{
    private sealed class CaptureFactory(Func<HttpRequestMessage, HttpResponseMessage> respond)
        : IHttpClientFactory
    {
        public HttpRequestMessage? Last { get; private set; }
        public HttpClient CreateClient(string name) => new(new CaptureHandler(this, respond));
        private sealed class CaptureHandler(CaptureFactory f, Func<HttpRequestMessage, HttpResponseMessage> r)
            : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage req, CancellationToken ct)
            {
                f.Last = req;
                return Task.FromResult(r(req));
            }
        }
    }

    private static HttpResponseMessage Json(string body,
        HttpStatusCode code = HttpStatusCode.OK) => new(code)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    [Theory]
    [InlineData("test", "https://api-test.ksef.mf.gov.pl/v2/")]
    [InlineData("demo", "https://api-demo.ksef.mf.gov.pl/v2/")]
    [InlineData("prod", "https://api.ksef.mf.gov.pl/v2/")]
    public async Task Sciezki_ZachowujaV2(string srodowisko, string baza)
    {
        var f = new CaptureFactory(_ => Json("{}"));
        var ksef = new KsefClient(f);
        await ksef.PobierzUpo(srodowisko, new KsefClient.SesjaApi("a", "r"), "SES", "FKT");
        Assert.StartsWith(baza + "sessions/SES/invoices/FKT/upo",
            f.Last!.RequestUri!.ToString());
    }

    [Fact]
    public async Task Logowanie_CalyPrzeplywTokenem()
    {
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest("CN=ksef-test", rsa,
            HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var cert = req.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        var certB64 = Convert.ToBase64String(cert.RawData);

        string? bearerPrzyStatusie = null;
        var f = new CaptureFactory(req =>
        {
            var path = req.RequestUri!.AbsolutePath;
            // Każde wywołanie KSeF 2.0 musi iść pod /v2/ na każdym środowisku.
            Assert.StartsWith("/v2/", path);
            if (path.EndsWith("/auth/challenge"))
                return Json("""{"challenge":"CH-1","timestamp":"2026-10-09T00:00:00Z","timestampMs":1791564536118}""");
            if (path.EndsWith("/security/public-key-certificates"))
                return Json("[{\"certificate\":\"" + certB64 + "\",\"publicKeyId\":\"K1\",\"usage\":[\"KsefTokenEncryption\",\"SymmetricKeyEncryption\"]}]");
            if (path.EndsWith("/auth/ksef-token"))
                return Json("""{"referenceNumber":"REF123","authenticationToken":{"token":"AT","validUntil":"2026-10-10T00:00:00Z"}}""",
                    HttpStatusCode.Accepted);
            if (path.EndsWith("/auth/REF123"))
            {
                bearerPrzyStatusie = req.Headers.Authorization?.Parameter;
                return Json("""{"status":{"code":200,"description":"OK"}}""");
            }
            if (path.EndsWith("/auth/token/redeem"))
                return Json("""{"accessToken":{"token":"ACC","validUntil":"2026-10-10T00:00:00Z"},"refreshToken":{"token":"RFR","validUntil":"2026-10-10T00:00:00Z"}}""");
            return Json("nieznana ścieżka: " + path, HttpStatusCode.NotFound);
        });

        var ksef = new KsefClient(f);
        var sesja = await ksef.ZalogujTokenem("test", "526-000-00-00", "TOKEN-XYZ");

        Assert.Equal("ACC", sesja.AccessToken);
        Assert.Equal("RFR", sesja.RefreshToken);
        // Polling statusu musi iść z wyłuskanym tokenem "AT", nie z całym obiektem JSON.
        Assert.Equal("AT", bearerPrzyStatusie);
    }
}
