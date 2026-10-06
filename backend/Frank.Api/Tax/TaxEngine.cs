using Frank.Api.Models;

namespace Frank.Api.Tax;

// Port logiki z frontend/src-shared/tax (vat.ts, pit.ts, zus.ts, rates2026.ts).
// Reguły 2026 dla JDG B2B programisty. Testy parzyste: Frank.Api.Tests/TaxCalcTests.

public static class Rates2026
{
    public const decimal SkalaProg = 120000m;
    public const decimal SkalaStawka1 = 0.12m;
    public const decimal SkalaStawka2 = 0.32m;
    public const decimal KwotaWolna = 30000m;
    public const decimal KwotaZmniejszajaca = 3600m;
    public const decimal LiniowyStawka = 0.19m;
    public const decimal LiniowyZdrowotnaLimitRoczny = 14100m;
    public const decimal PojazdMieszanyVat = 0.5m;
    public const decimal PojazdMieszanyPit = 0.75m;
    public const decimal ZusZdrowotnaMinStyczen = 314.96m;
    public const decimal ZusZdrowotnaMin = 432.54m;
    public const decimal RyczaltZdrowotnaT1 = 498.35m;
    public const decimal RyczaltZdrowotnaT2 = 830.58m;
    public const decimal RyczaltZdrowotnaT3 = 1495.04m;
    public const decimal VatLimitZwolnienia = 240000m;
    public const decimal DaninaProg = 1000000m;
    public const decimal DaninaStawka = 0.04m;
}

public static class Money
{
    public static decimal Round2(decimal v) =>
        Math.Round(v, 2, MidpointRounding.AwayFromZero);
}

public static class VatCalc
{
    public static decimal RateToNumber(string canonical) =>
        decimal.TryParse(canonical, System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0m;

    public static decimal VatForNetto(decimal netto, string stawkaVat) =>
        Money.Round2(netto * RateToNumber(stawkaVat));

    public static decimal DeductibleVat(CostInvoice c, bool vatowiec = true)
    {
        if (!vatowiec || c.NieodliczalnyArt23) return 0m;
        if (c.VatNaliczonyDowolny is decimal forced)
            return Money.Round2(forced);
        var vat = VatForNetto(c.Netto, c.StawkaVat);
        if (!c.Pojazdowy) return vat;
        return c.UzytkowaniePojazdu switch
        {
            "mieszany" => Money.Round2(vat * Rates2026.PojazdMieszanyVat),
            "wylacznie_firma" => vat,
            _ => 0m,
        };
    }

    /// Koszt PIT: netto + VAT nieodliczony (art. 23 ust. 1 pkt 43 lit. a), pojazd mieszany 75% z tej sumy.
    public static decimal DeductibleCostPit(CostInvoice c, bool vatowiec = true)
    {
        if (c.NieodliczalnyArt23) return 0m;
        if (c.Pojazdowy && c.UzytkowaniePojazdu == "prywatny") return 0m;
        var vat = VatForNetto(c.Netto, c.StawkaVat);
        var nieodliczony = Math.Max(0m, Money.Round2(vat - DeductibleVat(c, vatowiec)));
        var baza = Money.Round2(c.Netto + nieodliczony);
        return c.Pojazdowy && c.UzytkowaniePojazdu == "mieszany"
            ? Money.Round2(baza * Rates2026.PojazdMieszanyPit)
            : baza;
    }

    /// Kurs przeliczenia faktury na PLN (1 dla PLN lub braku kursu).
    public static decimal Kurs(SalesInvoice s) =>
        string.IsNullOrWhiteSpace(s.Waluta) || string.Equals(s.Waluta, "PLN", StringComparison.OrdinalIgnoreCase)
            ? 1m
            : s.KursNbp is decimal k && k > 0 ? k : 1m;

    /// Netto pozycji w PLN (× kurs NBP); VAT liczony od podstawy w PLN (art. 31a).
    public static decimal LineNettoPln(InvoiceItemDto p, decimal kurs) =>
        Money.Round2(Money.Round2(p.Ilosc * p.CenaNetto) * kurs);

    public static (decimal Netto, decimal Vat, decimal Brutto) SalesTotalsPln(IEnumerable<InvoiceItemDto> items, decimal kurs)
    {
        if (kurs == 1m) return SalesTotals(items);
        decimal netto = 0, vat = 0;
        foreach (var p in items)
        {
            var line = LineNettoPln(p, kurs);
            netto += line;
            vat += VatForNetto(line, DtoMapper.CanonicalVatRate(p.StawkaVat));
        }
        netto = Money.Round2(netto);
        vat = Money.Round2(vat);
        return (netto, vat, Money.Round2(netto + vat));
    }

    public static (decimal Netto, decimal Vat, decimal Brutto) SalesTotals(IEnumerable<InvoiceItemDto> items)
    {
        decimal netto = 0, vat = 0;
        foreach (var p in items)
        {
            var line = Money.Round2(p.Ilosc * p.CenaNetto);
            netto += line;
            vat += VatForNetto(line, DtoMapper.CanonicalVatRate(p.StawkaVat));
        }
        netto = Money.Round2(netto);
        vat = Money.Round2(vat);
        return (netto, vat, Money.Round2(netto + vat));
    }
}

public sealed record RyczaltSplit(decimal Stawka, decimal Przychod);

public sealed record MonthlySums(
    string Miesiac,
    decimal PrzychodNetto,
    decimal KosztyNettoPit,
    decimal VatNalezny,
    decimal VatNaliczony,
    decimal ZusSpoleczne,
    decimal ZusZdrowotna,
    List<RyczaltSplit> RyczaltSplit);

public sealed record PitResult(decimal Podstawa, decimal Podatek, decimal EfektywnaStawka, string Opis);

public sealed record RocznyPitResult(
    string Formularz, decimal Podstawa, decimal Podatek,
    decimal EfektywnaStawka, decimal SkladkiOdliczone, string Opis,
    decimal Danina = 0m);

public sealed record ZusResult(
    decimal Spoleczne, decimal Zdrowotna, decimal Fp, decimal Razem, string Opis);

public static class PitCalc
{
    /// Ryczałt liczony per stawka; odliczenie ZUS rozdzielane proporcjonalnie
    /// do przychodu (wymóg ewidencji przychodów wg stawek, art. 15 ustawy).
    public static decimal RyczaltPodatek(
        IEnumerable<RyczaltSplit> split, decimal domyslnaStawka, decimal odliczenie)
    {
        var pozycje = split.ToList();
        var razem = Money.Round2(pozycje.Sum(p => p.Przychod));
        if (razem <= 0) return 0m;
        decimal podatek = 0m;
        foreach (var g in pozycje.GroupBy(p => p.Stawka))
        {
            var przychod = Money.Round2(g.Sum(p => p.Przychod));
            var stawka = g.Key <= 0 ? domyslnaStawka : g.Key;
            var podstawa = Math.Max(0, Money.Round2(przychod - odliczenie * przychod / razem));
            podatek += Money.Round2(podstawa * stawka);
        }
        return Money.Round2(podatek);
    }

