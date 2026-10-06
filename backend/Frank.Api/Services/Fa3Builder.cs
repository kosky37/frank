using System.Globalization;
using System.Text;

namespace Frank.Api.Services;

// Budowa minimalnej, poprawnej składniowo faktury FA(3) wg schematu MF
// (namespace http://crd.gov.pl/wzor/2025/06/25/13775/, kod FA (3) / 1-0E).
// Pokrywa standardowy przypadek JDG B2B: VAT 23/8/5/0%/zw/np/oo, PLN/EUR/USD,
// adnotacje MPP (P_18A), JST=2/GV=2, RodzajFaktury VAT albo KOR (korekta różnicowa
// z DaneFaKorygowanej), nabywca z NIP / VAT UE / innym identyfikatorem, sekcja Platnosc.
// Zaliczkowe/proformy nie są wysyłane — proforma nie jest fakturą, zaliczkowa wymaga sekcji ZAL.
public static class Fa3Builder
{
    public sealed record Pozycja(string Nazwa, decimal Ilosc, decimal CenaNetto, string Stawka);
    // Stawka: "23" | "8" | "5" | "0" | "zw" | "np" | "oo"

    public sealed record Korekta(string NrFaKorygowanej, string DataWystFaKorygowanej, string? NrKSeFFaKorygowanej, string? Przyczyna);

    public sealed record Dane(
        string NipSprzedawcy, string NazwaSprzedawcy, string AdresSprzedawcy,
        string NipNabywcy, string NazwaNabywcy, string AdresNabywcy,
        string Numer, string DataWystawienia, string DataSprzedazy,
        List<Pozycja> Pozycje,
        string Waluta = "PLN", decimal? KursNbp = null,
        string? TerminPlatnosci = null, string? RachunekBankowy = null,
        bool Mpp = false, bool Zal15 = false,
        Korekta? Koryguje = null, string? NazwaBanku = null);

    private static readonly HashSet<string> KrajeUe =
    [
        "AT", "BE", "BG", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "HR", "HU", "IE", "IT",
        "LV", "LT", "LU", "MT", "NL", "PT", "RO", "SK", "SI", "ES", "SE", "XI",
    ];

    /// Identyfikator nabywcy: 10 cyfr → NIP; prefiks kraju UE → KodUE + NrVatUE; inne litery → NrID; pusty → BrakID.
    public static (string Xml, string KodKraju) IdentyfikatorNabywcy(string? nip)
    {
        var raw = new string([.. (nip ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit)]);
        if (raw.Length == 0) return ("      <BrakID>1</BrakID>\n", "PL");
        if (raw.StartsWith("PL", StringComparison.Ordinal) && raw.Length == 12) raw = raw[2..];
        if (raw.Length == 10 && raw.All(char.IsDigit)) return ($"      <NIP>{raw}</NIP>\n", "PL");
        if (raw.Length > 2 && char.IsLetter(raw[0]) && char.IsLetter(raw[1]))
        {
            var kod = raw[..2];
            var nr = raw[2..];
            if (KrajeUe.Contains(kod) && nr.Length is >= 1 and <= 12)
                return ($"      <KodUE>{kod}</KodUE>\n      <NrVatUE>{nr}</NrVatUE>\n", kod == "EL" ? "GR" : kod == "XI" ? "GB" : kod);
            return ($"      <KodKraju>{kod}</KodKraju>\n      <NrID>{E(nr)}</NrID>\n", kod);
        }
        throw new ArgumentException("NIP nabywcy: 10 cyfr (PL) albo numer z prefiksem kraju (np. DE123456789).");
    }

