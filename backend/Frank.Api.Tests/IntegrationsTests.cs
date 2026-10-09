using System.Security.Cryptography;
using System.Xml.Linq;
using Frank.Api.Endpoints;
using Frank.Api.Services;

namespace Frank.Api.Tests;

// Integracje rządowe: FA(3), JPK_V7M(3)/V7K(3), KEDU 5.6, kryptografia bramek.
public sealed class IntegrationsTests
{
    private static Fa3Builder.Dane PrzykladFa() => new(
        "5260000000", "Jan Kowalski", "ul. Testowa 1, 00-001 Warszawa",
        "5250000000", "Acme Sp. z o.o.", "ul. Biznesowa 2, 00-002 Warszawa",
        "1/10/2026", "2026-10-05", "2026-10-05",
        [new Fa3Builder.Pozycja("Usługi programistyczne 10/2026", 1, 20000m, "23")]);

    [Fact]
    public void Fa3_ZawieraWymaganeElementyWKolejnosci()
    {
        var xml = Fa3Builder.Zbuduj(PrzykladFa());
        var doc = XDocument.Parse(xml);
        Assert.Equal("http://crd.gov.pl/wzor/2025/06/25/13775/", doc.Root!.Name.NamespaceName);
        Assert.Contains("kodSystemowy=\"FA (3)\"", xml);
        Assert.Contains("<P_2>1/10/2026</P_2>", xml);
        Assert.Contains("<P_13_1>20000.00</P_13_1>", xml);
        Assert.Contains("<P_14_1>4600.00</P_14_1>", xml);
        Assert.Contains("<P_15>24600.00</P_15>", xml);
        Assert.Contains("<JST>2</JST>", xml);
        Assert.Contains("<RodzajFaktury>VAT</RodzajFaktury>", xml);
        // kolejność w FaWiersz: P_7 < P_11 < P_12
        var i7 = xml.IndexOf("<P_7>", StringComparison.Ordinal);
        var i11 = xml.IndexOf("<P_11>", StringComparison.Ordinal);
        var i12 = xml.IndexOf("<P_12>", StringComparison.Ordinal);
        Assert.True(i7 > 0 && i7 < i11 && i11 < i12);
    }

    [Fact]
    public void Mikrorachunek_StrukturaMf_Y2Nip()
    {
        var r = MockIntegrations.Mikrorachunek("5260250274");
        Assert.Equal(28, r.Length);
        Assert.Equal("10100071222", r.Substring(4, 11));
        Assert.Equal("2526025027400", r[15..]);
        var przestawiony = r[4..] + "2521" + r[2..4];
        var rest = 0;
        foreach (var ch in przestawiony) rest = (rest * 10 + (ch - '0')) % 97;
        Assert.Equal(1, rest);
    }