    public static PitResult ZaliczkaMiesieczna(MonthlySums s, TaxpayerSettings u, decimal odliczonaZdrowotnaNarastajaco = 0m)
    {
        if (u.FormaOpodatkowania == "ryczalt")
        {
            var odliczenie = Money.Round2(s.ZusSpoleczne + Money.Round2(s.ZusZdrowotna * 0.5m));
            var podstawa = Math.Max(0, Money.Round2(s.PrzychodNetto - odliczenie));
            var split = s.RyczaltSplit.Count > 0
                ? s.RyczaltSplit
                : [new RyczaltSplit(u.StawkaRyczaltu, s.PrzychodNetto)];
            var podatek = RyczaltPodatek(split, u.StawkaRyczaltu, odliczenie);
            var ile = split.Select(x => x.Stawka).Distinct().Count();
            return new(podstawa, podatek, u.StawkaRyczaltu,
                ile > 1
                    ? $"Ryczałt {ile} stawki (per pozycja) po odliczeniu ZUS społecznych i 50% zdrowotnej"
                    : $"Ryczałt {(u.StawkaRyczaltu * 100):0}% od przychodu po odliczeniu ZUS społecznych i 50% zdrowotnej");
        }
        var dochod = Math.Max(0, Money.Round2(s.PrzychodNetto - s.KosztyNettoPit - s.ZusSpoleczne));
        if (u.FormaOpodatkowania == "liniowy")
        {
            var pozostalyLimit = Math.Max(0, Rates2026.LiniowyZdrowotnaLimitRoczny - odliczonaZdrowotnaNarastajaco);
            var zdr = Math.Min(s.ZusZdrowotna, pozostalyLimit);
            var podstawaLin = Math.Max(0, Money.Round2(dochod - zdr));
            return new(podstawaLin, Money.Round2(podstawaLin * Rates2026.LiniowyStawka),
                Rates2026.LiniowyStawka, "Liniówka 19% od dochodu po ZUS społecznych i zdrowotnej w limicie 14 100/rok");
        }
        var ulga = Money.Round2(Rates2026.KwotaZmniejszajaca / 12);
        return new(dochod, Math.Max(0, Money.Round2(dochod * Rates2026.SkalaStawka1 - ulga)),
            Rates2026.SkalaStawka1, "Skala 12% (próg 32% rozliczany rocznie) minus 1/12 kwoty zmniejszającej");
    }

