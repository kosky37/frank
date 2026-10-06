using Frank.Api.Data;
using Frank.Api.Models;
using Frank.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Frank.Api.Endpoints;

// Prawdziwa integracja KSeF 2.0 (token z Aplikacji Podatnika — Profil Zaufany
// jednorazowo przy generowaniu tokenu, dalej sam token; bez kwalifikowanego).
public static class KsefEndpoints
{
    public sealed record WyslijReq(string IdFaktury, string? Srodowisko = null);
    public sealed record OdbiorReq(string? Od, string? Do, string? Srodowisko = null);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/ksef");

        g.MapGet("/status", async (AppDbContext db) =>
        {
            var u = await db.Settings.FindAsync(1);
            var sr = NormalizujSr(u?.KsefSrodowisko);
            return Results.Ok(new
            {
                srodowisko = sr,
                skonfigurowany = !string.IsNullOrWhiteSpace(u?.KsefToken),
                api = KsefClient.BaseUrl(sr),
                aplikacja = sr == "prod" ? "https://ksef.mf.gov.pl"
                    : sr == "demo" ? "https://ksef-demo.mf.gov.pl" : "https://ksef-test.mf.gov.pl",
            });
        });

        // Sprawdzenie połączenia: samo uwierzytelnienie tokenem (bez wysyłki).
        g.MapPost("/sprawdz", async (AppDbContext db, KsefClient ksef, CancellationToken ct) =>
        {
            var (u, sr, token, nip) = await Kontekst(db);
            if (string.IsNullOrWhiteSpace(token))
                return Results.BadRequest(new { code = "BRAK_TOKENA", message = "Wklej token KSeF w Ustawieniach → Integracje." });
            try
            {
                await ksef.ZalogujTokenem(sr, nip, token, ct);
                return Results.Ok(new { ok = true, srodowisko = sr, info = "Token działa — uwierzytelniono w KSeF." });
            }
            catch (KsefException e)
            {
                return Results.Json(new { code = "KSEF_BLAD", message = e.Message }, statusCode: 502);
            }
        });

