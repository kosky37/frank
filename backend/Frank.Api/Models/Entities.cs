using System.Text.Json;

namespace Frank.Api.Models;

// Lokalna encja + DTO w jednym — kształty JSON 1:1 z frontendem (camelCase z ASP.NET).
// Pozycje i kontrahent trzymane w kolumnach JSON / spłaszczonych kolumnach.

public sealed class SalesInvoice
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Numer { get; set; } = "";
    public string KontrahentId { get; set; } = "";
    public string KontrahentNazwa { get; set; } = "";
    public string KontrahentNip { get; set; } = "";
    public string KontrahentAdres { get; set; } = "";
    public string? KontrahentEmail { get; set; }
    public string DataWystawienia { get; set; } = ""; // yyyy-MM-dd
    public string DataSprzedazy { get; set; } = "";   // yyyy-MM-dd
    public string TerminPlatnosci { get; set; } = ""; // yyyy-MM-dd
    public string PozycjeJson { get; set; } = "[]";
    public string Status { get; set; } = "robocza";
    public string? KsefId { get; set; }
    public bool Zaplacona { get; set; }
}

public sealed class CostInvoice
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Numer { get; set; } = "";
    public string Wystawca { get; set; } = "";
    public string? NipWystawcy { get; set; }
    public string DataZakupu { get; set; } = "";
    public string DataKsiegowania { get; set; } = "";
    public string Kategoria { get; set; } = "inne";
    public bool Pojazdowy { get; set; }
    public string UzytkowaniePojazdu { get; set; } = "mieszany";
    public decimal Netto { get; set; }
    public string StawkaVat { get; set; } = "0.23"; // "0.23" | "0.08" | "0.05" | "0" | "zw" | "np" | "oo"
    public decimal? VatNaliczonyDowolny { get; set; }
    public string Opis { get; set; } = "";
    /// art. 23 PIT: reprezentacja/mandat/prywatne — nigdy KUP ani VAT
    public bool NieodliczalnyArt23 { get; set; }
}

public sealed class Contractor
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Nazwa { get; set; } = "";
    public string Nip { get; set; } = "";
    public string? Regon { get; set; }
    public string Adres { get; set; } = "";
    public string? Email { get; set; }
    public string? Telefon { get; set; }
    public string? Notatki { get; set; }
    /// Skąd dane: recznie | biala-lista | krs
    public string Zrodlo { get; set; } = "recznie";
}

public sealed class TaxpayerSettings
{
    public int Id { get; set; } = 1;
    public string FormaOpodatkowania { get; set; } = "liniowy"; // skala | liniowy | ryczalt
    public decimal StawkaRyczaltu { get; set; } = 0.12m;
    public bool Vatowiec { get; set; } = true;
    public string OkresVat { get; set; } = "miesieczny";
    public string ZaliczkaPit { get; set; } = "miesieczna";
    public decimal ZusSpoleczneMies { get; set; } = 1788.29m;
    public decimal ZusZdrowotnaMies { get; set; } = 432.54m;
    public decimal ZusFpMies { get; set; } = 138.47m;
    public string ZusSchemat { get; set; } = "duzy"; // start | preferencyjny | maly_plus | duzy (+legacy ulgowy/maly)
    public string UzytkowaniePojazdu { get; set; } = "mieszany";
    public bool Vat26Zgloszony { get; set; }
    // Profil firmy (dane sprzedawcy na fakturach, CEIDG/PKD)
    public string FirmaNazwa { get; set; } = "";
    public string FirmaNip { get; set; } = "";
    public string FirmaRegon { get; set; } = "";
    public string FirmaAdres { get; set; } = "";
    public string FirmaEmail { get; set; } = "";
    public string FirmaTelefon { get; set; } = "";
    /// Kody PKD firmy (JSON: ["62.01.Z", ...])
    public string PkdJson { get; set; } = "[]";
    // Integracje (sekrety użytkownika; nigdy do repo)
    public string? KsefToken { get; set; }
    public string? KsefSrodowisko { get; set; }
    public string? GusApiKey { get; set; }
    public string? ZusNrs { get; set; }
    public string? EdoreczeniaAdres { get; set; }
    public string? ZusKodTytulu { get; set; }
    public string? DataRozpoczeciaDzialalnosci { get; set; }
    /// Wakacje składkowe: miesiąc yyyy-mm bez społecznych + FP (zdrowotna zostaje)
    public string? WakacjeSkladkoweMiesiac { get; set; }
}

public sealed record InvoiceItemDto(
    string Nazwa,
    decimal Ilosc,
    decimal CenaNetto,
    JsonElement StawkaVat,
    decimal? StawkaRyczaltu = null);

public sealed record ContractorDto(
    string Id,
    string Nazwa,
    string Nip,
    string? Regon,
    string Adres,
    string? Email,
    string? Telefon,
    string? Notatki,
    string Zrodlo);

public sealed record SalesInvoiceDto(
    string Id,
    string Numer,
    ContractorDto Kontrahent,
    string DataWystawienia,
    string DataSprzedazy,
    string TerminPlatnosci,
    List<InvoiceItemDto> Pozycje,
    string Status,
    string? KsefId,
    bool? Zaplacona);

public sealed record CostInvoiceDto(
    string Id,
    string Numer,
    string Wystawca,
    string? NipWystawcy,
    string DataZakupu,
    string DataKsiegowania,
    string Kategoria,
    bool Pojazdowy,
    string UzytkowaniePojazdu,
    decimal Netto,
    JsonElement StawkaVat,
    decimal? VatNaliczonyDowolny,
    string Opis,
    bool NieodliczalnyArt23 = false);
