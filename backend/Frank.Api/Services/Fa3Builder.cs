using System.Globalization;
using System.Text;

namespace Frank.Api.Services;

// Budowa minimalnej, poprawnej składniowo faktury FA(3) wg schematu MF
// (namespace http://crd.gov.pl/wzor/2025/06/25/13775/, kod FA (3) / 1-0E).
// Pokrywa standardowy przypadek JDG B2B: VAT 23/8/5/0%/zw/np/oo, PLN/EUR/USD,
// adnotacje MPP (P_18A), JST=2/GV=2, RodzajFaktury=VAT.
// Korygujące/zaliczkowe/proformy nie są wysyłane (osobny błąd) — KSeF wymaga
// pełnych sekcji korekty (DaneFaKorygowanej) poza zakresem minimalnej wysyłki.
public static class Fa3Builder
{
    public sealed record Pozycja(string Nazwa, decimal Ilosc, decimal CenaNetto, string Stawka);
    // Stawka: "23" | "8" | "5" | "0" | "zw" | "np" | "oo"

    public sealed record Dane(
        string NipSprzedawcy, string NazwaSprzedawcy, string AdresSprzedawcy,
        string NipNabywcy, string NazwaNabywcy, string AdresNabywcy,
        string Numer, string DataWystawienia, string DataSprzedazy,
        List<Pozycja> Pozycje,
        string Waluta = "PLN", decimal? KursNbp = null,
        string? TerminPlatnosci = null, string? RachunekBankowy = null,
        bool Mpp = false, bool Zal15 = false);

    public static string Zbuduj(Dane d)
    {
        if (d.Pozycje.Count == 0)
            throw new ArgumentException("Faktura bez pozycji.", nameof(d));
        var nipS = Cyfry(d.NipSprzedawcy);
        var nipN = Cyfry(d.NipNabywcy);
        if (nipS.Length != 10) throw new ArgumentException("NIP sprzedawcy musi mieć 10 cyfr.");
        if (nipN.Length != 10 && d.NipNabywcy.Trim() != "") throw new ArgumentException("NIP nabywcy musi mieć 10 cyfr.");
        var wiersze = d.Pozycje.Select((p, i) =>
        {
            var netto = Round2(p.Ilosc * p.CenaNetto);
            return (Lp: i + 1, Nazwa: p.Nazwa, Ilosc: p.Ilosc, Cena: p.CenaNetto, Netto: netto, Stawka: p.Stawka);
        }).ToList();

        decimal b23 = 0, v23 = 0, b8 = 0, v8 = 0, b5 = 0, v5 = 0, b0 = 0, bZw = 0, bNp = 0, bOo = 0;
        foreach (var w in wiersze)
        {
            var vat = VatOd(w.Netto, w.Stawka);
            switch (w.Stawka)
            {
                case "23": b23 += w.Netto; v23 += vat; break;
                case "8": b8 += w.Netto; v8 += vat; break;
                case "5": b5 += w.Netto; v5 += vat; break;
                case "0": b0 += w.Netto; break;
                case "zw": bZw += w.Netto; break;
                case "np": bNp += w.Netto; break;
                case "oo": bOo += w.Netto; break;
                default: throw new ArgumentException($"Nieobsługiwana stawka FA(3): {w.Stawka}.");
            }
        }
        var brutto = Round2(b23 + v23 + b8 + v8 + b5 + v5 + b0 + bZw + bNp + bOo);
        var mpp = d.Mpp || d.Zal15 || brutto > 15000;
        var maOo = bOo > 0;

        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.Append("<Faktura xmlns=\"http://crd.gov.pl/wzor/2025/06/25/13775/\">\n");
        sb.Append("  <Naglowek>\n");
        sb.Append("    <KodFormularza kodSystemowy=\"FA (3)\" wersjaSchemy=\"1-0E\">FA</KodFormularza>\n");
        sb.Append("    <WariantFormularza>3</WariantFormularza>\n");
        sb.Append($"    <DataWytworzeniaFa>{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}</DataWytworzeniaFa>\n");
        sb.Append("    <SystemInfo>Frank-JDG</SystemInfo>\n");
        sb.Append("  </Naglowek>\n");
        // Podmiot1 — sprzedawca
        sb.Append("  <Podmiot1>\n");
        sb.Append("    <DaneIdentyfikacyjne>\n");
        sb.Append($"      <NIP>{nipS}</NIP>\n");
        sb.Append($"      <Nazwa>{E(Skroc(d.NazwaSprzedawcy, 512))}</Nazwa>\n");
        sb.Append("    </DaneIdentyfikacyjne>\n");
        sb.Append("    <Adres>\n      <KodKraju>PL</KodKraju>\n");
        sb.Append($"      <AdresL1>{E(Skroc(d.AdresSprzedawcy, 512))}</AdresL1>\n    </Adres>\n");
        sb.Append("  </Podmiot1>\n");
        // Podmiot2 — nabywca
        sb.Append("  <Podmiot2>\n");
        sb.Append("    <DaneIdentyfikacyjne>\n");
        sb.Append($"      <NIP>{nipN}</NIP>\n");
        sb.Append($"      <Nazwa>{E(Skroc(d.NazwaNabywcy, 512))}</Nazwa>\n");
        sb.Append("    </DaneIdentyfikacyjne>\n");
        if (!string.IsNullOrWhiteSpace(d.AdresNabywcy))
        {
            sb.Append("    <Adres>\n      <KodKraju>PL</KodKraju>\n");
            sb.Append($"      <AdresL1>{E(Skroc(d.AdresNabywcy, 512))}</AdresL1>\n    </Adres>\n");
        }
        sb.Append("    <JST>2</JST>\n    <GV>2</GV>\n");
        sb.Append("  </Podmiot2>\n");
        // Fa
        sb.Append("  <Fa>\n");
        sb.Append($"    <KodWaluty>{E(d.Waluta)}</KodWaluty>\n");
        sb.Append($"    <P_1>{d.DataWystawienia}</P_1>\n");
        sb.Append($"    <P_2>{E(d.Numer)}</P_2>\n");
        sb.Append($"    <P_6>{d.DataSprzedazy}</P_6>\n");
        if (b23 > 0) Grupa(sb, "P_13_1", "P_14_1", b23, v23);
        if (b8 > 0) Grupa(sb, "P_13_2", "P_14_2", b8, v8);
        if (b5 > 0) Grupa(sb, "P_13_3", "P_14_3", b5, v5);
        if (b0 > 0) sb.Append($"    <P_13_6_1>{F(b0)}</P_13_6_1>\n");
        if (bZw > 0) sb.Append($"    <P_13_7>{F(bZw)}</P_13_7>\n");
        if (bNp > 0) sb.Append($"    <P_13_8>{F(bNp)}</P_13_8>\n");
        if (bOo > 0) sb.Append($"    <P_13_10>{F(bOo)}</P_13_10>\n");
        sb.Append($"    <P_15>{F(brutto)}</P_15>\n");
        if (!string.Equals(d.Waluta, "PLN", StringComparison.OrdinalIgnoreCase) && d.KursNbp is decimal k && k > 0)
            sb.Append($"    <KursWalutyZ>{Fk(k)}</KursWalutyZ>\n");
        sb.Append("    <Adnotacje>\n");
        sb.Append("      <P_16>2</P_16>\n      <P_17>2</P_17>\n");
        sb.Append($"      <P_18>{(maOo ? 1 : 2)}</P_18>\n");
        sb.Append($"      <P_18A>{(mpp ? 1 : 2)}</P_18A>\n");
        sb.Append("      <Zwolnienie><P_19N>1</P_19N></Zwolnienie>\n");
        sb.Append("      <NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>\n");
        sb.Append("      <P_23>2</P_23>\n");
        sb.Append("      <PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>\n");
        sb.Append("    </Adnotacje>\n");
        sb.Append("    <RodzajFaktury>VAT</RodzajFaktury>\n");
        foreach (var w in wiersze)
        {
            sb.Append("    <FaWiersz>\n");
            sb.Append($"      <NrWierszaFa>{w.Lp}</NrWierszaFa>\n");
            sb.Append($"      <P_7>{E(Skroc(w.Nazwa, 512))}</P_7>\n");
            sb.Append("      <P_8A>szt.</P_8A>\n");
            sb.Append($"      <P_8B>{Fk(w.Ilosc)}</P_8B>\n");
            sb.Append($"      <P_9A>{Fk(w.Cena)}</P_9A>\n");
            sb.Append($"      <P_11>{F(w.Netto)}</P_11>\n");
            sb.Append($"      <P_12>{StawkaFa(w.Stawka)}</P_12>\n");
            sb.Append("    </FaWiersz>\n");
        }
        sb.Append("  </Fa>\n");
        sb.Append("</Faktura>");
        return sb.ToString();
    }

