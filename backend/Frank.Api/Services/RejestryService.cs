using System.Text.Json;
using System.Xml.Linq;

namespace Frank.Api.Services;

// Wynik wyszukiwania podmiotu w rejestrach (Biała Lista VAT + KRS).
public sealed record PodmiotZRejestru(
    string Nazwa,
    string Nip,
    string? Regon,
    string? Krs,
    string Adres,
    string? Email,
    string StatusVat,
    string[] Pkd,
    string[] Zrodla);

/// Wynik sprawdzenia kontrahenta UE w VIES (WDT/WNT/eksport: `oo/np` + check).
public sealed record ViesWynik(
    string Kraj,
    string Nip,
    bool Aktywny,
    string? Nazwa,
    string? Adres);

/// Wiersz z wyszukiwarki REGON (GUS BIR): NIP/REGON → nazwa + adres.
public sealed record GusWynik(
    string Nazwa,
    string Nip,
    string? Regon,
    string Adres);

public static class RejestryParsers
{
    /// Biała Lista: result.subject (pojedynczy NIP).
    public static PodmiotZRejestru? ParseBialaLista(JsonElement root)
    {
        if (!root.TryGetProperty("result", out var result)) return null;
        if (result.TryGetProperty("exception", out _)) return null;
        if (!result.TryGetProperty("subject", out var s)) return null;
        string Str(string name) =>
            s.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? "" : "";
        var adres = Str("workingAddress");
        if (string.IsNullOrWhiteSpace(adres)) adres = Str("residenceAddress");
        return new PodmiotZRejestru(
            Nazwa: Str("name"),
            Nip: Str("nip"),
            Regon: string.IsNullOrWhiteSpace(Str("regon")) ? null : Str("regon"),
            Krs: string.IsNullOrWhiteSpace(Str("krs")) ? null : Str("krs"),
            Adres: adres,
            Email: null,
            StatusVat: Str("statusVat"),
            Pkd: [],
            Zrodla: ["biala-lista"]);
    }

    /// Odpis aktualny KRS: odpis.dane.dzial1 (adres, e-mail) + dzial3 (PKD).
    public static (string Adres, string? Email, string[] Pkd) ParseKrsOdpis(JsonElement root)
    {
        string adres = "";
        string? email = null;
        var pkd = new List<string>();
        if (!root.TryGetProperty("odpis", out var odpis)) return (adres, email, []);
        if (!odpis.TryGetProperty("dane", out var dane)) return (adres, email, []);
        if (dane.TryGetProperty("dzial1", out var dz1) &&
            dz1.TryGetProperty("siedzibaIAdres", out var siedziba))
        {
            if (siedziba.TryGetProperty("adres", out var a))
            {
                string S(string n) =>
                    a.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String
                        ? (v.GetString() ?? "").Trim() : "";
                var ulica = S("ulica");
                var nr = S("nrDomu");
                var nrLok = S("nrLokalu");
                var kod = S("kodPocztowy");
                var miasto = S("miejscowosc");
                var ul = string.IsNullOrWhiteSpace(nrLok) ? $"{ulica} {nr}" : $"{ulica} {nr}/{nrLok}";
                adres = $"{ul.Trim()}, {kod} {miasto}".Trim(' ', ',');
            }
            if (siedziba.TryGetProperty("adresPocztyElektronicznej", out var em) &&
                em.ValueKind == JsonValueKind.String)
            {
                var e = (em.GetString() ?? "").Trim();
                if (e.Contains('@')) email = e;
            }
        }
        if (dane.TryGetProperty("dzial3", out var dz3) &&
            dz3.TryGetProperty("przedmiotDzialalnosci", out var przedmiot))
        {
            foreach (var key in new[] { "przedmiotPrzewazajacejDzialalnosci", "przedmiotPozostalejDzialalnosci" })
            {
                if (!przedmiot.TryGetProperty(key, out var lista) ||
                    lista.ValueKind != JsonValueKind.Array) continue;
                foreach (var poz in lista.EnumerateArray())
                {
                    var kod = ComposePkd(poz);
                    if (kod is not null && !pkd.Contains(kod)) pkd.Add(kod);
                }
            }
        }
        return (adres, email, [.. pkd]);
    }

