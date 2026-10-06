using Frank.Api.Data;
using Frank.Api.Models;
using Frank.Api.Services;
using Frank.Api.Tax;
using Microsoft.EntityFrameworkCore;

namespace Frank.Api.Endpoints;

// Prawdziwa wysyłka JPK_V7M(3)/V7K(3) do bramki e-Dokumenty MF.
// Uwierzytelnienie danymi autoryzującymi (NIP/PESEL + imię + nazwisko +
// data urodzenia + przychód sprzed 2 lat) — bez podpisu kwalifikowanego.
// Tylko osoby fizyczne (JDG). Dane autoryzujące nie są nigdzie zapisywane.
public static class JpkEndpoints
{
    public sealed record WyslijReq(
        string? Miesiac = null, string? Kwartal = null,
        string Srodowisko = "test",
        int CelZlozenia = 1,
        bool OsobaFizyczna = true,
        string? Imie = null, string? Nazwisko = null, string? DataUrodzenia = null,
        string? Telefon = null, string? KodUrzedu = null,
        string? NipLubPesel = null, decimal KwotaPrzychodu = 0,
        string ZwrotTryb = "P_540");

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/jpk");

        g.MapGet("/podglad", async (string? miesiac, string? kwartal, AppDbContext db) =>
        {
            try
            {
                // Podgląd: dane osobowe robocze (imię/nazwisko/data urodzenia) —
                // prawdziwe podajesz dopiero przy wysyłce (nie są zapisywane).
                var u0 = await db.Settings.FindAsync(1);
                var (xml, formCode, schemaVer, pominiete) = await ZbudujZDb(miesiac, kwartal, db,
                    new OsobaDane(true, "IMIE", "NAZWISKO", "1900-01-01", null,
                        string.IsNullOrWhiteSpace(u0?.KodUrzedu) ? "0000" : u0.KodUrzedu, 1, "P_540"));
                var wal = JpkV7Builder.Waliduj(xml, kwartal is not null, SchemasDir());
                return Results.Ok(new
                {
                    formCode,
                    schemaVersion = schemaVer,
                    xml,
                    walidacja = new { ok = wal.Ok, bledy = wal.Bledy, pominieta = wal.Pominieta },
                    pominiete,
                    uwaga = "Podgląd roboczy: imię/nazwisko/data urodzenia i kod urzędu (gdy pusty) są zastępcze — przy wysyłce podaj prawdziwe.",
                });
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
        });

        g.MapPost("/wyslij", async (WyslijReq req, AppDbContext db, JpkGateway gateway, CancellationToken ct) =>
        {
            var sr = req.Srodowisko == "prod" ? "prod" : "test";
            if (req.CelZlozenia is not (1 or 2))
                return Results.BadRequest(new { code = "ZLE_DANE", message = "Cel złożenia: 1 (złożenie) albo 2 (korekta)." });
            JpkGateway.DaneAutoryzujace auth;
            try
            {
                auth = new JpkGateway.DaneAutoryzujace(
                    req.NipLubPesel ?? "", req.Imie ?? "", req.Nazwisko ?? "",
                    req.DataUrodzenia ?? "", req.KwotaPrzychodu);
                // walidacja kształtu AuthData przed wysyłką
                _ = JpkGateway.ZbudujAuthData(auth);
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
            string xml, formCode, schemaVer; List<string> pominiete;
            try
            {
                (xml, formCode, schemaVer, pominiete) = await ZbudujZDb(req.Miesiac, req.Kwartal, db,
                    new OsobaDane(req.OsobaFizyczna, req.Imie, req.Nazwisko, req.DataUrodzenia,
                        req.Telefon, req.KodUrzedu, req.CelZlozenia, req.ZwrotTryb));
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
            var wal = JpkV7Builder.Waliduj(xml, req.Kwartal is not null, SchemasDir());
            if (!wal.Ok && !wal.Pominieta)
                return Results.BadRequest(new { code = "XSD", message = "JPK niezgodny ze schematem MF.", bledy = wal.Bledy });
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromMinutes(6));
                var wynik = await gateway.Wyslij(sr, xml, formCode, schemaVer, auth, timeout.Token);
                return Results.Ok(new
                {
                    referenceNumber = wynik.ReferenceNumber,
                    kod = wynik.KodStatusu,
                    opis = wynik.Opis,
                    upo = wynik.Upo,
                    srodowisko = sr,
                    pominiete,
                });
            }
            catch (JpkException e)
            {
                return Results.Json(new { code = "JPK_BLAD", message = e.Message }, statusCode: 502);
            }
            catch (OperationCanceledException)
            {
                return Results.Json(new { code = "TIMEOUT", message = "Przekroczono czas — sprawdź status później (GET /api/jpk/status)." }, statusCode: 504);
            }
        });

        g.MapGet("/status/{referenceNumber}", async (string referenceNumber, string? srodowisko,
            IHttpClientFactory http, CancellationToken ct) =>
        {
            var sr = srodowisko == "prod" ? "prod" : "test";
            using var c = http.CreateClient("edokumenty");
            c.BaseAddress = new Uri(JpkGateway.BaseUrl(sr));
            c.Timeout = TimeSpan.FromSeconds(30);
            using var res = await c.GetAsync($"/api/Storage/Status/{referenceNumber}", ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                return Results.Json(new { code = "JPK_BLAD", message = $"Status HTTP {(int)res.StatusCode}: {text[..Math.Min(300, text.Length)]}" }, statusCode: 502);
            return Results.Content(text, "application/json");
        });
    }

    private sealed record OsobaDane(bool OsobaFizyczna, string? Imie, string? Nazwisko,
        string? DataUrodzenia, string? Telefon, string? KodUrzedu, int Cel, string ZwrotTryb);

    private static string SchemasDir() =>
        Path.Combine(AppContext.BaseDirectory, "Schemas") is var a && Directory.Exists(a)
            ? a : Path.Combine(Directory.GetCurrentDirectory(), "Schemas");

    private static async Task<(string Xml, string FormCode, string SchemaVer, List<string> Pominiete)> ZbudujZDb(
        string? miesiac, string? kwartal, AppDbContext db, OsobaDane? osoba)
    {
        var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
        var sales = await db.SalesInvoices.ToListAsync();
        var costs = await db.CostInvoices.ToListAsync();
        bool wOkresie(string data, List<string> msc) => data.Length >= 7 && msc.Contains(data[..7]);

        List<string> miesiace;
        bool isKwartal = kwartal is not null;
        if (isKwartal)
        {
            var m = System.Text.RegularExpressions.Regex.Match(kwartal!, @"^(\d{4})-Q([1-4])$");
            if (!m.Success) throw new ArgumentException("Kwartał RRRR-Q1..Q4 (np. 2026-Q1).");
            var rok = m.Groups[1].Value; var q = int.Parse(m.Groups[2].Value);
            miesiace = Enumerable.Range((q - 1) * 3 + 1, 3).Select(mm => $"{rok}-{mm:D2}").ToList();
        }
        else
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(miesiac ?? "", @"^\d{4}-\d{2}$"))
                throw new ArgumentException("Miesiąc RRRR-MM.");
            miesiace = [miesiac!];
        }

