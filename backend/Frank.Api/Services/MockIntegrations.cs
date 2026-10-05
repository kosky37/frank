using System.Globalization;
using System.Security.Cryptography;
using Frank.Api.Tax;

namespace Frank.Api.Services;

// Mock bramek e-administracji (KSeF / JPK / ZUS / mikrorachunek).
// Zwraca REALNE kształty payloadów do podglądu i testów w trybie demo —
// produkcyjna wysyłka wymaga certyfikatów i bramek MF/ZUS.
public static class MockIntegrations
{
    private static readonly int[] WagiNip = [6, 5, 7, 2, 3, 4, 5, 6, 7];

    public static bool CzyNipPoprawny(string nip)
    {
        var d = new string([.. nip.Where(char.IsDigit)]);
        if (d.Length != 10) return false;
        var s = 0;
        for (var i = 0; i < 9; i++) s += (d[i] - '0') * WagiNip[i];
        var k = s % 11;
        return k < 10 && k == d[9] - '0';
    }

    /// Mikrorachunek: PLkk + 10100071 + 222 + NIP(10) + 000, kk = mod97 (ISO 13616).
    /// Przybliżenie liczone lokalnie — zweryfikuj w generatorze MF.
    public static string Mikrorachunek(string nip)
    {
        var d = new string([.. nip.Where(char.IsDigit)]);
        if (d.Length != 10) throw new ArgumentException("NIP musi mieć 10 cyfr.", nameof(nip));
        var bban = $"10100071222{d}000"; // 8 + 3 + 10 + 3 = 24 cyfry
        var rest = 0;
        foreach (var ch in $"{bban}252100") rest = (rest * 10 + (ch - '0')) % 97;
        return $"PL{(98 - rest):D2}{bban}";
    }

    public static string KsefFakeId() =>
        $"{DateTime.UtcNow:yyyyMMdd}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant()}";

    /// Przykładowe faktury zakupowe z KSeF (tryb demo) — kształt FA(3)-like do importu jako koszty.
    public static object[] PrzykladoweZakupy() =>
    [
        new {
            ksefId = "20261005-demo0001",
            numer = "FV/DEMO/10/2026",
            nipSprzedawcy = "5260000000",
            nazwaSprzedawcy = "Demo Usługi Sp. z o.o.",
            dataSprzedazy = "2026-10-02",
            pozycje = new[] { new { nazwa = "Abonament IDE 10/2026", ilosc = 1m, cenaNetto = 300m, stawkaVat = "0.23" } },
            netto = 300m,
            vat = 69m,
            brutto = 369m,
        },
        new {
            ksefId = "20261005-demo0002",
            numer = "FV/DEMO/11/2026",
            nipSprzedawcy = "5270000000",
            nazwaSprzedawcy = "Demo Hosting S.A.",
            dataSprzedazy = "2026-10-03",
            pozycje = new[] { new { nazwa = "Hosting VPS 10/2026", ilosc = 1m, cenaNetto = 199m, stawkaVat = "0.23" } },
            netto = 199m,
            vat = 45.77m,
            brutto = 244.77m,
        },
    ];

    public static string JpkV7Xml(string month, MonthlySums sums, int salesCount)
    {
        var vatDoZaplaty = Money.Round2(sums.VatNalezny - sums.VatNaliczony);
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            + "<JPK kodSystemowy=\"JPK_V7M (2)\">\n"
            + "  <Naglowek><KodFormularza>JPK_V7M</KodFormularza>"
            + $"<Miesiac>{Esc(month)}</Miesiac>"
            + $"<DataWytworzeniaJPK>{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}</DataWytworzeniaJPK>"
            + "<NazwaSystemu>Frank-JDG</NazwaSystemu></Naglowek>\n"
            + "  <Ewidencja>\n"
            + $"    <SprzedazCtrl><LiczbaWierszySprzedazy>{salesCount}</LiczbaWierszySprzedazy>"
            + $"<PodatekNalezny>{F(sums.VatNalezny)}</PodatekNalezny></SprzedazCtrl>\n"
            + $"    <ZakupCtrl><PodatekNaliczony>{F(sums.VatNaliczony)}</PodatekNaliczony></ZakupCtrl>\n"
            + "  </Ewidencja>\n"
            + "  <Deklaracja>"
            + $"<P_38>{F(sums.VatNalezny)}</P_38><P_39>{F(sums.VatNaliczony)}</P_39>"
            + $"<P_51>{F(Math.Max(0, vatDoZaplaty))}</P_51><P_54>{F(Math.Max(0, -vatDoZaplaty))}</P_54>"
            + "</Deklaracja>\n</JPK>";
    }

    public static string DraXml(string month, decimal spoleczne, decimal zdrowotna, string nrs, string kodTytulu)
    {
        var razem = Money.Round2(spoleczne + zdrowotna);
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ZUSDRA>\n"
            + $"  <NRS>{Esc(nrs)}</NRS>\n  <KodTytulu>{Esc(kodTytulu)}</KodTytulu>\n"
            + $"  <Okres>{Esc(month)}</Okres>\n"
            + $"  <Spoleczne>{F(spoleczne)}</Spoleczne>\n  <Zdrowotna>{F(zdrowotna)}</Zdrowotna>\n"
            + $"  <Razem>{F(razem)}</Razem>\n</ZUSDRA>";
    }

    private static string F(decimal v) => v.ToString("0.00", CultureInfo.InvariantCulture);

    private static string Esc(string? s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";
}
