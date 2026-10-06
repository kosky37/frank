using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Schema;

namespace Frank.Api.Services;

// Eksport ZUS DRA do pliku KEDU 5.6 (namespace http://www.zus.pl/2024/KEDU_5_6)
// wg „Specyfikacji wejścia-wyjścia" v2.27 i Załącznika 1 (ZUS BIP).
// Plik importujesz w Płatniku (Dokumenty wprowadzone → Importuj dokumenty)
// albo w ePłatniku (Dokumenty ubezpieczeniowe → Import KEDU), tam podpisujesz
// Profilem Zaufanym / kwalifikowanym i wysyłasz. ZUS nie udostępnia API
// do wysyłki bez podpisu — bezpośrednia wysyłka EWD wymaga XAdES.
public static class ZusKeduBuilder
{
    public const string NsKedu = "http://www.zus.pl/2024/KEDU_5_6";

    public sealed record Platnik(
        string Nip, string? Regon, string NazwaSkrocona,
        string? Nazwisko, string? Imie);

    public sealed record Fundusze(
        decimal Emerytalne, decimal Rentowe, decimal Chorobowe, decimal Wypadkowe,
        decimal Zdrowotna, decimal Fp);

    public sealed record Dochod(
        string FormaOpodatkowania, // skala | liniowy | ryczalt
        decimal DochodPoprzedniMiesiac, decimal PodstawaZdrowotna,
        decimal PrzychodYtd);

    public sealed record Dane(
        string Okres, // RRRR-MM
        Platnik Platnik,
        Fundusze Skladki,
        string KodTytulu, // "05 40" | "05 90" | "01 10" | "05 10" | ...
        decimal PodstawaEmerytalnaRentowa, decimal PodstawaChorobowa,
        decimal PodstawaWypadkowa, decimal PodstawaZdrowotna,
        decimal StopaWypadkowa,
        Dochod? DochodInfo);

    public static string Zbuduj(Dane d)
    {
        var (rok, mies) = RozbijOkres(d.Okres);
        var nip = Cyfry(d.Platnik.Nip);
        if (nip.Length != 10) throw new ArgumentException("NIP płatnika musi mieć 10 cyfr.");
        var kod4 = new string([.. d.KodTytulu.Where(char.IsDigit)]);
        if (kod4.Length != 4) throw new ArgumentException("Kod tytułu: np. „05 40”.");
        var f = d.Skladki;
        var emer = R(f.Emerytalne); var rent = R(f.Rentowe);
        var chor = R(f.Chorobowe); var wyp = R(f.Wypadkowe);
        var zdr = R(f.Zdrowotna); var fp = R(f.Fp);
        var spoleczne = R(emer + rent + chor + wyp);
        var razem = R(spoleczne + zdr + fp);

        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.Append($"<KEDU xmlns=\"{NsKedu}\" wersja_schematu=\"1\">\n");
        sb.Append("  <naglowek.KEDU>\n    <program>\n");
        sb.Append("      <producent>Frank-JDG</producent>\n      <symbol>FRANK</symbol>\n      <wersja>1.0</wersja>\n");
        sb.Append("    </program>\n  </naglowek.KEDU>\n");
        sb.Append("  <ZUSDRA id_dokumentu=\"1\">\n");
        // I. Dane organizacyjne
        sb.Append("    <I>\n");
        sb.Append("      <p1>1</p1>\n");
        sb.Append($"      <p2><p1>01</p1><p2>{rok}-{mies}</p2></p2>\n");
        sb.Append("    </I>\n");
        // II. Płatnik
        sb.Append("    <II>\n");
        sb.Append($"      <p1>{nip}</p1>\n");
        var regon = Cyfry(d.Platnik.Regon ?? "");
        if (regon is { Length: 9 } or { Length: 14 }) sb.Append($"      <p2>{regon}</p2>\n");
        sb.Append($"      <p6>{E(Skroc(d.Platnik.NazwaSkrocona, 31))}</p6>\n");
        if (!string.IsNullOrWhiteSpace(d.Platnik.Nazwisko))
            sb.Append($"      <p7>{E(Skroc(d.Platnik.Nazwisko!, 31))}</p7>\n");
        if (!string.IsNullOrWhiteSpace(d.Platnik.Imie))
            sb.Append($"      <p8>{E(Skroc(d.Platnik.Imie!, 22))}</p8>\n");
        sb.Append("    </II>\n");
        // III. Inne informacje
        sb.Append("    <III>\n      <p1>1</p1>\n");
        sb.Append($"      <p3>{d.StopaWypadkowa.ToString("0.00", CultureInfo.InvariantCulture)}</p3>\n");
        sb.Append("    </III>\n");
        // IV. Składki społeczne (finansowane przez płatnika — JDG sam za siebie)
        var er = R(emer + rent);
        sb.Append("    <IV>\n");
        Kw(sb, "p1", emer); Kw(sb, "p2", rent); Kw(sb, "p3", er);
        Kw(sb, "p7", emer); Kw(sb, "p8", rent); Kw(sb, "p9", er);
        Kw(sb, "p19", chor); Kw(sb, "p20", wyp); Kw(sb, "p21", R(chor + wyp));
        Kw(sb, "p25", chor); Kw(sb, "p26", wyp); Kw(sb, "p27", R(chor + wyp));
        Kw(sb, "p37", spoleczne);
        sb.Append("    </IV>\n");
        // VI. Zdrowotna
        sb.Append("    <VI>\n");
        Kw(sb, "p1", zdr); Kw(sb, "p5", zdr); Kw(sb, "p7", zdr);
        sb.Append("    </VI>\n");
        // VII. FP/FS
        sb.Append("    <VII>\n");
        Kw(sb, "p1", fp); Kw(sb, "p3", fp);
        sb.Append("    </VII>\n");
        // IX. Do zwrotu/zapłaty
        sb.Append("    <IX>\n");
        Kw(sb, "p1", 0); Kw(sb, "p2", razem);
        sb.Append("    </IX>\n");
        // X. Deklaracja dochodu
        sb.Append("    <X>\n");
        sb.Append($"      <p1><p1>{kod4}</p1><p2>0</p2><p3>0</p3></p1>\n");
        Kw(sb, "p2", d.PodstawaEmerytalnaRentowa);
        Kw(sb, "p3", d.PodstawaChorobowa);
        Kw(sb, "p4", d.PodstawaWypadkowa);
        Kw(sb, "p5", d.PodstawaZdrowotna);
        sb.Append("    </X>\n");
        // XI. Forma opodatkowania (zdrowotna)
        if (d.DochodInfo is { } di)
        {
            sb.Append("    <XI>\n");
            switch (di.FormaOpodatkowania)
            {
                case "liniowy":
                    B(sb, "p5", true); Kw(sb, "p6", di.DochodPoprzedniMiesiac);
                    Kw(sb, "p7", di.PodstawaZdrowotna); Kw(sb, "p8", zdr); break;
                case "ryczalt":
                    B(sb, "p12", true); Kw(sb, "p13", di.PrzychodYtd);
                    B(sb, "p14", false);
                    Kw(sb, "p16", di.PodstawaZdrowotna); Kw(sb, "p17", zdr); break;
                default:
                    B(sb, "p1", true); Kw(sb, "p2", di.DochodPoprzedniMiesiac);
                    Kw(sb, "p3", di.PodstawaZdrowotna); Kw(sb, "p4", zdr); break;
            }
            sb.Append("    </XI>\n");
        }
        sb.Append("  </ZUSDRA>\n</KEDU>");
        return sb.ToString();
    }

