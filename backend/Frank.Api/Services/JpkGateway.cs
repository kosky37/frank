using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Frank.Api.Services;

// Wysyłka JPK_V7M(3)/V7K(3) do bramki e-Dokumenty MF wg specyfikacji v5.6.0:
// ZIP (DEFLATE) → AES-256-CBC → klucz RSA (certyfikat MF) → InitUpload z AuthData
// (dane autoryzujące: NIP/PESEL + imię + nazwisko + data urodzenia + przychód
// sprzed 2 lat) → PUT blobów → FinishUpload → Status/UPO.
// Bez podpisu kwalifikowanego i bez profilu zaufanego po stronie API.
// Dane autoryzujące są używane wyłącznie w locie (nie są zapisywane).
public sealed class JpkGateway
{
    private readonly IHttpClientFactory _http;
    private readonly string _keysDir;

    public JpkGateway(IHttpClientFactory http, IWebHostEnvironment env)
    {
        _http = http;
        _keysDir = Path.Combine(env.ContentRootPath, "Keys");
    }

    public static string BaseUrl(string srodowisko) => srodowisko == "prod"
        ? "https://e-dokumenty.mf.gov.pl"
        : "https://test-e-dokumenty.mf.gov.pl";

    public sealed record DaneAutoryzujace(
        string NipLubPesel, string Imie, string Nazwisko, string DataUrodzenia, decimal KwotaPrzychodu);

    public sealed record Wynik(string ReferenceNumber, int KodStatusu, string Opis, string? Upo);