        g.MapPost("/wyslij", async (WyslijReq req, AppDbContext db, KsefClient ksef, CancellationToken ct) =>
        {
            var sale = await db.SalesInvoices.FindAsync(req.IdFaktury);
            if (sale is null) return Results.NotFound(new { code = "BRAK_FAKTURY", message = "Nie znaleziono faktury." });
            if (sale.Rodzaj is not (null or "" or "sprzedazy" or "korygujaca" or "uproszczona"))
                return Results.BadRequest(new { code = "NIEOBSLUGIWANY_RODZAJ", message = $"Wysyłka KSeF obsługuje faktury VAT, korygujące i uproszczone; rodzaj „{sale.Rodzaj}” wyślij ręcznie w Aplikacji Podatnika." });
            if (string.Equals(sale.Status, "robocza", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { code = "ROBOCZA", message = "Najpierw wystaw fakturę (status robocza nie wchodzi do KSeF)." });
            var (u, sr, token, nip) = await Kontekst(db, req.Srodowisko);
            if (string.IsNullOrWhiteSpace(token))
                return Results.BadRequest(new { code = "BRAK_TOKENA", message = "Wklej token KSeF w Ustawieniach → Integracje." });
            Fa3Builder.Dane dane;
            try { dane = await ZbudujDane(sale, u, db); }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
            string xml;
            try { xml = Fa3Builder.Zbuduj(dane); }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
            var walFa = Fa3Builder.Waliduj(xml, SchemasDir());
            if (!walFa.Ok && !walFa.Pominieta)
                return Results.BadRequest(new { code = "XSD", message = "FA(3) niezgodne ze schematem MF — wysyłka zablokowana.", bledy = walFa.Bledy });
            try
            {
                var sesja = await ksef.ZalogujTokenem(sr, nip, token, ct);
                var offline = sale.TrybKsef is "offline24" or "awaria";
                var wynik = await ksef.WyslijFakture(sr, sesja, xml, offline, ct);
                sale.Status = "w_ksef";
                sale.KsefId = string.IsNullOrEmpty(wynik.KsefNumber) ? wynik.FakturaRef : wynik.KsefNumber;
                await db.SaveChangesAsync(ct);
                return Results.Ok(new
                {
                    ksefNumber = wynik.KsefNumber,
                    fakturaRef = wynik.FakturaRef,
                    sesjaRef = wynik.SesjaRef,
                    srodowisko = sr,
                    info = string.IsNullOrEmpty(wynik.KsefNumber)
                        ? "Przyjęto do przetworzenia — numer KSeF i UPO pobierz za chwilę."
                        : "Przyjęto w KSeF.",
                });
            }
            catch (KsefException e)
            {
                return Results.Json(new { code = "KSEF_BLAD", message = e.Message }, statusCode: 502);
            }
        });

        g.MapGet("/upo", async (string sesjaRef, string fakturaRef, AppDbContext db, KsefClient ksef, CancellationToken ct) =>
        {
            var (u, sr, token, nip) = await Kontekst(db);
            if (string.IsNullOrWhiteSpace(token))
                return Results.BadRequest(new { code = "BRAK_TOKENA", message = "Wklej token KSeF." });
            try
            {
                var sesja = await ksef.ZalogujTokenem(sr, nip, token, ct);
                var upo = await ksef.PobierzUpo(sr, sesja, sesjaRef, fakturaRef, ct);
                return Results.Ok(new { srodowisko = sr, upo });
            }
            catch (KsefException e)
            {
                return Results.Json(new { code = "KSEF_BLAD", message = e.Message }, statusCode: 502);
            }
        });

        // Podgląd FA(3) XML bez wysyłki (weryfikacja przed wysyłką).
        g.MapGet("/podglad", async (string idFaktury, AppDbContext db) =>
        {
            var sale = await db.SalesInvoices.FindAsync(idFaktury);
            if (sale is null) return Results.NotFound(new { code = "BRAK_FAKTURY", message = "Nie znaleziono faktury." });
            var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
            try
            {
                var xml = Fa3Builder.Zbuduj(await ZbudujDane(sale, u, db));
                var wal = Fa3Builder.Waliduj(xml, SchemasDir());
                return Results.Ok(new
                {
                    xml,
                    formCode = "FA (3)",
                    schemaVersion = "1-0E",
                    walidacja = new { ok = wal.Ok, bledy = wal.Bledy, pominieta = wal.Pominieta },
                });
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
        });

        // Odbiór faktur zakupowych (jestem nabywcą — Subject2).
        g.MapPost("/odbior", async (OdbiorReq req, AppDbContext db, KsefClient ksef, CancellationToken ct) =>
        {
            var (u, sr, token, nip) = await Kontekst(db, req.Srodowisko);
            if (string.IsNullOrWhiteSpace(token))
                return Results.BadRequest(new { code = "BRAK_TOKENA", message = "Wklej token KSeF." });
            var @do = DateTimeOffset.UtcNow;
            DateTimeOffset od = @do.AddDays(-30);
            if (req is { Od: { } o } && DateTimeOffset.TryParse(o, out var oo)) od = oo;
            if (req is { Do: { } d } && DateTimeOffset.TryParse(d, out var dd)) @do = dd;
            try
            {
                var sesja = await ksef.ZalogujTokenem(sr, nip, token, ct);
                var meta = await ksef.MetadaneZakupow(sr, sesja, od, @do, ct: ct);
                return Results.Ok(new { srodowisko = sr, od, doDnia = @do, wynik = meta });
            }
            catch (KsefException e)
            {
                return Results.Json(new { code = "KSEF_BLAD", message = e.Message }, statusCode: 502);
            }
        });
    }

    private static string SchemasDir() =>
        Path.Combine(AppContext.BaseDirectory, "Schemas") is var a && Directory.Exists(a)
            ? a : Path.Combine(Directory.GetCurrentDirectory(), "Schemas");

    private static string NormalizujSr(string? sr) => sr switch
    {
        "prod" => "prod",
        "demo" => "demo",
        _ => "test",
    };

    private static async Task<(TaxpayerSettings U, string Sr, string? Token, string Nip)> Kontekst(
        AppDbContext db, string? nadpisane = null)
    {
        var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
        var sr = nadpisane is not null ? NormalizujSr(nadpisane) : NormalizujSr(u.KsefSrodowisko);
        return (u, sr, u.KsefToken?.Trim(), new string([.. (u.FirmaNip ?? "").Where(char.IsDigit)]));
    }

    private static async Task<Fa3Builder.Dane> ZbudujDane(Models.SalesInvoice e, TaxpayerSettings u, AppDbContext db)
    {
        Fa3Builder.Korekta? kor = null;
        if (e.Rodzaj == "korygujaca")
        {
            if (string.IsNullOrWhiteSpace(e.KorygujeNumer))
                throw new ArgumentException("Faktura korygująca: podaj numer faktury korygowanej.");
            var org = await db.SalesInvoices.FirstOrDefaultAsync(s => s.Numer == e.KorygujeNumer);
            var nrKsef = JpkV7Builder.CzyNrKsef(org?.KsefId) ? org!.KsefId!.Trim() : null;
            kor = new Fa3Builder.Korekta(e.KorygujeNumer!, org?.DataWystawienia ?? e.DataWystawienia, nrKsef, "Korekta wartości");
        }
        var pozycje = DtoMapper.ReadItems(e.PozycjeJson)
            .Select(p => new Fa3Builder.Pozycja(
                p.Nazwa,
                p.Ilosc,
                p.CenaNetto,
                MapujStawke(DtoMapper.CanonicalVatRate(p.StawkaVat))))
            .ToList();
        return new Fa3Builder.Dane(
            u.FirmaNip ?? "",
            u.FirmaNazwa ?? "", u.FirmaAdres ?? "",
            e.KontrahentNip ?? "", e.KontrahentNazwa ?? "", e.KontrahentAdres ?? "",
            e.Numer, e.DataWystawienia, string.IsNullOrWhiteSpace(e.DataSprzedazy) ? e.DataWystawienia : e.DataSprzedazy,
            pozycje,
            string.IsNullOrWhiteSpace(e.Waluta) ? "PLN" : e.Waluta!,
            e.KursNbp,
            string.IsNullOrWhiteSpace(e.TerminPlatnosci) ? null : e.TerminPlatnosci,
            !string.IsNullOrWhiteSpace(e.RachunekBankowy) ? e.RachunekBankowy
                : string.IsNullOrWhiteSpace(u.FirmaRachunek) ? null : u.FirmaRachunek,
            e.Mpp, e.Zal15, kor,
            string.IsNullOrWhiteSpace(e.RachunekBankowy) ? u.FirmaBank : null);
    }

    private static string MapujStawke(string canonical) => canonical switch
    {
        "0.23" => "23",
        "0.08" => "8",
        "0.05" => "5",
        "0" => "0",
        "zw" => "zw",
        "np" => "np",
        "oo" => "oo",
        _ => throw new ArgumentException($"Nieobsługiwana stawka VAT na fakturze: {canonical}."),
    };
}