        var sprz = sales.Where(s => wOkresie(s.DataSprzedazy, miesiace)
                && !string.Equals(s.Status, "robocza", StringComparison.OrdinalIgnoreCase)).ToList();
        // Paragon bez NIP nie trafia do ewidencji zakupu (JPK wymaga NrDostawcy);
        // VAT z niego i tak jest nieodliczalny bez NIP. Raportujemy jako pominięte.
        var pominiete = new List<string>();
        var zakupOk = new List<CostInvoice>();
        foreach (var c in costs.Where(c => wOkresie(c.DataKsiegowania, miesiace)))
        {
            if (new string([.. (c.NipWystawcy ?? "").Where(char.IsDigit)]).Length != 10)
                pominiete.Add($"{c.Numer} (brak NIP dostawcy — paragon bez NIP poza JPK)");
            else
                zakupOk.Add(c);
        }

        var wierszeS = sprz.Select(s =>
        {
            var k = new decimal[8]; // k10,k11,k13,k15,k16,k17,k18,k19,k20 → indeksy niżej
            decimal k10 = 0, k11 = 0, k13 = 0, k15 = 0, k16 = 0, k17 = 0, k18 = 0, k19 = 0, k20 = 0, k31 = 0;
            foreach (var p in DtoMapper.ReadItems(s.PozycjeJson))
            {
                var netto = Money.Round2(p.Ilosc * p.CenaNetto);
                var st = DtoMapper.CanonicalVatRate(p.StawkaVat);
                var vat = VatCalc.VatForNetto(netto, st);
                switch (st)
                {
                    case "0.23": k19 += netto; k20 += vat; break;
                    case "0.08": k17 += netto; k18 += vat; break;
                    case "0.05": k15 += netto; k16 += vat; break;
                    case "0": k13 += netto; break;
                    case "zw": k10 += netto; break;
                    case "np": k11 += netto; break;
                    case "oo": k31 += netto; break;
                    default: throw new ArgumentException($"Faktura {s.Numer}: nieobsługiwana stawka {st} w JPK.");
                }
            }
            return new JpkV7Builder.WierszS(
                s.KontrahentNip ?? "", s.KontrahentNazwa ?? "", s.Numer,
                s.DataWystawienia, string.IsNullOrWhiteSpace(s.DataSprzedazy) ? null : s.DataSprzedazy,
                string.IsNullOrWhiteSpace(s.KsefId) ? null : s.KsefId,
                k10, k11, k13, k15, k16, k17, k18, k19, k20, 0, 0, k31);
        }).ToList();

