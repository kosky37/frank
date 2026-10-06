using System.Text.Json;
using Frank.Api.Services;

namespace Frank.Api.Tests;

// Parsery rejestrów na prawdziwych kształtach (Biała Lista + KRS OdpisAktualny).
public sealed class RejestryParseTests
{
    private const string WlOk = """
        {"result": {"requestId": "abc", "subject": {
          "name": "ORLEN SPÓŁKA AKCYJNA", "nip": "7740001454", "statusVat": "Czynny",
          "regon": "610188201", "krs": "0000028860",
          "residenceAddress": null, "workingAddress": "CHEMIKÓW 7, 09-411 PŁOCK",
          "registrationLegalDate": "1993-07-05"}}}
        """;

    private const string WlException = """
        {"exception": {"code": "WL-101", "message": "Nieprawidłowy NIP"}}
        """;

    private const string KrsOdpis = """
        {"odpis": {"rodzaj": "Aktualny", "dane": {"dzial1": {"siedzibaIAdres": {
          "adres": {"ulica": "CHEMIKÓW", "nrDomu": "7", "miejscowosc": "PŁOCK",
            "kodPocztowy": "09-411", "poczta": "PŁOCK", "kraj": "POLSKA"},
          "adresPocztyElektronicznej": "ZARZAD@ORLEN.PL"}},
          "dzial3": {"przedmiotDzialalnosci": {
            "przedmiotPrzewazajacejDzialalnosci": [
              {"opis": "WYTWARZANIE PALIW", "kodDzial": "19", "kodKlasa": "20", "kodPodklasa": "Z"}],
            "przedmiotPozostalejDzialalnosci": [
              {"opis": "MAGAZYNOWANIE", "kodDzial": "52", "kodKlasa": "10"},
              {"opis": "WYTWARZANIE PALIW", "kodDzial": "19", "kodKlasa": "20", "kodPodklasa": "Z"}]}}}}}
        """;

    [Fact]
    public void BialaLista_Podmiot()
    {
        using var doc = JsonDocument.Parse(WlOk);
        var p = RejestryParsers.ParseBialaLista(doc.RootElement);
        Assert.NotNull(p);
        Assert.Equal("ORLEN SPÓŁKA AKCYJNA", p.Nazwa);
        Assert.Equal("7740001454", p.Nip);
        Assert.Equal("Czynny", p.StatusVat);
        Assert.Equal("610188201", p.Regon);
        Assert.Equal("0000028860", p.Krs);
        Assert.Equal("CHEMIKÓW 7, 09-411 PŁOCK", p.Adres);
        Assert.Equal(["biala-lista"], p.Zrodla);
    }

    [Fact]
    public void BialaLista_Wyjatek_Null()
    {
        using var doc = JsonDocument.Parse(WlException);
        Assert.Null(RejestryParsers.ParseBialaLista(doc.RootElement));
    }

    [Fact]
    public void Krs_Odpis_AdresEmailPkd()
    {
        using var doc = JsonDocument.Parse(KrsOdpis);
        var (adres, email, pkd) = RejestryParsers.ParseKrsOdpis(doc.RootElement);
        Assert.Equal("CHEMIKÓW 7, 09-411 PŁOCK", adres);
        Assert.Equal("ZARZAD@ORLEN.PL", email);
        Assert.Equal(["19.20.Z", "52.10"], pkd);
    }

    [Fact]
    public void Krs_ComposePkd()
    {
        using var pelny = JsonDocument.Parse("""{"kodDzial":"19","kodKlasa":"20","kodPodklasa":"Z"}""");
        using var bezPodklasy = JsonDocument.Parse("""{"kodDzial":"52","kodKlasa":"10"}""");
        using var pusty = JsonDocument.Parse("""{"kodDzial":"","kodKlasa":""}""");
        Assert.Equal("19.20.Z", RejestryParsers.ComposePkd(pelny.RootElement));
        Assert.Equal("52.10", RejestryParsers.ComposePkd(bezPodklasy.RootElement));
        Assert.Null(RejestryParsers.ComposePkd(pusty.RootElement));
    }

    [Fact]
    public void Vies_Parse()
    {
        using var ok = JsonDocument.Parse("""
            {"countryCode":"DE","vatNumber":"123456789","requestDate":"2026-01-01",
             "valid":true,"name":"Acme GmbH","address":"Berlin\nHauptstr 1"}
            """);
        var v = RejestryParsers.ParseVies(ok.RootElement);
        Assert.NotNull(v);
        Assert.True(v.Aktywny);
        Assert.Equal("DE", v.Kraj);
        Assert.Equal("Acme GmbH", v.Nazwa);
        Assert.Equal("Berlin, Hauptstr 1", v.Adres);
        using var brak = JsonDocument.Parse("""{"countryCode":"DE"}""");
        Assert.Null(RejestryParsers.ParseVies(brak.RootElement));
    }

    [Fact]
    public void Gus_Sid_Z_Odpowiedzi()
    {
        const string xml = """
            <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
              <soap:Body><ZalogujResponse xmlns="http://CIS/BIR/PUBL/2014/07">
                <ZalogujResult>abc123sid</ZalogujResult>
              </ZalogujResponse></soap:Body></soap:Envelope>
            """;
        Assert.Equal("abc123sid", RejestryParsers.ParseGusSid(xml));
        Assert.Null(RejestryParsers.ParseGusSid("nie-xml"));
    }

    [Fact]
    public void Gus_Dane_PierwszyWiersz()
    {
        const string xml = """
            <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
              <soap:Body><DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PUBL/2014/07">
                <DaneSzukajPodmiotyResult><dane>
                  <Regon>610188201</Regon><Nip>7740001454</Nip>
                  <Nazwa>ORLEN SPÓŁKA AKCYJNA</Nazwa>
                  <Ulica>CHEMIKÓW</Ulica><NrNieruchomosci>7</NrNieruchomosci><NrLokalu></NrLokalu>
                  <Miasto>PŁOCK</Miasto><KodPocztowy>09-411</KodPocztowy>
                </dane></DaneSzukajPodmiotyResult>
              </DaneSzukajPodmiotyResponse></soap:Body></soap:Envelope>
            """;
        var g = RejestryParsers.ParseGusDane(xml);
        Assert.NotNull(g);
        Assert.Equal("ORLEN SPÓŁKA AKCYJNA", g.Nazwa);
        Assert.Equal("7740001454", g.Nip);
        Assert.Equal("610188201", g.Regon);
        Assert.Equal("CHEMIKÓW 7, 09-411 PŁOCK", g.Adres);
        Assert.Null(RejestryParsers.ParseGusDane("<puste/>"));
    }

    [Fact]
    public void Gus_Koperty_ZawierajaKluczISid()
    {
        var login = RejestryParsers.GusLoginEnvelope("klucz<>&\"test");
        Assert.Contains("Zaloguj", login);
        Assert.DoesNotContain("<>&\"", login);
        var szukajNip = RejestryParsers.GusSzukajEnvelope("sid1", "7740001454", regon: false);
        Assert.Contains("<ns:Nip>7740001454</ns:Nip>", szukajNip);
        var szukajRegon = RejestryParsers.GusSzukajEnvelope("sid1", "610188201", regon: true);
        Assert.Contains("<ns:Regon>610188201</ns:Regon>", szukajRegon);
    }
}