    public async Task<Wynik> Wyslij(string srodowisko, string jpkXml, string formCode,
        string schemaVersion, DaneAutoryzujace auth, CancellationToken ct = default)
    {
        var xmlBytes = Encoding.UTF8.GetBytes(jpkXml);
        var authXml = Encoding.UTF8.GetBytes(ZbudujAuthData(auth));

        // 1. ZIP (jeden plik, DEFLATE)
        byte[] zip;
        using (var ms = new MemoryStream())
        {
            using (var zip2 = new ZipArchive(ms, ZipArchiveMode.Create, true))
            {
                var entry = zip2.CreateEntry("jpk.xml", CompressionLevel.Optimal);
                await using var es = entry.Open();
                await es.WriteAsync(xmlBytes, ct);
            }
            zip = ms.ToArray();
        }

        // 2. AES-256 + klucz RSA (certyfikat MF)
        var aesKey = GovCrypto.RandomBytes(32);
        var (szyfr, iv) = GovCrypto.Aes256CbcEncrypt(zip, aesKey);
        // AuthData: ten sam klucz i IV co archiwum (spec 1.3.2 — brak osobnego IV w InitUpload)
        using var aes = Aes.Create();
        aes.KeySize = 256; aes.Key = aesKey; aes.IV = iv;
        aes.Mode = CipherMode.CBC; aes.Padding = PaddingMode.PKCS7;
        var szyfrAuth = aes.CreateEncryptor().TransformFinalBlock(authXml, 0, authXml.Length);

        using var rsa = GovCrypto.PublicRsaFromCertPem(Path.Combine(_keysDir,
            srodowisko == "prod" ? "jpk-prod.pem" : "jpk-test.pem"));
        var kluczZaszyfrowany = GovCrypto.B64(GovCrypto.RsaPkcs1Encrypt(aesKey, rsa));

        var nazwaPliku = $"JPK_{(formCode.Contains("V7K") ? "V7K" : "V7M")}-{DateTime.UtcNow:yyyy-MM-dd-HHmmss}.xml";
        var nazwaCzesci = nazwaPliku + ".zip.aes";
        var hashDok = GovCrypto.B64(GovCrypto.Sha256(xmlBytes));
        var hashCzesci = GovCrypto.B64(GovCrypto.Md5(szyfr));
        var initUpload =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
            "<InitUpload xmlns=\"http://e-dokumenty.mf.gov.pl\">\n" +
            "  <DocumentType>JPK</DocumentType>\n" +
            "  <Version>01.02.01.20160617</Version>\n" +
            $"  <EncryptionKey algorithm=\"RSA\" mode=\"ECB\" padding=\"PKCS#1\" encoding=\"Base64\">{kluczZaszyfrowany}</EncryptionKey>\n" +
            "  <DocumentList>\n    <Document>\n" +
            $"      <FormCode systemCode=\"{E(formCode)}\" schemaVersion=\"{E(schemaVersion)}\">JPK_VAT</FormCode>\n" +
            $"      <FileName>{E(nazwaPliku)}</FileName>\n" +
            $"      <ContentLength>{xmlBytes.Length}</ContentLength>\n" +
            $"      <HashValue algorithm=\"SHA-256\" encoding=\"Base64\">{hashDok}</HashValue>\n" +
            "      <FileSignatureList filesNumber=\"1\">\n" +
            "        <Packaging><SplitZip type=\"split\" mode=\"zip\" /></Packaging>\n" +
            "        <Encryption><AES size=\"256\" block=\"16\" mode=\"CBC\" padding=\"PKCS#7\">\n" +
            $"          <IV bytes=\"16\" encoding=\"Base64\">{GovCrypto.B64(iv)}</IV>\n" +
            "        </AES></Encryption>\n" +
            "        <FileSignature>\n          <OrdinalNumber>1</OrdinalNumber>\n" +
            $"          <FileName>{E(nazwaCzesci)}</FileName>\n" +
            $"          <ContentLength>{szyfr.Length}</ContentLength>\n" +
            $"          <HashValue algorithm=\"MD5\" encoding=\"Base64\">{hashCzesci}</HashValue>\n" +
            "        </FileSignature>\n      </FileSignatureList>\n" +
            "    </Document>\n  </DocumentList>\n" +
            $"  <AuthData>{GovCrypto.B64(szyfrAuth)}</AuthData>\n" +
            "</InitUpload>";

        using var c = _http.CreateClient("edokumenty");
        c.BaseAddress = new Uri(BaseUrl(srodowisko));
        c.Timeout = TimeSpan.FromSeconds(60);

        // 3. InitUploadSigned
        using var initReq = new HttpRequestMessage(HttpMethod.Post, "/api/Storage/InitUploadSigned")
        {
            Content = new StringContent(initUpload, Encoding.UTF8, "application/xml"),
        };
        using var initRes = await c.SendAsync(initReq, ct);
        var initText = await initRes.Content.ReadAsStringAsync(ct);
        if (!initRes.IsSuccessStatusCode)
            throw new JpkException($"Bramka odrzuciła InitUpload (HTTP {(int)initRes.StatusCode}): {CzytajBlad(initText)}");
        var (refNum, pliki) = ParsujInit(initText);

        // 4. PUT blobów do Azure Storage
        using var put = _http.CreateClient("edokumenty-put");
        put.Timeout = TimeSpan.FromSeconds(120);
        foreach (var p in pliki)
        {
            using var putReq = new HttpRequestMessage(new HttpMethod(p.Method), p.Url)
            {
                Content = new ByteArrayContent(szyfr),
            };
            foreach (var h in p.Headery)
                putReq.Content.Headers.TryAddWithoutValidation(h.Key, h.Value);
            using var putRes = await put.SendAsync(putReq, ct);
            if (!putRes.IsSuccessStatusCode)
                throw new JpkException($"Upload części {p.FileName} nieudany (HTTP {(int)putRes.StatusCode}).");
        }

        // 5. FinishUpload
        var finishBody = JsonSerializer.Serialize(new
        {
            ReferenceNumber = refNum,
            AzureBlobNameList = pliki.Select(p => p.BlobName).ToArray(),
        });
        using var finRes = await c.PostAsync("/api/Storage/FinishUpload",
            new StringContent(finishBody, Encoding.UTF8, "application/json"), ct);
        if (!finRes.IsSuccessStatusCode)
            throw new JpkException($"FinishUpload nieudany (HTTP {(int)finRes.StatusCode}): {Skrot(await finRes.Content.ReadAsStringAsync(ct))}");

        // 6. Status → UPO (polling do ~3 min)
        for (var i = 0; i < 36; i++)
        {
            await Task.Delay(5000, ct);
            using var stRes = await c.GetAsync($"/api/Storage/Status/{refNum}", ct);
            var stText = await stRes.Content.ReadAsStringAsync(ct);
            if (!stRes.IsSuccessStatusCode)
                throw new JpkException($"Status nieudany (HTTP {(int)stRes.StatusCode}): {Skrot(stText)}");
            var st = JsonDocument.Parse(stText).RootElement;
            var kod = st.TryGetProperty("Code", out var kc)
                ? (kc.ValueKind == JsonValueKind.Number ? kc.GetInt32() : int.TryParse(kc.GetString(), out var k2) ? k2 : 0)
                : st.TryGetProperty("code", out var kc2) ? kc2.GetInt32() : 0;
            var opis = st.TryGetProperty("Description", out var od) ? od.GetString() ?? "" : "";
            var upo = st.TryGetProperty("Upo", out var uo) && uo.ValueKind == JsonValueKind.String ? uo.GetString() : null;
            if (kod == 200) return new Wynik(refNum, kod, opis, upo);
            if (kod is >= 400 or 300) return new Wynik(refNum, kod, $"{opis} {BledyStatusu(kod)}", upo);
        }
        throw new JpkException("Przekroczono czas oczekiwania na UPO (sprawdź Status później).");
    }