    public static decimal Danina(decimal dochod) =>
        dochod <= Rates2026.DaninaProg ? 0m : Money.Round2((dochod - Rates2026.DaninaProg) * Rates2026.DaninaStawka);

    public static RocznyPitResult Roczny(
        decimal przychod, decimal koszty,
        decimal zusSpoleczneRok, decimal zusZdrowotnaRok, TaxpayerSettings u,
        List<RyczaltSplit>? ryczaltSplit = null)
    {
        if (u.FormaOpodatkowania == "ryczalt")
        {
            var zdr = Money.Round2(zusZdrowotnaRok * 0.5m);
            var odliczenie = Money.Round2(zusSpoleczneRok + zdr);
            var podstawa = Math.Max(0, Money.Round2(przychod - odliczenie));
            var split = ryczaltSplit is { Count: > 0 }
                ? ryczaltSplit
                : [new RyczaltSplit(u.StawkaRyczaltu, przychod)];
            var podatekRyczalt = RyczaltPodatek(split, u.StawkaRyczaltu, odliczenie);
            return new("PIT-28", podstawa, podatekRyczalt,
                u.StawkaRyczaltu, odliczenie,
                $"PIT-28: ryczałt {(u.StawkaRyczaltu * 100):0}%");
        }
        var dochod = Math.Max(0, Money.Round2(przychod - koszty - zusSpoleczneRok));
        if (u.FormaOpodatkowania == "liniowy")
        {
            var zdr = Math.Min(zusZdrowotnaRok, Rates2026.LiniowyZdrowotnaLimitRoczny);
            var podstawa = Math.Max(0, Money.Round2(dochod - zdr));
            return new("PIT-36L", podstawa, Money.Round2(podstawa * Rates2026.LiniowyStawka),
                Rates2026.LiniowyStawka, Money.Round2(zusSpoleczneRok + zdr),
                "PIT-36L: 19% flat, zdrowotna do limitu 14 100/rok", Danina(dochod));
        }
        decimal podatek = dochod <= Rates2026.SkalaProg
            ? Math.Max(0, Money.Round2(dochod * Rates2026.SkalaStawka1 - Rates2026.KwotaZmniejszajaca))
            : Money.Round2(Rates2026.SkalaProg * Rates2026.SkalaStawka1 - Rates2026.KwotaZmniejszajaca
                + (dochod - Rates2026.SkalaProg) * Rates2026.SkalaStawka2);
        return new("PIT-36", dochod, podatek,
            dochod == 0 ? 0 : Money.Round2(podatek / dochod), zusSpoleczneRok,
            "PIT-36: skala 12% do 120k, 32% powyżej, kwota wolna 30k", Danina(dochod));
    }
}

public static class ZusCalc
{
    public static decimal ZdrowotnaMin(string miesiac, decimal fallback) =>
        miesiac.EndsWith("-01", StringComparison.Ordinal) ? Rates2026.ZusZdrowotnaMinStyczen : Math.Max(fallback, Rates2026.ZusZdrowotnaMin);

    public static decimal RyczaltZdrowotna(decimal przychodRocznyPoSpolecznych) =>
        przychodRocznyPoSpolecznych <= 60000m ? Rates2026.RyczaltZdrowotnaT1
        : przychodRocznyPoSpolecznych <= 300000m ? Rates2026.RyczaltZdrowotnaT2
        : Rates2026.RyczaltZdrowotnaT3;