    /// PKD z pól odpisu: kodDzial.kodKlasa[.kodPodklasa], np. 19.20.Z.
    public static string? ComposePkd(JsonElement poz)
    {
        string S(string n) =>
            poz.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String
                ? (v.GetString() ?? "").Trim() : "";
        var dzial = S("kodDzial");
        var klasa = S("kodKlasa");
        var podklasa = S("kodPodklasa");
        if (dzial == "" || klasa == "") return null;
        return podklasa == "" ? $"{dzial}.{klasa}" : $"{dzial}.{klasa}.{podklasa}";
    }

    /// VIES REST: {countryCode, vatNumber, valid, name, address}.
    public static ViesWynik? ParseVies(JsonElement root)
    {
        if (!root.TryGetProperty("valid", out var valid)) return null;
        if (valid.ValueKind != JsonValueKind.True && valid.ValueKind != JsonValueKind.False) return null;
        string S(string n) =>
            root.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String
                ? (v.GetString() ?? "").Trim() : "";
        var nazwa = S("name");
        var adres = S("address").Replace("\n", ", ");
        return new ViesWynik(
            Kraj: S("countryCode"),
            Nip: S("vatNumber"),
            Aktywny: valid.ValueKind == JsonValueKind.True,
            Nazwa: string.IsNullOrWhiteSpace(nazwa) ? null : nazwa,
            Adres: string.IsNullOrWhiteSpace(adres) ? null : adres);
    }

    public const string BirUrl = "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIR.asmx";

    /// Koperta SOAP Zaloguj (klucz API BIR z api.stat.gov.pl).
    public static string GusLoginEnvelope(string klucz) =>
        """
        <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07">
          <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIR.asmx</wsa:To><wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIR/Zaloguj</wsa:Action></soap:Header>
          <soap:Body><ns:Zaloguj><ns:pKluczUzytkownika>
        """ + System.Security.SecurityElement.Escape(klucz) + """
        </ns:pKluczUzytkownika></ns:Zaloguj></soap:Body></soap:Envelope>
        """;

    /// Koperta SOAP DaneSzukajPodmioty (sid z Zaloguj w nagłówku; NIP 10 cyfr albo REGON).
    public static string GusSzukajEnvelope(string sid, string id, bool regon)
    {
        var pole = regon ? "Regon" : "Nip";
        return """
        <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07">
          <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIR.asmx</wsa:To><wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIR/DaneSzukajPodmioty</wsa:Action><ns:sid>
        """ + System.Security.SecurityElement.Escape(sid) + """
        </ns:sid></soap:Header>
          <soap:Body><ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><ns:
        """ + pole + ">" + System.Security.SecurityElement.Escape(id) + "</ns:" + pole + """
        ></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty></soap:Body></soap:Envelope>
        """;
    }

    private static string? XFind(XDocument doc, params string[] names)
    {
        foreach (var el in doc.Descendants())
        {
            var local = el.Name.LocalName;
            foreach (var n in names)
            {
                if (local == n && !string.IsNullOrWhiteSpace(el.Value))
                    return el.Value.Trim();
            }
        }
        return null;
    }

    /// sid z odpowiedzi Zaloguj (ZalogujResult).
    public static string? ParseGusSid(string xml)
    {
        try
        {
            var doc = XDocument.Parse(xml);
            return XFind(doc, "ZalogujResult");
        }
        catch { return null; }
    }

    /// Pierwszy wiersz <dane> z DaneSzukajPodmioty (pola bez namespace).
    public static GusWynik? ParseGusDane(string xml)
    {
        try
        {
            var doc = XDocument.Parse(xml);
            XElement? dane = null;
            foreach (var el in doc.Descendants())
            {
                if (el.Name.LocalName == "dane") { dane = el; break; }
            }
            if (dane is null) return null;
            string G(string n) => dane.Elements().FirstOrDefault(e => e.Name.LocalName == n)?.Value.Trim() ?? "";
            var nazwa = G("Nazwa");
            if (string.IsNullOrWhiteSpace(nazwa)) return null;
            var ulica = G("Ulica");
            var nr = G("NrNieruchomosci");
            var lok = G("NrLokalu");
            var kod = G("KodPocztowy");
            var miasto = G("Miasto");
            var budynek = string.IsNullOrWhiteSpace(lok) ? $"{ulica} {nr}" : $"{ulica} {nr}/{lok}";
            var adres = $"{budynek.Trim()}, {kod} {miasto}".Trim(' ', ',');
            var regon = G("Regon");
            return new GusWynik(nazwa.Trim(), G("Nip"), string.IsNullOrWhiteSpace(regon) ? null : regon, adres);
        }
        catch { return null; }
    }
}

