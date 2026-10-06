using System.Text.Json;
using Frank.Api.Services;
using Frank.Api.Tax;

namespace Frank.Api.Endpoints;

// Mock bramek: KSeF / ZUS DRA / NBP / mikrorachunek (tryb demo, bez certyfikatów).
// Wpięcie: MockEndpoints.Map(app) — dopina właściciel Program.cs.
public static class MockEndpoints
{
    public sealed record KsefWyslijReq(string Numer, string NipNabywcy, decimal Netto, decimal Vat, string? Tryb = null);
    public sealed record DraReq(string Miesiac, decimal Spoleczne, decimal Zdrowotna, string? Nrs, string? KodTytulu);

    public static void Map(WebApplication app)
    {
        app.MapPost("/api/mock/ksef/wyslij", (KsefWyslijReq req) =>
        {
            if (string.IsNullOrWhiteSpace(req.Numer))
                return Results.BadRequest(new { code = "BRAK_NUMERU", message = "Podaj numer faktury." });
            return Results.Ok(new
            {
                ksefId = MockIntegrations.KsefFakeId(),
                upoId = Guid.NewGuid().ToString("N"),
                dataPrzyjecia = DateTime.UtcNow,
                numer = req.Numer,
                tryb = string.IsNullOrWhiteSpace(req.Tryb) ? "online" : req.Tryb,
                info = req.Tryb is "offline24" or "awaria"
                    ? "Tryb offline: datą faktury jest data z dokumentu (art. 106nf)."
                    : "Przyjęto w KSeF.",
            });
        });

        app.MapGet("/api/mock/ksef/faktury", () => Results.Ok(MockIntegrations.PrzykladoweZakupy()));

        app.MapPost("/api/mock/zus/dra", (DraReq req) =>
        {
            var xml = MockIntegrations.DraXml(
                req.Miesiac, req.Spoleczne, req.Zdrowotna, req.Nrs ?? "", req.KodTytulu ?? "01 10");
            return Results.Ok(new
            {
                potwierdzenie = $"POT-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}",
                dataPrzyjecia = DateTime.UtcNow,
                xml,
            });
        });

        app.MapGet("/api/nbp/kurs", async (string waluta, string? data, IHttpClientFactory http) =>
        {
            var w = waluta.Trim().ToUpperInvariant();
            var dzis = DateOnly.FromDateTime(DateTime.Today).ToString("yyyy-MM-dd");
            if (w is "" or "PLN")
                return Results.Ok(new { waluta = "PLN", kurs = 1m, data = data ?? dzis, zrodlo = "nbp" });
            var client = http.CreateClient("rejestry");
            foreach (var dzien in new[] { data, (string?)null })
            {
                var kurs = await KursZNbp(client, w, dzien);
                if (kurs is not null)
                    return Results.Ok(new { waluta = w, kurs = kurs.Value.Kurs, data = kurs.Value.Data, zrodlo = "nbp" });
            }
            var fb = w switch { "EUR" => 4.32m, "USD" => 4.05m, _ => (decimal?)null };
            return fb is decimal f
                ? Results.Ok(new { waluta = w, kurs = f, data = data ?? dzis, zrodlo = "fallback" })
                : Results.NotFound(new { code = "BRAK_KURSU", message = $"Brak kursu {w} (NBP niedostępny)." });
        });

        app.MapGet("/api/mikrorachunek", (string nip) =>
        {
            try
            {
                return Results.Ok(new { rachunek = MockIntegrations.Mikrorachunek(nip) });
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLY_NIP", message = e.Message });
            }
        });
    }

    private static async Task<(decimal Kurs, string Data)?> KursZNbp(HttpClient client, string waluta, string? dzien)
    {
        foreach (var tabela in new[] { "a", "c" })
        {
            try
            {
                var url = dzien is null
                    ? $"https://api.nbp.pl/api/exchangerates/rates/{tabela}/{waluta}/?format=json"
                    : $"https://api.nbp.pl/api/exchangerates/rates/{tabela}/{waluta}/{dzien}/?format=json";
                using var res = await client.GetAsync(url);
                if (!res.IsSuccessStatusCode) continue; // 404 w weekendy/święta
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (!doc.RootElement.TryGetProperty("rates", out var rates) || rates.GetArrayLength() == 0) continue;
                var r = rates[0];
                var data = r.TryGetProperty("effectiveDate", out var ed) && ed.ValueKind == JsonValueKind.String
                    ? ed.GetString() ?? ""
                    : dzien ?? "";
                if (r.TryGetProperty("mid", out var mid))
                    return (mid.GetDecimal(), data);
                if (r.TryGetProperty("bid", out var bid) && r.TryGetProperty("ask", out var ask))
                    return (Money.Round2((bid.GetDecimal() + ask.GetDecimal()) / 2), data);
            }
            catch
            {
                /* następna tabela / fallback */
            }
        }
        return null;
    }
}
