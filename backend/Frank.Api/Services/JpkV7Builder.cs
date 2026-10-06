using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Schema;

namespace Frank.Api.Services;

// Budowa JPK_V7M(3) / JPK_V7K(3) wg wzorów MF obowiązujących od 01.02.2026
// (14090 dla V7M, 14089 dla V7K; deklaracje VAT-7(23) / VAT-7K(17)).
// Mapowanie stawek: 23%→K_19/K_20 (P_19/P_20), 8%→K_17/K_18 (P_17/P_18),
// 5%→K_15/K_16 (P_15/P_16), zw→K_10 (P_10), 0%→K_13 (P_13), np→K_11 (P_11),
// oo→K_31/K_32=0. Zakupy: K_42/K_43 (pozostałe), K_40/K_41 = 0.
// Nadwyżka domyślnie przenoszona na następny okres (P_62), bez wniosku o zwrot.
public static class JpkV7Builder
{
    public const string NsV7M = "http://crd.gov.pl/wzor/2025/12/19/14090/";
    public const string NsV7K = "http://crd.gov.pl/wzor/2025/12/19/14089/";
    private const string NsEtd = "http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/";

    public sealed record Podmiot(
        string Nip, string Nazwa, string Email,
        bool OsobaFizyczna,
        string? Imie = null, string? Nazwisko = null, string? DataUrodzenia = null,
        string? Telefon = null, string KodUrzedu = "0000");

    public sealed record WierszS(
        string NrKontrahenta, string NazwaKontrahenta, string Dowod,
        string DataWystawienia, string? DataSprzedazy, string? KsefId,
        decimal K10, decimal K11, decimal K13,
        decimal K15, decimal K16, decimal K17, decimal K18, decimal K19, decimal K20,
        decimal K21, decimal K22, decimal K31);

    public sealed record WierszZ(
        string NrDostawcy, string NazwaDostawcy, string Dowod,
        string DataZakupu, string? KsefId, decimal Netto, decimal Vat);

    public sealed record Opcje(
        int CelZlozenia = 1,
        decimal NadwyzkaPoprzednia = 0,
        decimal ZwrotNaRachunek = 0,
        string ZwrotTryb = "P_540"); // P_540 | P_55 | P_56 | P_560 | P_58

    public static string ZbudujV7M(string rok, string miesiac, List<WierszS> s, List<WierszZ> z,
        Podmiot p, Opcje? op = null)
    {
        op ??= new Opcje();
        var sum = Sumuj(s, z, op);
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.Append($"<JPK xmlns=\"{NsV7M}\">\n");
        Naglowek(sb, "JPK_V7M (3)", "3", rok, $"<Miesiac>{miesiac}</Miesiac>", op.CelZlozenia, p.KodUrzedu);
        PodmiotXml(sb, p);
        DeklaracjaVat7(sb, sum, false, null, op);
        Ewidencja(sb, s, z, sum.VatNalezny, sum.VatNaliczony);
        sb.Append("</JPK>");
        return sb.ToString();
    }

    public static string ZbudujV7K(string rok, int kwartal, string miesiacOstatni,
        List<WierszS> s, List<WierszZ> z, Podmiot p, Opcje? op = null)
    {
        op ??= new Opcje();
        var sum = Sumuj(s, z, op);
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.Append($"<JPK xmlns=\"{NsV7K}\">\n");
        Naglowek(sb, "JPK_V7K (3)", "3", rok, $"<Miesiac>{miesiacOstatni}</Miesiac>", op.CelZlozenia, p.KodUrzedu);
        PodmiotXml(sb, p);
        DeklaracjaVat7(sb, sum, true, kwartal, op);
        Ewidencja(sb, s, z, sum.VatNalezny, sum.VatNaliczony);
        sb.Append("</JPK>");
        return sb.ToString();
    }

