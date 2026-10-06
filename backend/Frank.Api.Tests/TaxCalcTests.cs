using Frank.Api.Models;
using Frank.Api.Tax;

namespace Frank.Api.Tests;

// Parzyste z frontend/src-shared/tax/tax.test.ts — parzystość TS <-> C#.
public sealed class TaxCalcTests
{
    private static CostInvoice PaliwoMieszane() => new()
    {
        Id = "c1",
        Numer = "FV/1",
        Wystawca = "Orlen",
        DataZakupu = "2026-01-05",
        DataKsiegowania = "2026-01-05",
        Kategoria = "paliwo",
        Pojazdowy = true,
        UzytkowaniePojazdu = "mieszany",
        Netto = 1000m,
        StawkaVat = "0.23",
        Opis = "paliwo",
    };

    private static TaxpayerSettings Ustawienia(string forma, decimal ryczalt = 0.12m) => new()
    {
        FormaOpodatkowania = forma,
        StawkaRyczaltu = ryczalt,
        ZusSpoleczneMies = 1773.96m,
        ZusZdrowotnaMies = 314.96m,
        ZusFpMies = 101.02m,
    };

    [Fact]
    public void PojazdMieszany_Vat50_Pit75()
    {
        var c = PaliwoMieszane();
        Assert.Equal(115m, VatCalc.DeductibleVat(c));
        Assert.Equal(750m, VatCalc.DeductibleCostPit(c));
    }

    [Fact]
    public void Niepojazdowy_PelneOdliczenia()
    {
        var c = PaliwoMieszane();
        c.Pojazdowy = false;
        Assert.Equal(230m, VatCalc.DeductibleVat(c));
        Assert.Equal(1000m, VatCalc.DeductibleCostPit(c));
    }

    [Fact]
    public void VatSprzedazy_SumaPozycji()
    {
        var items = new List<InvoiceItemDto>
        {
            new("dev", 1, 20000m,
                System.Text.Json.JsonDocument.Parse("0.23").RootElement.Clone()),
        };
        var (netto, vat, brutto) = VatCalc.SalesTotals(items);
        Assert.Equal(20000m, netto);
        Assert.Equal(4600m, vat);
        Assert.Equal(24600m, brutto);
        Assert.Equal(4485m, Money.Round2(vat - 115m));
    }

    [Fact]
    public void Pit_Liniowy19_OdDochoduPoZus()
    {
        var s = new MonthlySums("2026-01", 20000m, 2000m, 0, 0, 1773.96m, 314.96m, []);
        var r = PitCalc.ZaliczkaMiesieczna(s, Ustawienia("liniowy"));
        // (20000-2000-1773.96-314.96)=15911.08 *19% = 3023.11
        Assert.Equal(3023.11m, r.Podatek);
    }

    [Fact]
    public void Pit_Ryczalt12_PoZusI50ProcZdrowotnej()
    {
        var s = new MonthlySums("2026-01", 20000m, 9999m, 0, 0, 1000m, 400m, []);
        var r = PitCalc.ZaliczkaMiesieczna(s, Ustawienia("ryczalt"));
        // podstawa 20000-1000-200=18800 *12%=2256
        Assert.Equal(18800m, r.Podstawa);
        Assert.Equal(2256m, r.Podatek);
    }

    [Fact]
    public void Pit_RocznySkala_ZProgiem()
    {
        var r = PitCalc.Roczny(200000m, 20000m, 20000m, 10000m, Ustawienia("skala"));
        Assert.Equal("PIT-36", r.Formularz);
        // dochód 160k: 120k*12%-3600 +40k*32% = 23600
        Assert.Equal(23600m, r.Podatek);
    }

    [Fact]
    public void Pit_RocznyLiniowy_Pit36L()
    {
        var r = PitCalc.Roczny(240000m, 24000m, 21287m, 15000m, Ustawienia("liniowy"));
        Assert.Equal("PIT-36L", r.Formularz);
    }

    [Fact]
    public void Pit_RocznyRyczalt_Pit28()
    {
        var r = PitCalc.Roczny(240000m, 99999m, 20000m, 6000m, Ustawienia("ryczalt"));
        Assert.Equal("PIT-28", r.Formularz);
        Assert.Equal(217000m, r.Podstawa);
    }

    [Fact]
    public void Pit_Ryczalt_WieleStawek_ProporcjonalnyZus()
    {
        // 20 000 @12% + 10 000 @8,5%, odliczenie 1200 rozdzielone proporcjonalnie:
        // 12%: (20000-800)*12% = 2304; 8,5%: (10000-400)*8,5% = 816
        var s = new MonthlySums("2026-02", 30000m, 0, 0, 0, 1000m, 400m,
            [new RyczaltSplit(0.12m, 20000m), new RyczaltSplit(0.085m, 10000m)]);
        var r = PitCalc.ZaliczkaMiesieczna(s, Ustawienia("ryczalt"));
        Assert.Equal(28800m, r.Podstawa);
        Assert.Equal(3120m, r.Podatek);
    }