    public static string Zbuduj(Dane d)
    {
        if (d.Pozycje.Count == 0)
            throw new ArgumentException("Faktura bez pozycji.", nameof(d));
        var nipS = Cyfry(d.NipSprzedawcy);
        if (nipS.Length != 10) throw new ArgumentException("NIP sprzedawcy musi mieć 10 cyfr.");
        var (idNabywcy, krajNabywcy) = IdentyfikatorNabywcy(d.NipNabywcy);
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
        // MPP obowiązkowy tylko dla towarów/usług z zał. 15 powyżej 15 000 zł brutto (art. 106e ust. 1 pkt 18a)
        var mpp = d.Mpp || (d.Zal15 && Math.Abs(brutto) > 15000);
        var maOo = bOo != 0;
        var kurs = !string.Equals(d.Waluta, "PLN", StringComparison.OrdinalIgnoreCase) && d.KursNbp is decimal kk && kk > 0 ? kk : (decimal?)null;

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
        sb.Append(idNabywcy);
        sb.Append($"      <Nazwa>{E(Skroc(d.NazwaNabywcy, 512))}</Nazwa>\n");
        sb.Append("    </DaneIdentyfikacyjne>\n");
        if (!string.IsNullOrWhiteSpace(d.AdresNabywcy))
        {
            sb.Append($"    <Adres>\n      <KodKraju>{krajNabywcy}</KodKraju>\n");
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
        // P_14_xW: VAT przeliczony na PLN dla faktur w walucie obcej (art. 106e ust. 11)
        if (b23 != 0) Grupa(sb, "P_13_1", "P_14_1", b23, v23, kurs, 0.23m);
        if (b8 != 0) Grupa(sb, "P_13_2", "P_14_2", b8, v8, kurs, 0.08m);
        if (b5 != 0) Grupa(sb, "P_13_3", "P_14_3", b5, v5, kurs, 0.05m);
        if (b0 != 0) sb.Append($"    <P_13_6_1>{F(b0)}</P_13_6_1>\n");
        if (bZw != 0) sb.Append($"    <P_13_7>{F(bZw)}</P_13_7>\n");
        if (bNp != 0) sb.Append($"    <P_13_8>{F(bNp)}</P_13_8>\n");
        if (bOo != 0) sb.Append($"    <P_13_10>{F(bOo)}</P_13_10>\n");
        sb.Append($"    <P_15>{F(brutto)}</P_15>\n");
        if (kurs is decimal k)
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
        if (d.Koryguje is { } kor)
        {
            sb.Append("    <RodzajFaktury>KOR</RodzajFaktury>\n");
            if (!string.IsNullOrWhiteSpace(kor.Przyczyna))
                sb.Append($"    <PrzyczynaKorekty>{E(Skroc(kor.Przyczyna, 256))}</PrzyczynaKorekty>\n");
            sb.Append("    <TypKorekty>2</TypKorekty>\n");
            sb.Append("    <DaneFaKorygowanej>\n");
            sb.Append($"      <DataWystFaKorygowanej>{kor.DataWystFaKorygowanej}</DataWystFaKorygowanej>\n");
            sb.Append($"      <NrFaKorygowanej>{E(kor.NrFaKorygowanej)}</NrFaKorygowanej>\n");
            if (!string.IsNullOrWhiteSpace(kor.NrKSeFFaKorygowanej))
                sb.Append($"      <NrKSeF>1</NrKSeF>\n      <NrKSeFFaKorygowanej>{E(kor.NrKSeFFaKorygowanej)}</NrKSeFFaKorygowanej>\n");
            else
                sb.Append("      <NrKSeFN>1</NrKSeFN>\n");
            sb.Append("    </DaneFaKorygowanej>\n");
        }
        else
        {
            sb.Append("    <RodzajFaktury>VAT</RodzajFaktury>\n");
        }
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
        var nrb = new string([.. (d.RachunekBankowy ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit)]);
        if (!string.IsNullOrWhiteSpace(d.TerminPlatnosci) || nrb.Length >= 10)
        {
            sb.Append("    <Platnosc>\n");
            if (!string.IsNullOrWhiteSpace(d.TerminPlatnosci))
                sb.Append($"      <TerminPlatnosci>\n        <Termin>{d.TerminPlatnosci}</Termin>\n      </TerminPlatnosci>\n");
            sb.Append("      <FormaPlatnosci>6</FormaPlatnosci>\n");
            if (nrb.Length is >= 10 and <= 34)
            {
                sb.Append($"      <RachunekBankowy>\n        <NrRB>{nrb}</NrRB>\n");
                if (!string.IsNullOrWhiteSpace(d.NazwaBanku))
                    sb.Append($"        <NazwaBanku>{E(Skroc(d.NazwaBanku, 256))}</NazwaBanku>\n");
                sb.Append("      </RachunekBankowy>\n");
            }
            sb.Append("    </Platnosc>\n");
        }
        sb.Append("  </Fa>\n");
        sb.Append("</Faktura>");
        return sb.ToString();
    }

    private static void Grupa(StringBuilder sb, string baza, string podatek, decimal b, decimal v, decimal? kurs, decimal stawka)
    {
        sb.Append($"    <{baza}>{F(b)}</{baza}>\n");
        sb.Append($"    <{podatek}>{F(v)}</{podatek}>\n");
        if (kurs is decimal k)
            sb.Append($"    <{podatek}W>{F(Round2(Round2(b * k) * stawka))}</{podatek}W>\n");
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