    private sealed record Sumy(
        decimal P10, decimal P11, decimal P13, decimal P15, decimal P16,
        decimal P17, decimal P18, decimal P19, decimal P20,
        decimal P37, decimal P38, decimal P39, decimal P42, decimal P43,
        decimal P48, decimal P51, decimal P53, decimal P54, decimal P62,
        decimal VatNalezny, decimal VatNaliczony);

    private static Sumy Sumuj(List<WierszS> s, List<WierszZ> z, Opcje op)
    {
        var p10 = R(s.Sum(x => x.K10)); var p11 = R(s.Sum(x => x.K11)); var p13 = R(s.Sum(x => x.K13));
        var p15 = R(s.Sum(x => x.K15)); var p16 = R(s.Sum(x => x.K16));
        var p17 = R(s.Sum(x => x.K17)); var p18 = R(s.Sum(x => x.K18));
        var p19 = R(s.Sum(x => x.K19)); var p20 = R(s.Sum(x => x.K20));
        // WDT/eksport/oo w deklaracji: P_21/P_22 (tu tylko z ewidencji K_21/K_22)
        var p21 = R(s.Sum(x => x.K21)); var p22 = R(s.Sum(x => x.K22));
        var p37 = R(p10 + p11 + p13 + p15 + p17 + p19 + p21 + p22);
        var p38 = R(p16 + p18 + p20);
        var p39 = R(op.NadwyzkaPoprzednia);
        var p42 = R(z.Sum(x => x.Netto)); var p43 = R(z.Sum(x => x.Vat));
        var p48 = R(p39 + p43);
        var p51 = Math.Max(0, R(p38 - p48));
        var p53 = Math.Max(0, R(p48 - p38));
        var p54 = R(Math.Min(op.ZwrotNaRachunek, p53));
        var p62 = R(p53 - p54);
        return new Sumy(p10, p11, p13, p15, p16, p17, p18, p19, p20, p37, p38, p39, p42, p43,
            p48, p51, p53, p54, p62, p38, p43);
    }

    private static void Naglowek(StringBuilder sb, string kod, string wariant, string rok,
        string okres, int cel, string kodUrzedu)
    {
        var kodForm = kod.StartsWith("JPK_V7K") ? "JPK_V7K (3)" : "JPK_V7M (3)";
        sb.Append("  <Naglowek>\n");
        sb.Append($"    <KodFormularza kodSystemowy=\"{kodForm}\" wersjaSchemy=\"1-0E\">JPK_VAT</KodFormularza>\n");
        sb.Append($"    <WariantFormularza>{wariant}</WariantFormularza>\n");
        sb.Append($"    <DataWytworzeniaJPK>{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}</DataWytworzeniaJPK>\n");
        sb.Append("    <NazwaSystemu>Frank-JDG</NazwaSystemu>\n");
        sb.Append($"    <CelZlozenia poz=\"P_7\">{cel}</CelZlozenia>\n");
        sb.Append($"    <KodUrzedu>{E(kodUrzedu)}</KodUrzedu>\n");
        sb.Append($"    <Rok>{E(rok)}</Rok>\n");
        sb.Append($"    {okres}\n");
        sb.Append("  </Naglowek>\n");
    }