    public static string ZbudujAuthData(DaneAutoryzujace a)
    {
        var id = new string([.. a.NipLubPesel.Where(char.IsDigit)]);
        var idXml = id.Length == 11 ? $"<PESEL>{id}</PESEL>" : $"<NIP>{id}</NIP>";
        if (id.Length is not (10 or 11))
            throw new ArgumentException("Dane autoryzujące: NIP (10 cyfr) albo PESEL (11 cyfr).");
        if (string.IsNullOrWhiteSpace(a.Imie) || string.IsNullOrWhiteSpace(a.Nazwisko))
            throw new ArgumentException("Dane autoryzujące: wymagane imię i nazwisko.");
        if (!DateOnly.TryParse(a.DataUrodzenia, out _))
            throw new ArgumentException("Dane autoryzujące: data urodzenia RRRR-MM-DD.");
        var kwota = Math.Round(a.KwotaPrzychodu, 2, MidpointRounding.AwayFromZero)
            .ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<DaneAutoryzujace xmlns=\"http://e-deklaracje.mf.gov.pl/Repozytorium/Definicje/Podpis/\">" +
            idXml +
            $"<ImiePierwsze>{E(a.Imie.Trim())}</ImiePierwsze>" +
            $"<Nazwisko>{E(a.Nazwisko.Trim())}</Nazwisko>" +
            $"<DataUrodzenia>{a.DataUrodzenia}</DataUrodzenia>" +
            $"<Kwota>{kwota}</Kwota></DaneAutoryzujace>";
    }

    private sealed record PlikDoWyslania(string BlobName, string FileName, string Url, string Method, List<(string Key, string Value)> Headery);

    private static (string Ref, List<PlikDoWyslania> Pliki) ParsujInit(string json)
    {
        var doc = JsonDocument.Parse(json).RootElement;
        string S(JsonElement e, string n1, string n2) =>
            e.TryGetProperty(n1, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? ""
            : e.TryGetProperty(n2, out var v2) && v2.ValueKind == JsonValueKind.String ? v2.GetString() ?? "" : "";
        var refNum = S(doc, "ReferenceNumber", "referenceNumber");
        if (string.IsNullOrEmpty(refNum)) throw new JpkException("Brak ReferenceNumber w odpowiedzi InitUpload.");
        var lista = doc.TryGetProperty("RequestToUploadFileList", out var l1) ? l1
            : doc.TryGetProperty("requestToUploadFileList", out var l2) ? l2 : default;
        var pliki = new List<PlikDoWyslania>();
        if (lista.ValueKind == JsonValueKind.Array)
            foreach (var p in lista.EnumerateArray())
            {
                var headery = new List<(string, string)>();
                var hl = p.TryGetProperty("HeaderList", out var h1) ? h1
                    : p.TryGetProperty("headerList", out var h2) ? h2 : default;
                if (hl.ValueKind == JsonValueKind.Array)
                    foreach (var h in hl.EnumerateArray())
                        headery.Add((S(h, "Key", "key"), S(h, "Value", "value")));
                pliki.Add(new PlikDoWyslania(
                    S(p, "BlobName", "blobName"), S(p, "FileName", "fileName"),
                    S(p, "Url", "url"), S(p, "Method", "method") is var m && m != "" ? m : "PUT",
                    headery));
            }
        if (pliki.Count == 0) throw new JpkException("Brak plików do uploadu w odpowiedzi InitUpload.");
        return (refNum, pliki);
    }

    private static string CzytajBlad(string json)
    {
        try
        {
            var d = JsonDocument.Parse(json).RootElement;
            string S(string a, string b) =>
                d.TryGetProperty(a, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? ""
                : d.TryGetProperty(b, out var v2) ? v2.GetRawText() : "";
            return $"{S("Message", "message")} (kod {S("Code", "code")})".Trim();
        }
        catch { return Skrot(json); }
    }

    private static string Skrot(string s) => s.Length <= 300 ? s : s[..300] + "…";

    private static string E(string? s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";

    private static string BledyStatusu(int kod) => kod switch
    {
        401 => "— dokument niezgodny ze schematem XSD.",
        403 => "— niepoprawny podpis / brak uwierzytelnienia.",
        408 => "— dokument zawiera błędy.",
        411 => "— identyczny dokument już złożony.",
        412 => "— dokument nieprawidłowo zaszyfrowany.",
        413 => "— suma kontrolna niezgodna.",
        417 => "— błąd odszyfrowania danych autoryzujących.",
        418 => "— dane autoryzujące niezgodne ze schematem.",
        419 => "— błąd w danych autoryzujących (sprawdź NIP/PESEL, imię, nazwisko, datę urodzenia, kwotę przychodu).",
        422 => "— dane autoryzujące tylko dla osób fizycznych.",
        428 => "— błąd walidacji reguł biznesowych.",
        _ => "",
    };
}

public sealed class JpkException(string message) : Exception(message);
