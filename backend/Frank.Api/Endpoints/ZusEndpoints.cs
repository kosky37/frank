using Frank.Api.Data;
using Frank.Api.Models;
using Frank.Api.Services;
using Frank.Api.Tax;
using Microsoft.EntityFrameworkCore;

namespace Frank.Api.Endpoints;

// Eksport ZUS DRA do KEDU 5.6 (oficjalny format wymiany ZUS, XSD z BIP).
// Import: Płatnik (Dokumenty wprowadzone → Importuj dokumenty) albo ePłatnik
// (Dokumenty ubezpieczeniowe → Import KEDU); podpis i wysyłka Profilem
// Zaufanym / kwalifikowanym już w Płatniku/ePłatniku. Bezpośrednie API ZUS
// (EWD) wymaga podpisu XAdES — stąd model plikowy, jak w wFirma/inFakt.
public static class ZusEndpoints
{
    public sealed record KeduReq(
        string Miesiac,
        decimal Emerytalne, decimal Rentowe, decimal Chorobowe, decimal Wypadkowe,
        decimal Zdrowotna, decimal Fp,
        decimal PodstawaEmerytalnaRentowa, decimal PodstawaChorobowa,
        decimal PodstawaWypadkowa, decimal PodstawaZdrowotna,
        decimal StopaWypadkowa = 1.67m,
        string? KodTytulu = null, string? Imie = null, string? Nazwisko = null,
        decimal? DochodPoprzedniMiesiac = null, decimal? PrzychodYtd = null);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/zus");

