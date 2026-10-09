using System.Text.Json;
using Frank.Api.Models;

namespace Frank.Api.Models;

// Mapowanie encje <-> DTO 1:1 z kształtami frontendu (camelCase robi ASP.NET).
public static class DtoMapper
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public static string CanonicalVatRate(JsonElement el) =>
        el.ValueKind switch
        {
            JsonValueKind.Number => el.GetDecimal().ToString("0.##", System.Globalization.CultureInfo.InvariantCulture),
            JsonValueKind.String => el.GetString() ?? "zw",
            _ => "zw",
        };

    public static JsonElement VatRateElement(string canonical)
    {
        if (decimal.TryParse(canonical, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var d))
            return JsonDocument.Parse(d.ToString(System.Globalization.CultureInfo.InvariantCulture)).RootElement.Clone();
        return JsonDocument.Parse($"\"{canonical}\"").RootElement.Clone();
    }

    public static List<InvoiceItemDto> ReadItems(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<InvoiceItemDto>>(json, JsonOpts) ?? [];
        }
        catch
        {
            return [];
        }
    }

    public static SalesInvoiceDto ToDto(SalesInvoice e) => new(
        e.Id, e.Numer,
        new ContractorDto(e.KontrahentId, e.KontrahentNazwa, e.KontrahentNip, null, e.KontrahentAdres, e.KontrahentEmail, null, null, "recznie"),
        e.DataWystawienia, e.DataSprzedazy, e.TerminPlatnosci,
        ReadItems(e.PozycjeJson),
        e.Status, e.KsefId, e.Zaplacona,
        e.Waluta, e.KursNbp, e.Mpp, e.RachunekBankowy, e.BialaListaSprawdzona,
        string.IsNullOrWhiteSpace(e.Rodzaj) ? "sprzedazy" : e.Rodzaj,
        e.KorygujeNumer, e.Zal15, e.TrybKsef);

    public static CostInvoiceDto ToDto(CostInvoice e) => new(
        e.Id, e.Numer, e.Wystawca, e.NipWystawcy,
        e.DataZakupu, e.DataKsiegowania, e.Kategoria,
        e.Pojazdowy, e.UzytkowaniePojazdu, e.Netto,
        VatRateElement(e.StawkaVat), e.VatNaliczonyDowolny, e.Opis, e.NieodliczalnyArt23, e.KsefId);

    public static SalesInvoice ToEntity(SalesInvoiceDto d) => new()
    {
        Id = string.IsNullOrWhiteSpace(d.Id) ? Guid.NewGuid().ToString("N") : d.Id,
        Numer = d.Numer,
        KontrahentId = d.Kontrahent.Id,
        KontrahentNazwa = d.Kontrahent.Nazwa,
        KontrahentNip = d.Kontrahent.Nip,
        KontrahentAdres = d.Kontrahent.Adres,
        KontrahentEmail = d.Kontrahent.Email,
        DataWystawienia = d.DataWystawienia,
        DataSprzedazy = d.DataSprzedazy,
        TerminPlatnosci = d.TerminPlatnosci,
        PozycjeJson = JsonSerializer.Serialize(d.Pozycje, JsonOpts),
        Status = d.Status,
        KsefId = d.KsefId,
        Zaplacona = d.Zaplacona ?? false,
        Waluta = d.Waluta,
        KursNbp = d.KursNbp,
        Mpp = d.Mpp,
        RachunekBankowy = d.RachunekBankowy,
        BialaListaSprawdzona = d.BialaListaSprawdzona,
        Rodzaj = string.IsNullOrWhiteSpace(d.Rodzaj) ? "sprzedazy" : d.Rodzaj,
        KorygujeNumer = d.KorygujeNumer,
        Zal15 = d.Zal15,
        TrybKsef = d.TrybKsef,
    };

    public static CostInvoice ToEntity(CostInvoiceDto d) => new()
    {
        Id = string.IsNullOrWhiteSpace(d.Id) ? Guid.NewGuid().ToString("N") : d.Id,
        Numer = d.Numer,
        Wystawca = d.Wystawca,
        NipWystawcy = d.NipWystawcy,
        DataZakupu = d.DataZakupu,
        DataKsiegowania = d.DataKsiegowania,
        Kategoria = d.Kategoria,
        Pojazdowy = d.Pojazdowy,
        UzytkowaniePojazdu = d.UzytkowaniePojazdu,
        Netto = d.Netto,
        StawkaVat = CanonicalVatRate(d.StawkaVat),
        VatNaliczonyDowolny = d.VatNaliczonyDowolny,
        Opis = d.Opis,
        NieodliczalnyArt23 = d.NieodliczalnyArt23,
        KsefId = d.KsefId,
    };

    public static void ApplyTo(SalesInvoice e, SalesInvoiceDto d)
    {
        var fresh = ToEntity(d with { Id = e.Id });
        e.Numer = fresh.Numer;
        e.KontrahentId = fresh.KontrahentId;
        e.KontrahentNazwa = fresh.KontrahentNazwa;
        e.KontrahentNip = fresh.KontrahentNip;
        e.KontrahentAdres = fresh.KontrahentAdres;
        e.KontrahentEmail = fresh.KontrahentEmail;
        e.DataWystawienia = fresh.DataWystawienia;
        e.DataSprzedazy = fresh.DataSprzedazy;
        e.TerminPlatnosci = fresh.TerminPlatnosci;
        e.PozycjeJson = fresh.PozycjeJson;
        e.Status = fresh.Status;
        e.KsefId = fresh.KsefId;
        e.Zaplacona = fresh.Zaplacona;
        e.Waluta = fresh.Waluta;
        e.KursNbp = fresh.KursNbp;
        e.Mpp = fresh.Mpp;
        e.RachunekBankowy = fresh.RachunekBankowy;
        e.BialaListaSprawdzona = fresh.BialaListaSprawdzona;
        e.Rodzaj = fresh.Rodzaj;
        e.KorygujeNumer = fresh.KorygujeNumer;
        e.Zal15 = fresh.Zal15;
        e.TrybKsef = fresh.TrybKsef;
    }

    public static void ApplyTo(CostInvoice e, CostInvoiceDto d)
    {
        var fresh = ToEntity(d with { Id = e.Id });
        e.Numer = fresh.Numer;
        e.Wystawca = fresh.Wystawca;
        e.NipWystawcy = fresh.NipWystawcy;
        e.DataZakupu = fresh.DataZakupu;
        e.DataKsiegowania = fresh.DataKsiegowania;
        e.Kategoria = fresh.Kategoria;
        e.Pojazdowy = fresh.Pojazdowy;
        e.UzytkowaniePojazdu = fresh.UzytkowaniePojazdu;
        e.Netto = fresh.Netto;
        e.StawkaVat = fresh.StawkaVat;
        e.VatNaliczonyDowolny = fresh.VatNaliczonyDowolny;
        e.Opis = fresh.Opis;
        e.NieodliczalnyArt23 = fresh.NieodliczalnyArt23;
        e.KsefId = fresh.KsefId;
    }

    public static ContractorDto ToDto(Contractor e) => new(
        e.Id, e.Nazwa, e.Nip, e.Regon, e.Adres, e.Email, e.Telefon, e.Notatki, e.Zrodlo);

    public static Contractor ToEntity(ContractorDto d) => new()
    {
        Id = string.IsNullOrWhiteSpace(d.Id) ? Guid.NewGuid().ToString("N") : d.Id,
        Nazwa = d.Nazwa,
        Nip = d.Nip,
        Regon = d.Regon,
        Adres = d.Adres,
        Email = d.Email,
        Telefon = d.Telefon,
        Notatki = d.Notatki,
        Zrodlo = string.IsNullOrWhiteSpace(d.Zrodlo) ? "recznie" : d.Zrodlo,
    };

    public static void ApplyTo(Contractor e, ContractorDto d)
    {
        e.Nazwa = d.Nazwa;
        e.Nip = d.Nip;
        e.Regon = d.Regon;
        e.Adres = d.Adres;
        e.Email = d.Email;
        e.Telefon = d.Telefon;
        e.Notatki = d.Notatki;
        e.Zrodlo = string.IsNullOrWhiteSpace(d.Zrodlo) ? e.Zrodlo : d.Zrodlo;
    }
}