public sealed class RejestryService(IHttpClientFactory http)
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public async Task<PodmiotZRejestru?> ZnajdzPoNip(string nip, CancellationToken ct)
    {
        var digits = new string([.. nip.Where(char.IsDigit)]);
        if (digits.Length != 10) return null;
        var date = DateOnly.FromDateTime(DateTime.Today).ToString("yyyy-MM-dd");
        var client = http.CreateClient("rejestry");

        PodmiotZRejestru? podmiot = null;
        try
        {
            using var res = await client.GetAsync(
                $"https://wl-api.mf.gov.pl/api/search/nip/{digits}?date={date}", ct);
            if (res.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
                podmiot = RejestryParsers.ParseBialaLista(doc.RootElement);
            }
        }
        catch (OperationCanceledException) { throw; }
        catch { /* upstream niedostępny — obsłużone niżej */ }

        if (podmiot is null) return null;

        // Wzbogać odpisem KRS, gdy Biała Lista podała numer KRS.
        if (!string.IsNullOrWhiteSpace(podmiot.Krs))
        {
            var krs = podmiot.Krs.PadLeft(10, '0');
            foreach (var rejestr in new[] { "P", "S" })
            {
                try
                {
                    using var res = await client.GetAsync(
                        $"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr={rejestr}&format=json", ct);
                    if (!res.IsSuccessStatusCode) continue;
                    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
                    var (adres, email, pkd) = RejestryParsers.ParseKrsOdpis(doc.RootElement);
                    podmiot = podmiot with
                    {
                        Adres = string.IsNullOrWhiteSpace(adres) ? podmiot.Adres : adres,
                        Email = email ?? podmiot.Email,
                        Pkd = pkd,
                        Zrodla = [.. podmiot.Zrodla, "krs"],
                    };
                    break;
                }
                catch (OperationCanceledException) { throw; }
                catch { /* brak odpisu — zostają dane z Białej Listy */ }
            }
        }
        return podmiot;
    }

    /// Weryfikacja kontrahenta UE w VIES (do WDT/WNT/eksportu 0%: faktury `oo/np`).
    public async Task<ViesWynik?> SprawdzVies(string kraj, string nip, CancellationToken ct)
    {
        var client = http.CreateClient("rejestry");
        try
        {
            using var res = await client.GetAsync(
                $"https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{kraj}/vat/{nip}", ct);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            return RejestryParsers.ParseVies(doc.RootElement);
        }
        catch (OperationCanceledException) { throw; }
        catch { return null; }
    }

    /// Wyszukiwarka REGON (GUS BIR): logowanie kluczem → sid → DaneSzukajPodmioty.
    public async Task<GusWynik?> SprawdzGus(string nip, string klucz, CancellationToken ct)
    {
        var client = http.CreateClient("rejestry");
        try
        {
            using var loginContent = new StringContent(
                RejestryParsers.GusLoginEnvelope(klucz),
                System.Text.Encoding.UTF8, "application/soap+xml");
            using var loginRes = await client.PostAsync(RejestryParsers.BirUrl, loginContent, ct);
            if (!loginRes.IsSuccessStatusCode) return null;
            var sid = RejestryParsers.ParseGusSid(await loginRes.Content.ReadAsStringAsync(ct));
            if (string.IsNullOrWhiteSpace(sid)) return null;
            using var szukajContent = new StringContent(
                RejestryParsers.GusSzukajEnvelope(sid, nip, regon: nip.Length != 10),
                System.Text.Encoding.UTF8, "application/soap+xml");
            using var szukajRes = await client.PostAsync(RejestryParsers.BirUrl, szukajContent, ct);
            if (!szukajRes.IsSuccessStatusCode) return null;
            return RejestryParsers.ParseGusDane(await szukajRes.Content.ReadAsStringAsync(ct));
        }
        catch (OperationCanceledException) { throw; }
        catch { return null; }
    }
}
