using System.Text.Json;

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
}
