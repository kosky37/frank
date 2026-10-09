using System.Globalization;
using System.Text;
using System.Xml.Linq;

namespace Frank.Api.Reference;

// Urzędy skarbowe z urzędowego słownika MF (KodyUrzedowSkarbowych_v8-0E.xsd,
// ten sam plik, którym XSD waliduje <KodUrzedu> w JPK). Wyszukiwanie po nazwie /
// mieście / kodzie, bez znajomości numeru — do podpowiedzi w Ustawieniach i JPK.
public sealed record UrzadSkarbowy(string Kod, string Nazwa);

public static class UrzedySkarbowe
{
    private static readonly object Sync = new();
    private static string? _katalog;
    private static List<UrzadSkarbowy> _lista = [];

    public static List<UrzadSkarbowy> Wszystkie(string schemasDir)
    {
        lock (Sync)
        {
            if (_katalog != schemasDir || _lista.Count == 0)
            {
                _lista = Wczytaj(schemasDir);
                _katalog = schemasDir;
            }
            return _lista;
        }
    }

    public static List<UrzadSkarbowy> Szukaj(string schemasDir, string? q, int limit = 100)
    {
        var wszystkie = Wszystkie(schemasDir);
        // Puste q = pełna lista (UI filtruje lokalnie; ~400 wpisów to ~30 kB).
        // Limit 100 odcinałby urzędy z wysokimi kodami (np. cała Warszawa 1431+).
        if (string.IsNullOrWhiteSpace(q)) return wszystkie;
        var nq = Fold(q.Trim());
        return wszystkie
            .Select(u => (U: u, R: Ranga(u, nq)))
            .Where(x => x.R < int.MaxValue)
            .OrderBy(x => x.R)
            .ThenBy(x => x.U.Kod, StringComparer.Ordinal)
            .Take(limit)
            .Select(x => x.U)
            .ToList();
    }

    /// Trafienie kodem od początku zawsze pierwsze; w nazwie wygrywa wcześniejsza pozycja
    /// (np. "wa" → WARSZAWA przed WAŁBRZYCHEM i WĄBRZEŹNEM).
    private static int Ranga(UrzadSkarbowy u, string nq)
    {
        if (u.Kod.ToLowerInvariant().StartsWith(nq, StringComparison.Ordinal)) return 0;
        var idx = Fold(u.Nazwa).IndexOf(nq, StringComparison.Ordinal);
        return idx < 0 ? int.MaxValue : 1000 + idx;
    }

    private static List<UrzadSkarbowy> Wczytaj(string schemasDir)
    {
        var sciezka = Path.Combine(schemasDir, "KodyUrzedowSkarbowych_v8-0E.xsd");
        XNamespace xsd = "http://www.w3.org/2001/XMLSchema";
        var doc = XDocument.Load(sciezka);
        return doc.Descendants(xsd + "enumeration")
            .Select(e => new UrzadSkarbowy(
                ((string?)e.Attribute("value") ?? "").Trim(),
                (e.Element(xsd + "annotation")?.Element(xsd + "documentation")?.Value ?? "").Trim()))
            .Where(u => u.Kod.Length == 4 && u.Nazwa.Length > 0)
            .ToList();
    }

    /// Porównanie bez polskich znaków: "lodz" znajdzie "ŁÓDŹ", "wroclaw" → "WROCŁAW".
    /// Ł/ł nie rozkłada FormD, więc zamiana jawna przed normalizacją.
    public static string Fold(string s)
    {
        var f = s.Replace('Ł', 'L').Replace('ł', 'l').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(f.Length);
        foreach (var ch in f)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        return sb.ToString().ToLowerInvariant();
    }
}
