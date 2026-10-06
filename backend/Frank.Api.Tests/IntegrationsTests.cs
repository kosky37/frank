using System.Security.Cryptography;
using System.Xml.Linq;
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
    public void Fa3_WalidacjaXsd_Przechodzi()
    {
        var wal = Fa3Builder.Waliduj(Fa3Builder.Zbuduj(PrzykladFa()), SchemasDir());
        Assert.True(wal.Ok, "XSD: " + string.Join("; ", wal.Bledy.Take(5)));
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