    public static ZusResult Miesieczny(TaxpayerSettings u, decimal? dochodMies = null, string miesiac = "", decimal? przychodRocznyPoSpolecznych = null)
    {
        if (u.ZusSchemat is "start" or "ulgowy")
        {
            var zdr = string.IsNullOrEmpty(miesiac) ? Money.Round2(u.ZusZdrowotnaMies) : ZdrowotnaMin(miesiac, u.ZusZdrowotnaMies);
            return new(0, zdr, 0, zdr, "Ulga na start: tylko zdrowotna (6 mies.)");
        }
        // Wakacje składkowe: zwolniony miesiąc bez społecznych i FP (zdrowotna zostaje).
        var wakacje = !string.IsNullOrEmpty(miesiac) && u.WakacjeSkladkoweMiesiac == miesiac;
        var spoleczne = wakacje ? 0m : Money.Round2(u.ZusSpoleczneMies);
        var fp = wakacje ? 0m : Money.Round2(u.ZusFpMies);
        decimal zdrowotna;
        string opis;
        if (u.FormaOpodatkowania == "skala")
        {
            var min = string.IsNullOrEmpty(miesiac) ? u.ZusZdrowotnaMies : ZdrowotnaMin(miesiac, u.ZusZdrowotnaMies);
            zdrowotna = Math.Max(min, Money.Round2((dochodMies ?? 0) * 0.09m));
            opis = "Zdrowotna skala: 9% dochodu (min. ustawieniowe)";
        }
        else if (u.FormaOpodatkowania == "liniowy")
        {
            var min = string.IsNullOrEmpty(miesiac) ? u.ZusZdrowotnaMies : ZdrowotnaMin(miesiac, u.ZusZdrowotnaMies);
            zdrowotna = Math.Max(min, Money.Round2((dochodMies ?? 0) * 0.049m));
            opis = "Zdrowotna liniowa: 4,9% dochodu (min. ustawieniowe)";
        }
        else
        {
            if (przychodRocznyPoSpolecznych is decimal p)
            {
                zdrowotna = RyczaltZdrowotna(p);
                opis = "Zdrowotna ryczałt: tier z przychodu rocznego (498/831/1495)";
            }
            else
            {
                zdrowotna = Money.Round2(u.ZusZdrowotnaMies);
                opis = "Zdrowotna ryczałt: wg przedziału przychodu (wartość z Ustawień)";
            }
        }
        if (wakacje) opis += " + wakacje składkowe";
        return new(spoleczne, zdrowotna, fp, Money.Round2(spoleczne + zdrowotna + fp), opis);
    }
}

public static class TaxAggregator
{
    public static MonthlySums Aggregate(
        string miesiac, IEnumerable<SalesInvoice> sales, IEnumerable<CostInvoice> costs,
        TaxpayerSettings u)
    {
        decimal przychod = 0, vatNalezny = 0;
        var split = new Dictionary<decimal, decimal>();
        foreach (var s in sales)
        {
            if (!s.DataSprzedazy.StartsWith(miesiac, StringComparison.Ordinal)) continue;
            // Robocze i proformy nie wchodzą do PIT/VAT (parzyste z aggregateMonth w TS).
            if (s.Status == "robocza" || s.Rodzaj == "proforma") continue;
            var items = DtoMapper.ReadItems(s.PozycjeJson);
            var kurs = VatCalc.Kurs(s);
            var (n, v, _) = VatCalc.SalesTotalsPln(items, kurs);
            przychod += n;
            vatNalezny += v;
            if (u.FormaOpodatkowania == "ryczalt")
            {
                foreach (var p in items)
                {
                    var line = VatCalc.LineNettoPln(p, kurs);
                    var stawka = p.StawkaRyczaltu is decimal r && r > 0 ? r : u.StawkaRyczaltu;
                    split[stawka] = split.GetValueOrDefault(stawka) + line;
                }
            }
        }
        decimal koszty = 0, vatNaliczony = 0;
        foreach (var c in costs)
        {
            if (!c.DataKsiegowania.StartsWith(miesiac, StringComparison.Ordinal)) continue;
            koszty += VatCalc.DeductibleCostPit(c, u.Vatowiec);
            vatNaliczony += VatCalc.DeductibleVat(c, u.Vatowiec);
        }
        // Wakacje składkowe / ulga na start: bez społecznych w podstawie PIT.
        var bezSpol = u.WakacjeSkladkoweMiesiac == miesiac || u.ZusSchemat is "start" or "ulgowy";
        var spol = bezSpol ? 0m : u.ZusSpoleczneMies;
        return new(miesiac,
            Money.Round2(przychod), Money.Round2(koszty),
            Money.Round2(vatNalezny), Money.Round2(vatNaliczony),
            spol, u.ZusZdrowotnaMies,
            split.Select(kv => new RyczaltSplit(kv.Key, Money.Round2(kv.Value))).ToList());
    }
}