    private static void PodmiotXml(StringBuilder sb, Podmiot p)
    {
        var nip = Cyfry(p.Nip);
        if (nip.Length != 10) throw new ArgumentException("NIP podmiotu musi mieć 10 cyfr.");
        sb.Append("  <Podmiot1 rola=\"Podatnik\">\n");
        if (p.OsobaFizyczna)
        {
            if (string.IsNullOrWhiteSpace(p.Imie) || string.IsNullOrWhiteSpace(p.Nazwisko))
                throw new ArgumentException("Osoba fizyczna: wymagane imię i nazwisko.");
            if (!DateOnly.TryParse(p.DataUrodzenia, out _))
                throw new ArgumentException("Osoba fizyczna: wymagana data urodzenia RRRR-MM-DD.");
            sb.Append("    <OsobaFizyczna>\n");
            sb.Append($"      <etd:NIP xmlns:etd=\"{NsEtd}\">{nip}</etd:NIP>\n");
            sb.Append($"      <etd:ImiePierwsze xmlns:etd=\"{NsEtd}\">{E(p.Imie!.Trim())}</etd:ImiePierwsze>\n");
            sb.Append($"      <etd:Nazwisko xmlns:etd=\"{NsEtd}\">{E(p.Nazwisko!.Trim())}</etd:Nazwisko>\n");
            sb.Append($"      <etd:DataUrodzenia xmlns:etd=\"{NsEtd}\">{p.DataUrodzenia}</etd:DataUrodzenia>\n");
            sb.Append($"      <Email>{E(p.Email)}</Email>\n");
            if (!string.IsNullOrWhiteSpace(p.Telefon))
                sb.Append($"      <Telefon>{E(p.Telefon!.Trim())}</Telefon>\n");
            sb.Append("    </OsobaFizyczna>\n");
        }
        else
        {
            sb.Append("    <OsobaNiefizyczna>\n");
            sb.Append($"      <NIP>{nip}</NIP>\n");
            sb.Append($"      <PelnaNazwa>{E(p.Nazwa)}</PelnaNazwa>\n");
            sb.Append($"      <Email>{E(p.Email)}</Email>\n");
            if (!string.IsNullOrWhiteSpace(p.Telefon))
                sb.Append($"      <Telefon>{E(p.Telefon!.Trim())}</Telefon>\n");
            sb.Append("    </OsobaNiefizyczna>\n");
        }
        sb.Append("  </Podmiot1>\n");
    }

    private static void DeklaracjaVat7(StringBuilder sb, Sumy s, bool kwartalna, int? kwartal, Opcje op)
    {
        var kod = kwartalna ? "VAT-7K (17)" : "VAT-7 (23)";
        var wart = kwartalna ? "VAT-7K" : "VAT-7";
        var wariant = kwartalna ? "17" : "23";
        sb.Append("  <Deklaracja>\n    <Naglowek>\n");
        sb.Append($"      <KodFormularzaDekl kodSystemowy=\"{kod}\" kodPodatku=\"VAT\" rodzajZobowiazania=\"Z\" wersjaSchemy=\"1-0E\">{wart}</KodFormularzaDekl>\n");
        sb.Append($"      <WariantFormularzaDekl>{wariant}</WariantFormularzaDekl>\n");
        if (kwartalna) sb.Append($"      <Kwartal>{kwartal}</Kwartal>\n");
        sb.Append("    </Naglowek>\n    <PozycjeSzczegolowe>\n");
        if (!kwartalna)
        {
            Pole(sb, "P_10", s.P10); Pole(sb, "P_11", s.P11); Pole(sb, "P_12", 0);
            Pole(sb, "P_13", s.P13); Pole(sb, "P_14", 0);
            Pole(sb, "P_15", s.P15); Pole(sb, "P_16", s.P16);
            Pole(sb, "P_17", s.P17); Pole(sb, "P_18", s.P18);
            Pole(sb, "P_19", s.P19); Pole(sb, "P_20", s.P20);
            Pole(sb, "P_21", 0); Pole(sb, "P_22", 0);
            for (var i = 23; i <= 32; i++) Pole(sb, $"P_{i}", 0);
            Pole(sb, "P_33", 0); Pole(sb, "P_34", 0); Pole(sb, "P_35", 0); Pole(sb, "P_36", 0);
        }
        Pole(sb, "P_37", s.P37); Pole(sb, "P_38", s.P38); Pole(sb, "P_39", s.P39);
        Pole(sb, "P_40", 0); Pole(sb, "P_41", 0);
        Pole(sb, "P_42", s.P42); Pole(sb, "P_43", s.P43);
        Pole(sb, "P_44", 0); Pole(sb, "P_45", 0); Pole(sb, "P_46", 0); Pole(sb, "P_47", 0);
        Pole(sb, "P_48", s.P48);
        Pole(sb, "P_51", s.P51); Pole(sb, "P_53", s.P53); Pole(sb, "P_54", s.P54);
        var tryb = op.ZwrotTryb is "P_55" or "P_56" or "P_560" or "P_58" ? op.ZwrotTryb : "P_540";
        sb.Append($"      <{tryb}>1</{tryb}>\n");
        Pole(sb, "P_62", s.P62);
        Pole(sb, "P_68", 0); Pole(sb, "P_69", 0);
        sb.Append("    </PozycjeSzczegolowe>\n    <Pouczenia>1</Pouczenia>\n  </Deklaracja>\n");
    }