    private static void Grupa(StringBuilder sb, string baza, string podatek, decimal b, decimal v)
    {
        sb.Append($"    <{baza}>{F(b)}</{baza}>\n");
        sb.Append($"    <{podatek}>{F(v)}</{podatek}>\n");
    }

    private static decimal VatOd(decimal netto, string stawka) => stawka switch
    {
        "23" => Round2(netto * 0.23m),
        "8" => Round2(netto * 0.08m),
        "5" => Round2(netto * 0.05m),
        _ => 0m,
    };

    private static string StawkaFa(string s) => s switch
    {
        "23" => "23",
        "8" => "8",
        "5" => "5",
        "0" => "0 KR",
        "zw" => "zw",
        "oo" => "oo",
        "np" => "np I",
        _ => throw new ArgumentException($"Nieobsługiwana stawka FA(3): {s}."),
    };

    private static decimal Round2(decimal v) =>
        Math.Round(v, 2, MidpointRounding.AwayFromZero);

    private static string F(decimal v) =>
        Round2(v).ToString("0.00", CultureInfo.InvariantCulture);

    private static string Fk(decimal v) =>
        Math.Round(v, 6, MidpointRounding.AwayFromZero).ToString("0.######", CultureInfo.InvariantCulture);

    private static string Cyfry(string? s) => new([.. (s ?? "").Where(char.IsDigit)]);

    public sealed record Walidacja(bool Ok, List<string> Bledy, bool Pominieta);

    public static Walidacja Waliduj(string xml, string schemasDir)
    {
        var w = XsdWalidator.Waliduj(xml, "fa3_1-0E.xsd", schemasDir);
        return new Walidacja(w.Ok, w.Bledy, w.Pominieta);
    }

    private static string Skroc(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? "-" : s.Trim().Length <= max ? s.Trim() : s.Trim()[..max];

    private static string E(string? s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";
}