    /// Proponowany podział składki społecznej na fundusze wg stóp ustawowych
    /// (em. 19,52% / rent. 8% / chor. 2,45% dobrowolnie / wypad. 1,67%)
    /// od podstawy wg schematu. Do weryfikacji przed importem.
    public static Fundusze ProponujPodzial(decimal podstawa, bool chorobowe, decimal zdrowotna, decimal fp,
        decimal stopaWypadkowa = 1.67m)
    {
        if (podstawa <= 0) return new Fundusze(0, 0, 0, 0, R(zdrowotna), R(fp));
        return new Fundusze(
            R(podstawa * 0.1952m), R(podstawa * 0.08m),
            R(chorobowe ? podstawa * 0.0245m : 0m),
            R(podstawa * stopaWypadkowa / 100m),
            R(zdrowotna), R(fp));

        static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }

    private static void Kw(StringBuilder sb, string p, decimal v) =>
        sb.Append($"      <{p}>{R(v).ToString("0.00", CultureInfo.InvariantCulture)}</{p}>\n");

    private static void B(StringBuilder sb, string p, bool v) =>
        sb.Append($"      <{p}>{(v ? "true" : "false")}</{p}>\n");

    private static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    private static (string Rok, string Mies) RozbijOkres(string okres)
    {
        var m = System.Text.RegularExpressions.Regex.Match(okres.Trim(), @"^(\d{4})-(\d{2})$");
        if (!m.Success) throw new ArgumentException("Okres RRRR-MM.");
        return (m.Groups[1].Value, m.Groups[2].Value);
    }

    private static string Cyfry(string? s) => new([.. (s ?? "").Where(char.IsDigit)]);

    private static string Skroc(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? "-" : s.Trim().Length <= max ? s.Trim() : s.Trim()[..max];

    private static string E(string? s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";

    public sealed record Walidacja(bool Ok, List<string> Bledy, bool Pominieta);

    public static Walidacja Waliduj(string xml, string schemasDir)
    {
        var w = XsdWalidator.Waliduj(xml, "kedu_5_6.xsd", schemasDir);
        return new Walidacja(w.Ok, w.Bledy, w.Pominieta);
    }
}