    [Fact]
    public void Fa3_WalidacjaXsd_Przechodzi()
    {
        var wal = Fa3Builder.Waliduj(Fa3Builder.Zbuduj(PrzykladFa()), SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void Fa3_MppTylkoDlaZal15()
    {
        var bezZal15 = Fa3Builder.Zbuduj(PrzykladFa());
        Assert.Contains("<P_18A>2</P_18A>", bezZal15);
        var zZal15 = Fa3Builder.Zbuduj(PrzykladFa() with { Zal15 = true });
        Assert.Contains("<P_18A>1</P_18A>", zZal15);
    }

    [Fact]
    public void Fa3_KorektaWalutaUePlatnosc_WalidacjaXsd()
    {
        var korekta = PrzykladFa() with
        {
            Numer = "2/10/2026",
            Pozycje = [new Fa3Builder.Pozycja("Korekta usług 10/2026", -1, 20000m, "23")],
            Koryguje = new Fa3Builder.Korekta("1/10/2026", "2026-10-05", null, "Zwrot całości"),
            TerminPlatnosci = "2026-10-19",
            RachunekBankowy = "PL61 1090 1014 0000 0712 1981 2874",
        };
        var xmlK = Fa3Builder.Zbuduj(korekta);
        Assert.Contains("<RodzajFaktury>KOR</RodzajFaktury>", xmlK);
        Assert.Contains("<NrKSeFN>1</NrKSeFN>", xmlK);
        Assert.Contains("<P_13_1>-20000.00</P_13_1>", xmlK);
        Assert.Contains("<NrRB>PL61109010140000071219812874</NrRB>", xmlK);
        var walK = Fa3Builder.Waliduj(xmlK, SchemasDir());
        Assert.True(walK.Ok, "XSD korekta: " + string.Join("; ", walK.Bledy.Take(5)));

        var ue = PrzykladFa() with
        {
            NipNabywcy = "DE123456789", AdresNabywcy = "Hauptstr. 1, Berlin",
            Pozycje = [new Fa3Builder.Pozycja("Software development", 1, 5000m, "np")],
            Waluta = "EUR", KursNbp = 4.3m,
        };
        var xmlU = Fa3Builder.Zbuduj(ue);
        Assert.Contains("<KodUE>DE</KodUE>", xmlU);
        Assert.Contains("<NrVatUE>123456789</NrVatUE>", xmlU);
        Assert.Contains("<KodKraju>DE</KodKraju>", xmlU);
        var walU = Fa3Builder.Waliduj(xmlU, SchemasDir());
        Assert.True(walU.Ok, "XSD UE: " + string.Join("; ", walU.Bledy.Take(5)));

        var eur23 = PrzykladFa() with { Waluta = "EUR", KursNbp = 4.3m };
        var xmlE = Fa3Builder.Zbuduj(eur23);
        Assert.Contains("<P_14_1W>19780.00</P_14_1W>", xmlE);
        var walE = Fa3Builder.Waliduj(xmlE, SchemasDir());
        Assert.True(walE.Ok, "XSD EUR: " + string.Join("; ", walE.Bledy.Take(5)));
    }

    [Fact]
    public void JpkV7M_KorektaUjemnaIKontrahentUe_WalidacjaXsd()
    {
        var s = new List<JpkV7Builder.WierszS>
        {
            new("5250000000", "Acme", "2/10/2026", "2026-10-05", "2026-10-05", null,
                0, 0, 0, 0, 0, 0, 0, -1000m, -230m, 0, 0, 0),
            new("DE123456789", "GmbH", "3/10/2026", "2026-10-06", "2026-10-06", null,
                0, 21500m, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        };
        var xml = JpkV7Builder.ZbudujV7M("2026", "10", s, [], Podmiot());
        Assert.Contains("<K_19>-1000.00</K_19>", xml);
        Assert.Contains("<KodKrajuNadaniaTIN>DE</KodKrajuNadaniaTIN>", xml);
        var wal = JpkV7Builder.Waliduj(xml, false, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void JpkV7_NaglowekMiesiacBezZera_DataZeStrefa_NrKsefWgPrzykladuMf()
    {
        // Przykład MF: <Miesiac>3</Miesiac> (nie 03),
        // <DataWytworzeniaJPK>2026-05-13T17:57:05.9611902+02:00</DataWytworzeniaJPK>,
        // <NrKSeF>1010000000-20200101-000000000000-00</NrKSeF>.
        var s = new List<JpkV7Builder.WierszS>
        {
            new("5250000000", "Acme", "1/03/2026", "2026-03-05", "2026-03-05",
                "1010000000-20200101-000000000000-00",
                0, 0, 0, 0, 0, 0, 0, 20000m, 4600m, 0, 0, 0),
        };
        var z = new List<JpkV7Builder.WierszZ>
        {
            new("5260000001", "Orlen", "FV/1", "2026-03-10",
                "1010000000-20200101-000000000000-00", 1000m, 230m),
        };
        var xmlM = JpkV7Builder.ZbudujV7M("2026", "03", s, z, Podmiot());
        Assert.Contains("<Miesiac>3</Miesiac>", xmlM);
        Assert.DoesNotContain("<Miesiac>03</Miesiac>", xmlM);
        Assert.Contains("<NrKSeF>1010000000-20200101-000000000000-00</NrKSeF>", xmlM);
        Assert.Matches(
            new System.Text.RegularExpressions.Regex(@"<DataWytworzeniaJPK>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)</DataWytworzeniaJPK>"),
            xmlM);
        var walM = JpkV7Builder.Waliduj(xmlM, false, SchemasDir());
        Assert.True(walM.Ok, "XSD V7M: " + string.Join("; ", walM.Bledy.Take(5)));

        // V7K: ostatni miesiąc kwartału też bez zera ("03", nie "03" z prefiksem).
        var xmlK = JpkV7Builder.ZbudujV7K("2026", 1, "03", s, z, Podmiot());
        Assert.Contains("<Miesiac>3</Miesiac>", xmlK);
        Assert.Contains("<NrKSeF>1010000000-20200101-000000000000-00</NrKSeF>", xmlK);
        var walK = JpkV7Builder.Waliduj(xmlK, true, SchemasDir());
        Assert.True(walK.Ok, "XSD V7K: " + string.Join("; ", walK.Bledy.Take(5)));
    }

    [Fact]
    public void JpkV7_NrKsef_MaleLiteryNormalizowane_FalszyweDoBfk()
    {
        Assert.True(JpkV7Builder.CzyNrKsef("5250000000-20261005-a1b2c3-d4e5f6-78"));
        Assert.False(JpkV7Builder.CzyNrKsef("KSEF-123"));
        Assert.False(JpkV7Builder.CzyNrKsef(null));
        Assert.False(JpkV7Builder.CzyNrKsef(""));
        var s = new List<JpkV7Builder.WierszS>
        {
            new("5250000000", "Acme", "1/10/2026", "2026-10-05", "2026-10-05",
                "5250000000-20261005-a1b2c3-d4e5f6-78",
                0, 0, 0, 0, 0, 0, 0, 1000m, 230m, 0, 0, 0),
            new("5250000000", "Acme", "2/10/2026", "2026-10-06", "2026-10-06",
                "KSEF-mock",
                0, 0, 0, 0, 0, 0, 0, 1000m, 230m, 0, 0, 0),
        };
        var xml = JpkV7Builder.ZbudujV7M("2026", "10", s, [], Podmiot());
        // mały hex → wielkie litery w <NrKSeF> (XSD wymaga A-F), mock → <BFK>.
        Assert.Contains("<NrKSeF>5250000000-20261005-A1B2C3-D4E5F6-78</NrKSeF>", xml);
        Assert.Contains("<BFK>1</BFK>", xml);
        var wal = JpkV7Builder.Waliduj(xml, false, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void JpkV7_DataWytworzenia_WStrefiePolski()
    {
        // Kontener chodzi na UTC — DataWytworzeniaJPK ma być w czasie polskim (+01/+02), nie +00:00 ani Z.
        var xml = JpkV7Builder.ZbudujV7M("2026", "10", [], [], Podmiot());
        Assert.Matches(
            new System.Text.RegularExpressions.Regex(@"<DataWytworzeniaJPK>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-](01|02):00</DataWytworzeniaJPK>"),
            xml);
        var wal = JpkV7Builder.Waliduj(xml, false, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void UrzedySkarbowe_ZSlownikaMf_WyszukiwaniePoMiescieBezZnakow()
    {
        var wszystkie = Frank.Api.Reference.UrzedySkarbowe.Wszystkie(SchemasDir());
        Assert.True(wszystkie.Count >= 350, $"Oczekiwano ~400 urzędów, jest {wszystkie.Count}");
        var wawa = Frank.Api.Reference.UrzedySkarbowe.Szukaj(SchemasDir(), "warszawa");
        Assert.NotEmpty(wawa);
        Assert.All(wawa, u => Assert.Matches(@"^\d{4}$", u.Kod));
        // bez polskich znaków też znajduje: "lodz" → ŁÓDŹ, "wroclaw" → WROCŁAW
        Assert.Contains(Frank.Api.Reference.UrzedySkarbowe.Szukaj(SchemasDir(), "lodz"),
            u => u.Nazwa.Contains("ŁÓDZ") || u.Nazwa.Contains("LODZ"));
        Assert.Contains(Frank.Api.Reference.UrzedySkarbowe.Szukaj(SchemasDir(), "wroclaw"),
            u => u.Nazwa.Contains("WROC"));
        // po kodzie
        var poKodzie = Frank.Api.Reference.UrzedySkarbowe.Szukaj(SchemasDir(), "1435");
        Assert.Contains(poKodzie, u => u.Kod == "1435");
    }

    [Fact]
    public void UrzedySkarbowe_PustaFrazaZwracaWszystkie_WaRankujeWarszawe()
    {
        // Regresja: limit 100 odcinał urzędy z wysokimi kodami (Warszawa 1431+ spoza listy).
        var wszystkie = Frank.Api.Reference.UrzedySkarbowe.Wszystkie(SchemasDir());
        var bezFrazy = Frank.Api.Reference.UrzedySkarbowe.Szukaj(SchemasDir(), "");
        Assert.Equal(wszystkie.Count, bezFrazy.Count);
        Assert.Contains(bezFrazy, u => u.Kod == "1431");
        // Ranking pozycją, nie kolejnością pliku: "wa" → WARSZAWA w top 12.
        var wa = Frank.Api.Reference.UrzedySkarbowe.Szukaj(SchemasDir(), "wa");
        Assert.Contains(wa.Take(12), u => u.Kod == "1431");
    }

    [Fact]
    public void JpkEndpoints_WytnijKsef_ZnajdujeNumerZeSpacja()
    {
        // Frontend zapisuje "Import z KSeF (nr)" ZE spacją — stary Contains("KSeF(") to gubił (→ BFK zamiast NrKSeF).
        const string nr = "1010000000-20200101-000000000000-00";
        Assert.Equal(nr, JpkEndpoints.WytnijKsef($"Import z KSeF ({nr})"));
        Assert.Equal(nr, JpkEndpoints.WytnijKsef($"Import z KSeF({nr})"));
        Assert.Null(JpkEndpoints.WytnijKsef("paliwo — mix 50% VAT / 75% PIT"));
        // Numer z opisu trafia do <NrKSeF> w ZakupWiersz (kolumna KsefId ma pierwszeństwo, tu via Opis-fallback).
        var z = new List<JpkV7Builder.WierszZ> { new("5260000001", "Orlen", "FV/1", "2026-03-10", nr, 1000m, 230m) };
        var xml = JpkV7Builder.ZbudujV7M("2026", "3", [], z, Podmiot());
        Assert.Contains($"<NrKSeF>{nr}</NrKSeF>", xml);
        var wal = JpkV7Builder.Waliduj(xml, false, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void JpkV7_NormalizujMiesiac_OdrzucaSpozaZakresu()
    {
        Assert.Equal("3", JpkV7Builder.NormalizujMiesiac("03"));
        Assert.Equal("3", JpkV7Builder.NormalizujMiesiac("3"));
        Assert.Equal("12", JpkV7Builder.NormalizujMiesiac("12"));
        Assert.Throws<ArgumentException>(() => JpkV7Builder.NormalizujMiesiac("0"));
        Assert.Throws<ArgumentException>(() => JpkV7Builder.NormalizujMiesiac("13"));
        Assert.Throws<ArgumentException>(() => JpkV7Builder.NormalizujMiesiac("x"));
    }

    [Fact]
    public void Fa3_OdrzucaZlaStawkeIBrakPozycji()
    {
        Assert.Throws<ArgumentException>(() => Fa3Builder.Zbuduj(PrzykladFa() with
        {
            Pozycje = [],
        }));
        Assert.Throws<ArgumentException>(() => Fa3Builder.Zbuduj(PrzykladFa() with
        {
            Pozycje = [new Fa3Builder.Pozycja("x", 1, 100m, "42")],
        }));
    }

    private static JpkV7Builder.Podmiot Podmiot() => new(
        "5260000000", "Jan Kowalski", "jan@example.com", true,
        "Jan", "Kowalski", "1990-01-01", null, "1215");

    [Fact]
    public void JpkV7M_BudujeSieIZawieraDeklaracjeVat7()
    {
        var s = new List<JpkV7Builder.WierszS>
        {
            new("5250000000", "Acme", "1/10/2026", "2026-10-05", "2026-10-05", null,
                0, 0, 0, 0, 0, 0, 0, 20000m, 4600m, 0, 0, 0),
        };
        var z = new List<JpkV7Builder.WierszZ>
        {
            new("5260000001", "Orlen", "FV/1", "2026-10-10", null, 1000m, 230m),
        };
        var xml = JpkV7Builder.ZbudujV7M("2026", "10", s, z, Podmiot());
        var doc = XDocument.Parse(xml);
        Assert.Equal("http://crd.gov.pl/wzor/2025/12/19/14090/", doc.Root!.Name.NamespaceName);
        Assert.Contains("kodSystemowy=\"JPK_V7M (3)\"", xml);
        Assert.Contains("<P_38>460000</P_38>", xml);
        Assert.Contains("<P_43>23000</P_43>", xml);
        Assert.Contains("<P_51>437000</P_51>", xml);
        Assert.Contains("<Pouczenia>1</Pouczenia>", xml);
    }

    [Fact]
    public void JpkV7M_WalidacjaXsd_Przechodzi()
    {
        var s = new List<JpkV7Builder.WierszS>
        {
            new("5250000000", "Acme", "1/10/2026", "2026-10-05", "2026-10-05", "5250000000-20261005-A1B2C3-D4E5F6-78",
                0, 0, 0, 0, 0, 0, 0, 20000m, 4600m, 0, 0, 0),
        };
        var xml = JpkV7Builder.ZbudujV7M("2026", "10", s, [], Podmiot());
        var wal = JpkV7Builder.Waliduj(xml, false, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void JpkV7M_WalidacjaXsd_WykrywaBledy()
    {
        var xml = JpkV7Builder.ZbudujV7M("2026", "10", [], [], Podmiot());
        var zly = xml.Replace("<P_38>", "<P_38_X>");
        var wal = JpkV7Builder.Waliduj(zly, false, SchemasDir());
        // gdy brak sieci do zdalnych importów XSD walidacja jest oznaczona jako pominięta
        Assert.True(wal.Pominieta || !wal.Ok, "Uszkodzony XML przeszedł walidację XSD.");
    }

    [Fact]
    public void JpkV7K_BudujeSieZVat7K()
    {
        var xml = JpkV7Builder.ZbudujV7K("2026", 4, "12", [], [], Podmiot());
        var doc = XDocument.Parse(xml);
        Assert.Equal("http://crd.gov.pl/wzor/2025/12/19/14089/", doc.Root!.Name.NamespaceName);
        Assert.Contains("kodSystemowy=\"JPK_V7K (3)\"", xml);
        Assert.Contains("kodSystemowy=\"VAT-7K (17)\"", xml);
        Assert.Contains("<Kwartal>4</Kwartal>", xml);
        var wal = JpkV7Builder.Waliduj(xml, true, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void Kedu_BudujeDRA()
    {
        var xml = ZusKeduBuilder.Zbuduj(new ZusKeduBuilder.Dane(
            "2026-10",
            new ZusKeduBuilder.Platnik("5260000000", null, "JAN KOWALSKI", "Kowalski", "Jan"),
            new ZusKeduBuilder.Fundusze(1103.27m, 452.16m, 138.47m, 94.39m, 432.54m, 138.47m),
            "05 10", 5652m, 5652m, 5652m, 4806m, 1.67m,
            new ZusKeduBuilder.Dochod("liniowy", 15000m, 4806m, 0m)));
        var doc = XDocument.Parse(xml);
        Assert.Equal("http://www.zus.pl/2024/KEDU_5_6", doc.Root!.Name.NamespaceName);
        Assert.Contains("<ZUSDRA id_dokumentu=\"1\">", xml);
        Assert.Contains("<p37>1788.29</p37>", xml); // IV: suma społecznych do przekazania
        Assert.Contains("<p3>138.47</p3>", xml); // VII: FP do zapłaty
        var wal = ZusKeduBuilder.Waliduj(xml, SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
    }

    [Fact]
    public void Kedu_ProponujePodzial()
    {
        var f = ZusKeduBuilder.ProponujPodzial(5652m, true, 432.54m, 138.47m);
        Assert.Equal(1103.27m, f.Emerytalne);
        Assert.Equal(452.16m, f.Rentowe);
        Assert.Equal(138.47m, f.Chorobowe);
        Assert.Equal(94.39m, f.Wypadkowe);
    }

    [Fact]
    public void AuthData_MaWymaganePola()
    {
        var xml = JpkGateway.ZbudujAuthData(new JpkGateway.DaneAutoryzujace(
            "5260000000", "Jan", "Kowalski", "1990-01-01", 123456.78m));
        Assert.Contains("<NIP>5260000000</NIP>", xml);
        Assert.Contains("<Kwota>123456.78</Kwota>", xml);
        Assert.Throws<ArgumentException>(() => JpkGateway.ZbudujAuthData(
            new JpkGateway.DaneAutoryzujace("123", "Jan", "Kowalski", "1990-01-01", 0)));
    }

    [Fact]
    public void Krypto_AesRoundtrip_RsaZCertyfikatemMF()
    {
        var key = GovCrypto.RandomBytes(32);
        var plain = new byte[] { 1, 2, 3, 4, 5 };
        var (c, iv) = GovCrypto.Aes256CbcEncrypt(plain, key);
        Assert.Equal(plain, GovCrypto.Aes256CbcDecrypt(c, key, iv));

        var pem = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory, "..", "..", "..", "..", "Frank.Api", "Keys", "jpk-test.pem"));
        Assert.True(File.Exists(pem), "Brak klucza testowego MF: " + pem);
        using var rsa = GovCrypto.PublicRsaFromCertPem(pem);
        var enc = GovCrypto.RsaPkcs1Encrypt(key, rsa);
        Assert.Equal(256, enc.Length); // RSA-2048
    }

    private static string SchemasDir()
    {
        var a = Path.Combine(AppContext.BaseDirectory, "Schemas");
        if (Directory.Exists(a)) return a;
        return Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory, "..", "..", "..", "..", "Frank.Api", "Schemas"));
    }
}
