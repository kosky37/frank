using System.Net;
using System.Xml;

namespace Frank.Api.Services;

// Lokalna walidacja XSD z mapowaniem zdalnych importów (crd.gov.pl, w3.org)
// na pliki w katalogu Schemas — pełna weryfikacja offline, bez modyfikacji
// urzędowych schematów.
public static class XsdWalidator
{
    private sealed class LokalnyResolver(string schemasDir) : XmlResolver
    {
        private static readonly Dictionary<string, string> Mapa = new()
        {
            ["http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2023/09/06/eD/KodyKrajow/KodyKrajow_v13-0E.xsd"] = "KodyKrajow_v13-0E.xsd",
            ["http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/KodyUrzedowSkarbowych/KodyUrzedowSkarbowych_v8-0E.xsd"] = "KodyUrzedowSkarbowych_v8-0E.xsd",
            ["http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/StrukturyDanych_v12-0E.xsd"] = "StrukturyDanych_v12-0E.xsd",
            ["http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/StrukturyDanych_v10-0E.xsd"] = "StrukturyDanych_v10-0E.xsd",
            ["http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"] = "xmldsig-core-schema.xsd",
        };

        public override object? GetEntity(Uri absoluteUri, string? role, Type? ofObjectToReturn)
        {
            if (Mapa.TryGetValue(absoluteUri.AbsoluteUri, out var plik))
            {
                var sciezka = Path.Combine(schemasDir, plik);
                if (File.Exists(sciezka)) return File.OpenRead(sciezka);
            }
            // awaryjnie: basename z katalogu Schemas
            var awaryjna = Path.Combine(schemasDir, absoluteUri.Segments.Last());
            if (File.Exists(awaryjna)) return File.OpenRead(awaryjna);
            throw new FileNotFoundException($"Brak lokalnego schematu dla {absoluteUri} (offline).");
        }

        public override ICredentials? Credentials { set { } }
    }

    public sealed record Wynik(bool Ok, List<string> Bledy, bool Pominieta);

    public static Wynik Waliduj(string xml, string nazwaXsd, string schemasDir)
    {
        var bledy = new List<string>();
        var xsd = Path.Combine(schemasDir, nazwaXsd);
        if (!File.Exists(xsd))
            return new Wynik(false, [$"Brak pliku XSD {nazwaXsd} w backendzie."], true);
        try
        {
            var settings = new System.Xml.XmlReaderSettings
            {
                ValidationType = System.Xml.ValidationType.Schema,
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = new LokalnyResolver(schemasDir),
            };
            settings.Schemas.XmlResolver = new LokalnyResolver(schemasDir);
            // Uzupełnienie brakujących typów bazowych etd 2022/01/05 (dla FA(3)):
            // XmlSchemaSet łączy schematy tej samej przestrzeni nazw.
            var uzup = Path.Combine(schemasDir, "etd-2022-01-05-brakujace.xsd");
            if (File.Exists(uzup))
                settings.Schemas.Add(
                    "http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/", uzup);
            settings.Schemas.Add(null, xsd);
            settings.ValidationEventHandler += (_, e) => bledy.Add($"{e.Severity}: {e.Message}");
            using var reader = XmlReader.Create(new StringReader(xml), settings);
            while (reader.Read()) { }
        }
        catch (Exception ex)
        {
            return new Wynik(bledy.Count == 0, [.. bledy, $"Uwaga walidacji: {ex.Message}"], true);
        }
        return new Wynik(bledy.Count == 0, bledy, false);
    }
}
