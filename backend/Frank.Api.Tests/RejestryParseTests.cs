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
}
