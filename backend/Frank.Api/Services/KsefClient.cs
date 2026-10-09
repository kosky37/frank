using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Frank.Api.Services;

// Klient KSeF 2.0 (fa 2.8.x): token → challenge → sesja online → wysyłka FA(3) → UPO,
// oraz odczyt metadanych faktur zakupowych. Bez podpisu kwalifikowanego:
// użytkownik wkleja token KSeF wygenerowany przez Profil Zaufany w Aplikacji Podatnika.
public sealed class KsefClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _http;

    public KsefClient(IHttpClientFactory http) => _http = http;

    public static string BaseUrl(string srodowisko) => srodowisko switch
    {
        "prod" => "https://api.ksef.mf.gov.pl/v2",
        "demo" => "https://api-demo.ksef.mf.gov.pl/v2",
        _ => "https://api-test.ksef.mf.gov.pl/v2", // "test" i domyślnie
    };

    private HttpClient Client(string srodowisko)
    {
        var c = _http.CreateClient("ksef");
        // Końcowy "/" jest istotny: ścieżki w Send() są względne (bez wiodącego "/"),
        // więc BaseAddress ".../v2/" + "auth/challenge" daje ".../v2/auth/challenge".
        // Z wiodącym "/" HttpClient porzuciłby segment /v2 i KSeF zwracał 404.
        c.BaseAddress = new Uri(BaseUrl(srodowisko) + "/");
        c.Timeout = TimeSpan.FromSeconds(30);
        return c;
    }

    private static string Relative(string path) => path.TrimStart('/');

    private static async Task<JsonElement> Send(HttpClient c, HttpMethod method, string path,
        object? body = null, string? bearer = null, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(method, Relative(path));
        if (bearer is not null)
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
            req.Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");
        using var res = await c.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new KsefException((int)res.StatusCode, $"KSeF {method} {path}: HTTP {(int)res.StatusCode} {Skrot(text)}");
        if (string.IsNullOrWhiteSpace(text))
            return JsonDocument.Parse("{}").RootElement.Clone();
        try
        {
            return JsonDocument.Parse(text).RootElement.Clone();
        }
        catch (JsonException)
        {
            throw new KsefException((int)res.StatusCode, $"KSeF {path}: nie-JSON: {Skrot(text)}");
        }
    }

    private static string Skrot(string s) => s.Length <= 400 ? s : s[..400] + "…";

    private static string Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) ? v.ValueKind switch
        {
            JsonValueKind.String => v.GetString() ?? "",
            JsonValueKind.Number => v.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => v.GetRawText(),
        } : "";

    // ---------- klucze publiczne MF ----------

    public sealed record MfKeys(RSA TokenKey, string TokenKeyId, RSA SymKey, string SymKeyId);

    public async Task<MfKeys> PobierzKlucze(string srodowisko, CancellationToken ct = default)
    {
        using var c = Client(srodowisko);
        var doc = await Send(c, HttpMethod.Get, "/security/public-key-certificates", ct: ct);
        var certs = WyciagnijListe(doc);
        RSA? tokenKey = null; string? tokenId = null;
        RSA? symKey = null; string? symId = null;
        foreach (var cert in certs)
        {
            var usage = cert.TryGetProperty("usage", out var u) && u.ValueKind == JsonValueKind.Array
                ? u.EnumerateArray().Select(x => x.GetString() ?? "").ToList()
                : [];
            var b64 = Str(cert, "certificate");
            var id = Str(cert, "publicKeyId");
            if (string.IsNullOrEmpty(b64) || string.IsNullOrEmpty(id)) continue;
            RSA rsa;
            try { rsa = GovCrypto.PublicRsaFromCertB64(b64); }
            catch { continue; }
            if (usage.Contains("KsefTokenEncryption") && tokenKey is null) { tokenKey = rsa; tokenId = id; }
            if (usage.Contains("SymmetricKeyEncryption") && symKey is null) { symKey = rsa; symId = id; }
        }
        // fallback: pierwszy certyfikat do obu zastosowań
        if ((tokenKey is null || symKey is null) && certs.Count > 0)
        {
            var first = certs[0];
            var rsa = GovCrypto.PublicRsaFromCertB64(Str(first, "certificate"));
            var id = Str(first, "publicKeyId");
            tokenKey ??= rsa; tokenId ??= id;
            symKey ??= rsa; symId ??= id;
        }
        if (tokenKey is null || symKey is null || tokenId is null || symId is null)
            throw new KsefException(502, "KSeF: brak certyfikatów klucza publicznego MF.");
        return new MfKeys(tokenKey, tokenId, symKey, symId);
    }

    private static List<JsonElement> WyciagnijListe(JsonElement doc)
    {
        if (doc.ValueKind == JsonValueKind.Array)
            return doc.EnumerateArray().ToList();
        foreach (var prop in doc.EnumerateObject())
            if (prop.Value.ValueKind == JsonValueKind.Array)
                return prop.Value.EnumerateArray().ToList();
        return [];
    }

    // ---------- uwierzytelnianie tokenem ----------

    public sealed record SesjaApi(string AccessToken, string RefreshToken);

    public async Task<SesjaApi> ZalogujTokenem(string srodowisko, string nip, string tokenKsef,
        CancellationToken ct = default)
    {
        using var c = Client(srodowisko);
        var ch = await Send(c, HttpMethod.Post, "/auth/challenge", new { }, ct: ct);
        var challenge = Str(ch, "challenge");
        var tsRaw = ch.TryGetProperty("timestampMs", out var t) ? t.GetInt64().ToString() : "";
        if (string.IsNullOrEmpty(challenge) || string.IsNullOrEmpty(tsRaw))
            throw new KsefException(502, "KSeF: pusty challenge.");
        var keys = await PobierzKlucze(srodowisko, ct);
        var plain = $"{tokenKsef}|{tsRaw}";
        var enc = GovCrypto.B64(GovCrypto.RsaOaepSha256Encrypt(Encoding.UTF8.GetBytes(plain), keys.TokenKey));
        var auth = await Send(c, HttpMethod.Post, "/auth/ksef-token", new
        {
            challenge,
            contextIdentifier = new { type = "Nip", value = new string([.. nip.Where(char.IsDigit)]) },
            encryptedToken = enc,
            publicKeyId = keys.TokenKeyId,
        }, ct: ct);
        var refNum = Str(auth, "referenceNumber");
        // POST /auth/ksef-token zwraca 202 AuthenticationInitResponse, gdzie
        // authenticationToken to OBIEKT { token, validUntil } — nie płaski string.
        var authToken = auth.TryGetProperty("authenticationToken", out var at)
            ? at.ValueKind == JsonValueKind.Object ? Str(at, "token") : at.GetString() ?? ""
            : "";
        if (string.IsNullOrEmpty(refNum) || string.IsNullOrEmpty(authToken))
            throw new KsefException(401, "KSeF: odrzucony token (brak sesji uwierzytelniania). Sprawdź token i NIP kontekstu.");

        // polling statusu (zwykle 200 od razu na TEST; na DEMO/PROD bywa OCSP w tle)
        for (var i = 0; i < 12; i++)
        {
            var st = await Send(c, HttpMethod.Get, $"/auth/{refNum}", bearer: authToken, ct: ct);
            var code = st.TryGetProperty("status", out var s) && s.TryGetProperty("code", out var cc)
                ? cc.GetInt32() : 0;
            if (code == 200) break;
            // KSeF 2.0: 100 = w toku; 4xx/5xx = niepowodzenie
            // (415 brak uprawnień, 425 unieważnione, 450 zły token, 460 certyfikat,
            // 470/480/500/550 inne błędy) — nie ma sensu czekać, zwróć powód od razu.
            if (code >= 400)
            {
                var det = s.TryGetProperty("description", out var d) ? d.GetString() : "błąd uwierzytelnienia";
                if (s.TryGetProperty("details", out var dd) && dd.ValueKind == JsonValueKind.Array)
                {
                    var extra = string.Join("; ", dd.EnumerateArray()
                        .Select(x => x.GetString() ?? "").Where(x => x.Length > 0).Take(3));
                    if (extra.Length > 0) det += " — " + extra;
                }
                throw new KsefException(401, $"KSeF: uwierzytelnianie nieudane ({code}: {det}).");
            }
            if (i == 11) throw new KsefException(504, "KSeF: uwierzytelnianie w toku — spróbuj ponownie za chwilę.");
            await Task.Delay(1500, ct);
        }
        var tokens = await Send(c, HttpMethod.Post, "/auth/token/redeem", new { }, bearer: authToken, ct: ct);
        var access = tokens.TryGetProperty("accessToken", out var a) ? Str(a, "token") : "";
        var refresh = tokens.TryGetProperty("refreshToken", out var r) ? Str(r, "token") : "";
        if (string.IsNullOrEmpty(access))
            throw new KsefException(502, "KSeF: brak accessToken po redeem (token jednorazowy? wygeneruj nowy challenge).");
        return new SesjaApi(access, refresh);
    }

    // ---------- wysyłka faktury ----------

    public sealed record WysylkaWynik(string SesjaRef, string FakturaRef, string? KsefNumber);

    public async Task<WysylkaWynik> WyslijFakture(string srodowisko, SesjaApi sesja,
        string fakturaXml, bool offline = false, CancellationToken ct = default)
    {
        using var c = Client(srodowisko);
        var keys = await PobierzKlucze(srodowisko, ct);
        var aesKey = GovCrypto.RandomBytes(32);
        var xmlBytes = Encoding.UTF8.GetBytes(fakturaXml);
        var (cipher, iv) = GovCrypto.Aes256CbcEncrypt(xmlBytes, aesKey);
        var open = await Send(c, HttpMethod.Post, "/sessions/online", new
        {
            formCode = new { systemCode = "FA (3)", schemaVersion = "1-0E", value = "FA" },
            encryption = new
            {
                encryptedSymmetricKey = GovCrypto.B64(GovCrypto.RsaOaepSha256Encrypt(aesKey, keys.SymKey)),
                initializationVector = GovCrypto.B64(iv),
            },
        }, bearer: sesja.AccessToken, ct: ct);
        var sesjaRef = Str(open, "referenceNumber");
        if (string.IsNullOrEmpty(sesjaRef))
            throw new KsefException(502, "KSeF: nie otwarto sesji online.");
        var send = await Send(c, HttpMethod.Post, $"/sessions/online/{sesjaRef}/invoices", new
        {
            invoiceHash = GovCrypto.B64(GovCrypto.Sha256(xmlBytes)),
            invoiceSize = xmlBytes.Length,
            encryptedInvoiceHash = GovCrypto.B64(GovCrypto.Sha256(cipher)),
            encryptedInvoiceSize = cipher.Length,
            encryptedInvoiceContent = GovCrypto.B64(cipher),
            offlineMode = offline,
        }, bearer: sesja.AccessToken, ct: ct);
        var fakturaRef = Str(send, "referenceNumber");
        await Send(c, HttpMethod.Post, $"/sessions/online/{sesjaRef}/close", new { }, bearer: sesja.AccessToken, ct: ct);
        // numer KSeF pojawia się po przetworzeniu — odczytaj status faktury w sesji
        string? ksef = null;
        for (var i = 0; i < 10; i++)
        {
            await Task.Delay(1500, ct);
            try
            {
                var info = await Send(c, HttpMethod.Get,
                    $"/sessions/{sesjaRef}/invoices/{fakturaRef}", bearer: sesja.AccessToken, ct: ct);
                ksef = Str(info, "ksefNumber");
                if (!string.IsNullOrEmpty(ksef)) break;
                var st = info.TryGetProperty("status", out var s) ? Str(s, "code") + Str(s, "description") : "";
                if (st.Contains("40") || st.Contains("7908")) break; // błąd przetwarzania
            }
            catch (KsefException) { break; }
        }
        return new WysylkaWynik(sesjaRef, fakturaRef, ksef);
    }

    public async Task<JsonElement> PobierzUpo(string srodowisko, SesjaApi sesja,
        string sesjaRef, string fakturaRef, CancellationToken ct = default)
    {
        using var c = Client(srodowisko);
        return await Send(c, HttpMethod.Get,
            $"/sessions/{sesjaRef}/invoices/{fakturaRef}/upo", bearer: sesja.AccessToken, ct: ct);
    }

    // ---------- odczyt faktur zakupowych ----------

    public async Task<JsonElement> MetadaneZakupow(string srodowisko, SesjaApi sesja,
        DateTimeOffset od, DateTimeOffset @do, int pageSize = 50, CancellationToken ct = default)
    {
        using var c = Client(srodowisko);
        return await Send(c, HttpMethod.Post,
            $"/invoices/query/metadata?pageSize={pageSize}&pageOffset=0",
            new
            {
                subjectType = "Subject2", // faktury, w których jestem nabywcą
                dateRange = new
                {
                    dateType = "PermanentStorage",
                    from = od.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    to = @do.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                },
            }, bearer: sesja.AccessToken, ct: ct);
    }

    public async Task<JsonElement> PobierzFakture(string srodowisko, SesjaApi sesja,
        string ksefNumber, CancellationToken ct = default)
    {
        using var c = Client(srodowisko);
        return await Send(c, HttpMethod.Get, $"/invoices/ksef/{ksefNumber}",
            bearer: sesja.AccessToken, ct: ct);
    }
}

public sealed class KsefException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