    [Fact]
    public void Pit_RocznyRyczalt_WieleStawek()
    {
        var r = PitCalc.Roczny(360000m, 0, 20000m, 6000m, Ustawienia("ryczalt"),
            [new RyczaltSplit(0.12m, 240000m), new RyczaltSplit(0.085m, 120000m)]);
        Assert.Equal("PIT-28", r.Formularz);
        Assert.Equal(337000m, r.Podstawa);
        Assert.Equal(36508.33m, r.Podatek);
    }

    [Fact]
    public void AgregacjaMiesiaca_PomijaRobocze()
    {
        var u = Ustawienia("liniowy");
        var sales = new List<SalesInvoice>
        {
            new()
            {
                Id = "x", Numer = "1/2026", Status = "robocza",
                DataSprzedazy = "2026-01-31",
                PozycjeJson = """[{"nazwa":"dev","ilosc":1,"cenaNetto":20000,"stawkaVat":0.23}]""",
            },
        };
        var sums = TaxAggregator.Aggregate("2026-01", sales, [], u);
        Assert.Equal(0m, sums.PrzychodNetto);
    }

    [Fact]
    public void AgregacjaMiesiaca_PomijaProforme()
    {
        var u = Ustawienia("liniowy");
        var sales = new List<SalesInvoice>
        {
            new()
            {
                Id = "x", Numer = "PRO/1", Status = "wystawiona", Rodzaj = "proforma",
                DataSprzedazy = "2026-01-31",
                PozycjeJson = """[{"nazwa":"oferta","ilosc":1,"cenaNetto":20000,"stawkaVat":0.23}]""",
            },
        };
        var sums = TaxAggregator.Aggregate("2026-01", sales, [], u);
        Assert.Equal(0m, sums.PrzychodNetto);
    }

    [Fact]
    public void Zus_ZdrowotnaMin_StyczenVsLuty()
    {
        Assert.Equal(314.96m, ZusCalc.ZdrowotnaMin("2026-01", 432.54m));
        Assert.Equal(432.54m, ZusCalc.ZdrowotnaMin("2026-02", 432.54m));
        Assert.Equal(14100m, Rates2026.LiniowyZdrowotnaLimitRoczny);
    }

    [Fact]
    public void Zus_RyczaltTiers()
    {
        Assert.Equal(498.35m, ZusCalc.RyczaltZdrowotna(50000m));
        Assert.Equal(830.58m, ZusCalc.RyczaltZdrowotna(200000m));
        Assert.Equal(1495.04m, ZusCalc.RyczaltZdrowotna(500000m));
    }

    [Fact]
    public void Pit_Danina4Powyzej1M()
    {
        Assert.Equal(0m, PitCalc.Danina(900000m));
        Assert.Equal(4000m, PitCalc.Danina(1100000m));
    }

    [Fact]
    public void Koszt_Art23_NigdyKup()
    {
        var c = PaliwoMieszane();
        c.Pojazdowy = false;
        c.NieodliczalnyArt23 = true;
        Assert.Equal(0m, VatCalc.DeductibleVat(c));
        Assert.Equal(0m, VatCalc.DeductibleCostPit(c));
    }

    [Fact]
    public void Zus_WakacjeSkladkowe_ZerujaSpoleczne()
    {
        var u = Ustawienia("liniowy");
        u.WakacjeSkladkoweMiesiac = "2026-07";
        var z = ZusCalc.Miesieczny(u, 20000m, "2026-07");
        Assert.Equal(0m, z.Spoleczne);
        Assert.Equal(0m, z.Fp);
        Assert.True(z.Zdrowotna > 0);
        var zwykly = ZusCalc.Miesieczny(u, 20000m, "2026-08");
        Assert.True(zwykly.Spoleczne > 0);
    }

    [Fact]
    public void Agregacja_Wakacje_ZerujaSpoleczneWPit()
    {
        var u = Ustawienia("liniowy");
        u.WakacjeSkladkoweMiesiac = "2026-07";
        var sums = TaxAggregator.Aggregate("2026-07", [], [], u);
        Assert.Equal(0m, sums.ZusSpoleczne);
    }

    [Fact]
    public void Slowniki_StawkiNaRok_2025vs2026()
    {
        Assert.Equal(200000m, Frank.Api.Reference.Slowniki.StawkiNaRok(2025).VatLimitZwolnienia);
        Assert.Equal(240000m, Frank.Api.Reference.Slowniki.StawkiNaRok(2026).VatLimitZwolnienia);
        Assert.Equal(14100m, Frank.Api.Reference.Slowniki.StawkiNaRok(2027).LiniowyZdrowotnaLimit);
    }

    [Fact]
    public void Mock_KsefZakupy_MajaKsztaltDoImportu()
    {
        var f = Frank.Api.Services.MockIntegrations.PrzykladoweZakupy();
        Assert.Equal(2, f.Length);
    }
}