        var wierszeZ = zakupOk.Select(c => new JpkV7Builder.WierszZ(
            c.NipWystawcy ?? "", c.Wystawca ?? "", c.Numer, c.DataZakupu,
            c.Opis.Contains("KSeF(") ? WytnijKsef(c.Opis) : null,
            c.Netto, VatCalc.DeductibleVat(c))).ToList();

        var email = (u.FirmaEmail ?? "").Trim();
        if (string.IsNullOrEmpty(email)) throw new ArgumentException("Uzupełnij e-mail firmy w Ustawieniach (wymagany w JPK).");
        var kodUrzedu = (osoba?.KodUrzedu ?? u.KodUrzedu ?? "").Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(kodUrzedu, @"^\d{4}$"))
            throw new ArgumentException("Kod urzędu skarbowego: 4 cyfry (Ustawienia albo formularz wysyłki).");
        var of = osoba?.OsobaFizyczna ?? true;
        var podmiot = new JpkV7Builder.Podmiot(
            u.FirmaNip ?? "", u.FirmaNazwa ?? "", email, of,
            osoba?.Imie, osoba?.Nazwisko, osoba?.DataUrodzenia,
            string.IsNullOrWhiteSpace(osoba?.Telefon) ? u.FirmaTelefon : osoba!.Telefon,
            kodUrzedu);
        var op = new JpkV7Builder.Opcje(osoba?.Cel ?? 1, 0, 0,
            osoba?.ZwrotTryb is "P_55" or "P_56" or "P_560" or "P_58" ? osoba.ZwrotTryb : "P_540");

        if (!isKwartal)
        {
            return (JpkV7Builder.ZbudujV7M(miesiace[0][..4], miesiace[0][5..7], wierszeS, wierszeZ, podmiot, op),
                "JPK_V7M (3)", "1-0E", pominiete);
        }
        var qr = int.Parse(kwartal![6..]);
        return (JpkV7Builder.ZbudujV7K(miesiace[0][..4], qr, miesiace[2][5..7], wierszeS, wierszeZ, podmiot, op),
            "JPK_V7K (3)", "1-0E", pominiete);
    }

    private static string? WytnijKsef(string opis)
    {
        var m = System.Text.RegularExpressions.Regex.Match(opis, @"KSeF\s*\(([^)]+)\)");
        return m.Success ? m.Groups[1].Value : null;
    }
}