    private static void Ewidencja(StringBuilder sb, List<WierszS> s, List<WierszZ> z,
        decimal vatNalezny, decimal vatNaliczony)
    {
        sb.Append("  <Ewidencja>\n");
        for (var i = 0; i < s.Count; i++)
        {
            var w = s[i];
            var nip = Cyfry(w.NrKontrahenta);
            if (nip.Length != 10)
                throw new ArgumentException($"Sprzedaż {w.Dowod}: NIP kontrahenta musi mieć 10 cyfr.");
            sb.Append("    <SprzedazWiersz>\n");
            sb.Append($"      <LpSprzedazy>{i + 1}</LpSprzedazy>\n");
            sb.Append("      <KodKrajuNadaniaTIN>PL</KodKrajuNadaniaTIN>\n");
            sb.Append($"      <NrKontrahenta>{nip}</NrKontrahenta>\n");
            sb.Append($"      <NazwaKontrahenta>{E(w.NazwaKontrahenta)}</NazwaKontrahenta>\n");
            sb.Append($"      <DowodSprzedazy>{E(w.Dowod)}</DowodSprzedazy>\n");
            sb.Append($"      <DataWystawienia>{w.DataWystawienia}</DataWystawienia>\n");
            if (!string.IsNullOrWhiteSpace(w.DataSprzedazy))
                sb.Append($"      <DataSprzedazy>{w.DataSprzedazy}</DataSprzedazy>\n");
            sb.Append($"      {ZnakKsef(w.KsefId)}\n");
            if (w.K10 > 0) Pole6(sb, "K_10", w.K10);
            if (w.K11 > 0) Pole6(sb, "K_11", w.K11);
            if (w.K13 > 0) Pole6(sb, "K_13", w.K13);
            if (w.K15 > 0 || w.K16 > 0) { Pole6(sb, "K_15", w.K15); Pole6(sb, "K_16", w.K16); }
            if (w.K17 > 0 || w.K18 > 0) { Pole6(sb, "K_17", w.K17); Pole6(sb, "K_18", w.K18); }
            if (w.K19 > 0 || w.K20 > 0) { Pole6(sb, "K_19", w.K19); Pole6(sb, "K_20", w.K20); }
            if (w.K21 > 0) Pole6(sb, "K_21", w.K21);
            if (w.K22 > 0) Pole6(sb, "K_22", w.K22);
            if (w.K31 > 0) { Pole6(sb, "K_31", w.K31); Pole6(sb, "K_32", 0); }
            sb.Append("    </SprzedazWiersz>\n");
        }
        sb.Append("    <SprzedazCtrl>\n");
        sb.Append($"      <LiczbaWierszySprzedazy>{s.Count}</LiczbaWierszySprzedazy>\n");
        sb.Append($"      <PodatekNalezny>{F(vatNalezny)}</PodatekNalezny>\n");
        sb.Append("    </SprzedazCtrl>\n");
        for (var i = 0; i < z.Count; i++)
        {
            var w = z[i];
            var nip = Cyfry(w.NrDostawcy);
            if (nip.Length != 10)
                throw new ArgumentException($"Zakup {w.Dowod}: NIP dostawcy musi mieć 10 cyfr (paragony bez NIP pomiń w JPK).");
            sb.Append("    <ZakupWiersz>\n");
            sb.Append($"      <LpZakupu>{i + 1}</LpZakupu>\n");
            sb.Append("      <KodKrajuNadaniaTIN>PL</KodKrajuNadaniaTIN>\n");
            sb.Append($"      <NrDostawcy>{nip}</NrDostawcy>\n");
            sb.Append($"      <NazwaDostawcy>{E(w.NazwaDostawcy)}</NazwaDostawcy>\n");
            sb.Append($"      <DowodZakupu>{E(w.Dowod)}</DowodZakupu>\n");
            sb.Append($"      <DataZakupu>{w.DataZakupu}</DataZakupu>\n");
            sb.Append($"      {ZnakKsef(w.KsefId)}\n");
            Pole6(sb, "K_40", 0); Pole6(sb, "K_41", 0);
            Pole6(sb, "K_42", w.Netto); Pole6(sb, "K_43", w.Vat);
            sb.Append("    </ZakupWiersz>\n");
        }
        sb.Append("    <ZakupCtrl>\n");
        sb.Append($"      <LiczbaWierszyZakupow>{z.Count}</LiczbaWierszyZakupow>\n");
        sb.Append($"      <PodatekNaliczony>{F(vatNaliczony)}</PodatekNaliczony>\n");
        sb.Append("    </ZakupCtrl>\n");
        sb.Append("  </Ewidencja>\n");
    }