        // Propozycja wartości (z wyliczeń aplikacji) + gotowy KEDU jednym wywołaniem.
        g.MapGet("/kedu-propozycja", async (string miesiac, AppDbContext db) =>
        {
            try
            {
                var prop = await Propozycja(miesiac, db);
                return Results.Ok(prop);
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
        });

        g.MapPost("/kedu", async (KeduReq req, AppDbContext db) =>
        {
            var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
            if (!System.Text.RegularExpressions.Regex.IsMatch(req.Miesiac, @"^\d{4}-\d{2}$"))
                return Results.BadRequest(new { code = "ZLE_DANE", message = "Miesiąc RRRR-MM." });
            var di = new ZusKeduBuilder.Dochod(
                u.FormaOpodatkowania ?? "liniowy",
                req.DochodPoprzedniMiesiac ?? 0, req.PodstawaZdrowotna, req.PrzychodYtd ?? 0);
            var dane = new ZusKeduBuilder.Dane(
                req.Miesiac,
                new ZusKeduBuilder.Platnik(
                    u.FirmaNip ?? "", u.FirmaRegon,
                    Skrot(u.FirmaNazwa ?? "", 31), req.Nazwisko, req.Imie),
                new ZusKeduBuilder.Fundusze(
                    req.Emerytalne, req.Rentowe, req.Chorobowe, req.Wypadkowe,
                    req.Zdrowotna, req.Fp),
                req.KodTytulu ?? u.ZusKodTytulu ?? KodZDomyslnego(u.ZusSchemat),
                req.PodstawaEmerytalnaRentowa, req.PodstawaChorobowa,
                req.PodstawaWypadkowa, req.PodstawaZdrowotna,
                req.StopaWypadkowa <= 0 ? 1.67m : req.StopaWypadkowa,
                di);
            string xml;
            try { xml = ZusKeduBuilder.Zbuduj(dane); }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { code = "ZLE_DANE", message = e.Message });
            }
            var wal = ZusKeduBuilder.Waliduj(xml, SchemasDir());
            if (!wal.Ok && !wal.Pominieta)
                return Results.BadRequest(new { code = "XSD", message = "KEDU niezgodne ze schematem ZUS.", bledy = wal.Bledy });
            return Results.Ok(new
            {
                xml,
                walidacja = new { ok = wal.Ok, bledy = wal.Bledy, pominieta = wal.Pominieta },
                importInfo = "Import: Płatnik → Dokumenty wprowadzone → Importuj dokumenty, albo ePłatnik → Import KEDU.",
            });
        });
    }

    private static string SchemasDir() =>
        Path.Combine(AppContext.BaseDirectory, "Schemas") is var a && Directory.Exists(a)
            ? a : Path.Combine(Directory.GetCurrentDirectory(), "Schemas");

    private static string Skrot(string s, int max) =>
        string.IsNullOrWhiteSpace(s) ? "-" : s.Trim().Length <= max ? s.Trim() : s.Trim()[..max];

    private static string KodZDomyslnego(string? schemat) => schemat switch
    {
        "start" => "05 40",
        "preferencyjny" => "05 70",
        "maly_plus" => "05 90",
        _ => "05 10",
    };

    private static async Task<object> Propozycja(string miesiac, AppDbContext db)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(miesiac, @"^\d{4}-\d{2}$"))
            throw new ArgumentException("Miesiąc RRRR-MM.");
        var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
        var sales = await db.SalesInvoices.ToListAsync();
        var costs = await db.CostInvoices.ToListAsync();
        var sums = TaxAggregator.Aggregate(miesiac, sales, costs, u);
        var dochod = Math.Max(0, sums.PrzychodNetto - sums.KosztyNettoPit - sums.ZusSpoleczne);
        var zus = ZusCalc.Miesieczny(u, dochodMies: dochod, miesiac: miesiac);
        var wakacje = u.WakacjeSkladkoweMiesiac == miesiac;
        decimal podstawa = u.ZusSchemat switch
        {
            "preferencyjny" => 1441.80m,
            "start" => 0m,
            "maly_plus" => 0m, // podstawa od dochodu — uzupełnij ręcznie
            _ => 5652m,
        };
        if (wakacje) podstawa = 0m;
        var split = ZusKeduBuilder.ProponujPodzial(podstawa, zus.Spoleczne > 0, zus.Zdrowotna, zus.Fp);
        if (u.ZusSchemat == "maly_plus")
            split = split with { Emerytalne = 0, Rentowe = 0, Chorobowe = 0, Wypadkowe = 0 };
        // dochód poprzedniego miesiąca (do bloku XI) i przychód YTD (ryczałt)
        var rok = miesiac[..4]; var mNum = int.Parse(miesiac[5..]);
        var poprz = mNum == 1 ? $"{int.Parse(rok) - 1}-12" : $"{rok}-{mNum - 1:D2}";
        decimal dochodPoprz = 0, przychodYtd = 0;
        try
        {
            var sPop = TaxAggregator.Aggregate(poprz, sales, costs, u);
            dochodPoprz = Math.Max(0, sPop.PrzychodNetto - sPop.KosztyNettoPit - sPop.ZusSpoleczne);
            for (var m = 1; m <= mNum; m++)
                przychodYtd += TaxAggregator.Aggregate($"{rok}-{m:D2}", sales, costs, u).PrzychodNetto;
            przychodYtd = Money.Round2(przychodYtd);
        }
        catch { /* brak danych */ }
        var stopa = u.FormaOpodatkowania == "liniowy" ? 0.049m : 0.09m;
        var minPodst = miesiac[5..] == "01" ? 3499.55m : 4806m;
        var podstZdr = Money.Round2(Math.Max(zus.Zdrowotna / stopa, zus.Zdrowotna > 0 ? minPodst : 0));
        return new
        {
            miesiac,
            spoleczne = zus.Spoleczne,
            zdrowotna = zus.Zdrowotna,
            fp = zus.Fp,
            razem = zus.Razem,
            emerytalne = split.Emerytalne,
            rentowe = split.Rentowe,
            chorobowe = split.Chorobowe,
            wypadkowe = split.Wypadkowe,
            podstawaEmerytalnaRentowa = podstawa,
            podstawaChorobowa = split.Chorobowe > 0 ? podstawa : 0,
            podstawaWypadkowa = podstawa,
            podstawaZdrowotna = podstZdr,
            stopaWypadkowa = 1.67m,
            kodTytulu = u.ZusKodTytulu ?? KodZDomyslnego(u.ZusSchemat),
            dochodPoprzedniMiesiac = Money.Round2(dochodPoprz),
            przychodYtd,
            uwaga = u.ZusSchemat == "maly_plus"
                ? "Mały ZUS Plus: podstawa od dochodu — uzupełnij podział na fundusze ręcznie przed pobraniem KEDU."
                : wakacje
                    ? "Wakacje składkowe: społeczne + FP = 0, zdrowotna zostaje."
                    : "Podział na fundusze wg stóp ustawowych — zweryfikuj w Płatniku po imporcie.",
        };
    }
}