    // NrKSeF tylko gdy pasuje do wzoru MF (TNumerKSeF) — lokalne/mockowe
    // identyfikatory (np. "KSEF-…") trafiają do BFK, żeby nie psuć walidacji XSD.
    private static readonly System.Text.RegularExpressions.Regex WzorNrKsef = new(
        @"^([1-9]((\d[1-9])|([1-9]\d))\d{7}|M\d{9}|[A-Z]{3}\d{7})" +
        @"-(20[2-9][0-9]|2[1-9][0-9]{2}|[3-9][0-9]{3})(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1])" +
        @"-([0-9A-F]{6})-?([0-9A-F]{6})-([0-9A-F]{2})$",
        System.Text.RegularExpressions.RegexOptions.Compiled);

    private static string ZnakKsef(string? ksefId)
    {
        var id = (ksefId ?? "").Trim();
        return id != "" && WzorNrKsef.IsMatch(id) ? $"<NrKSeF>{E(id)}</NrKSeF>" : "<BFK>1</BFK>";
    }

    // Pola deklaracji (TKwotaC): liczby całkowite w groszach.
    private static void Pole(StringBuilder sb, string nazwa, decimal v) =>
        sb.Append($"      <{nazwa}>{G(v)}</{nazwa}>\n");

    // Pola ewidencji (TKwotowy): dziesiętne z 2 miejscami.
    private static void Pole6(StringBuilder sb, string nazwa, decimal v) =>
        sb.Append($"      <{nazwa}>{F(v)}</{nazwa}>\n");

    private static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    private static string F(decimal v) => R(v).ToString("0.00", CultureInfo.InvariantCulture);

    private static string G(decimal v) =>
        Math.Round(R(v) * 100m, 0, MidpointRounding.AwayFromZero).ToString("0", CultureInfo.InvariantCulture);

    private static string Cyfry(string? s) => new([.. (s ?? "").Where(char.IsDigit)]);

    private static string E(string? s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";

    // ---------- walidacja XSD (lokalna, przed wysyłką) ----------

    public sealed record Walidacja(bool Ok, List<string> Bledy, bool Pominieta);

    public static Walidacja Waliduj(string xml, bool kwartalny, string schemasDir)
    {
        var w = XsdWalidator.Waliduj(xml, kwartalny ? "jpk_v7k3_14089.xsd" : "jpk_v7m3_14090.xsd", schemasDir);
        return new Walidacja(w.Ok, w.Bledy, w.Pominieta);
    }
}
