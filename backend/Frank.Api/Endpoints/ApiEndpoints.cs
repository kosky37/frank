using Frank.Api.Data;
using Frank.Api.Models;
using Frank.Api.Reference;
using Frank.Api.Services;
using Frank.Api.Tax;
using Microsoft.EntityFrameworkCore;

namespace Frank.Api.Endpoints;

public static class ApiEndpoints
{
    public static void Map(WebApplication app)
    {
        var sales = app.MapGroup("/api/sales");
        sales.MapGet("/", async (AppDbContext db) =>
            (await db.SalesInvoices.OrderByDescending(s => s.DataSprzedazy).ToListAsync())
            .Select(DtoMapper.ToDto).ToList());
        sales.MapGet("/{id}", async (string id, AppDbContext db) =>
            await db.SalesInvoices.FindAsync(id) is { } e ? Results.Ok(DtoMapper.ToDto(e)) : Results.NotFound());
        sales.MapPost("/", async (SalesInvoiceDto dto, AppDbContext db) =>
        {
            var e = DtoMapper.ToEntity(dto);
            db.SalesInvoices.Add(e);
            await db.SaveChangesAsync();
            return Results.Created($"/api/sales/{e.Id}", DtoMapper.ToDto(e));
        });
        sales.MapPut("/{id}", async (string id, SalesInvoiceDto dto, AppDbContext db) =>
        {
            var e = await db.SalesInvoices.FindAsync(id);
            if (e is null) return Results.NotFound();
            DtoMapper.ApplyTo(e, dto);
            await db.SaveChangesAsync();
            return Results.Ok(DtoMapper.ToDto(e));
        });
        sales.MapDelete("/{id}", async (string id, AppDbContext db) =>
        {
            var e = await db.SalesInvoices.FindAsync(id);
            if (e is null) return Results.NotFound();
            db.SalesInvoices.Remove(e);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        var costs = app.MapGroup("/api/costs");
        costs.MapGet("/", async (AppDbContext db) =>
            (await db.CostInvoices.OrderByDescending(c => c.DataKsiegowania).ToListAsync())
            .Select(DtoMapper.ToDto).ToList());
        costs.MapGet("/{id}", async (string id, AppDbContext db) =>
            await db.CostInvoices.FindAsync(id) is { } e ? Results.Ok(DtoMapper.ToDto(e)) : Results.NotFound());
        costs.MapPost("/", async (CostInvoiceDto dto, AppDbContext db) =>
        {
            var e = DtoMapper.ToEntity(dto);
            db.CostInvoices.Add(e);
            await db.SaveChangesAsync();
            return Results.Created($"/api/costs/{e.Id}", DtoMapper.ToDto(e));
        });
        costs.MapPut("/{id}", async (string id, CostInvoiceDto dto, AppDbContext db) =>
        {
            var e = await db.CostInvoices.FindAsync(id);
            if (e is null) return Results.NotFound();
            DtoMapper.ApplyTo(e, dto);
            await db.SaveChangesAsync();
            return Results.Ok(DtoMapper.ToDto(e));
        });
        costs.MapDelete("/{id}", async (string id, AppDbContext db) =>
        {
            var e = await db.CostInvoices.FindAsync(id);
            if (e is null) return Results.NotFound();
            db.CostInvoices.Remove(e);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapGet("/api/settings", async (AppDbContext db) =>
        {
            var s = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
            if (s.Id == 1 && await db.Settings.FindAsync(1) is null)
            {
                db.Settings.Add(s);
                await db.SaveChangesAsync();
            }
            return s;
        });
        app.MapPut("/api/settings", async (TaxpayerSettings input, AppDbContext db) =>
        {
            var s = await db.Settings.FindAsync(1);
            if (s is null)
            {
                input.Id = 1;
                db.Settings.Add(input);
            }
            else
            {
                s.FormaOpodatkowania = input.FormaOpodatkowania;
                s.StawkaRyczaltu = input.StawkaRyczaltu;
                s.Vatowiec = input.Vatowiec;
                s.OkresVat = input.OkresVat;
                s.ZaliczkaPit = input.ZaliczkaPit;
                s.ZusSpoleczneMies = input.ZusSpoleczneMies;
                s.ZusZdrowotnaMies = input.ZusZdrowotnaMies;
                s.ZusFpMies = input.ZusFpMies;
                s.ZusSchemat = input.ZusSchemat;
                s.UzytkowaniePojazdu = input.UzytkowaniePojazdu;
                s.Vat26Zgloszony = input.Vat26Zgloszony;
                s.FirmaNazwa = input.FirmaNazwa;
                s.FirmaNip = input.FirmaNip;
                s.FirmaRegon = input.FirmaRegon;
                s.FirmaAdres = input.FirmaAdres;
                s.FirmaEmail = input.FirmaEmail;
                s.FirmaTelefon = input.FirmaTelefon;
                s.PkdJson = string.IsNullOrWhiteSpace(input.PkdJson) ? "[]" : input.PkdJson;
                s.KsefToken = input.KsefToken;
                s.KsefSrodowisko = input.KsefSrodowisko;
                s.GusApiKey = input.GusApiKey;
                s.ZusNrs = input.ZusNrs;
                s.EdoreczeniaAdres = input.EdoreczeniaAdres;
                s.ZusKodTytulu = input.ZusKodTytulu;
                s.DataRozpoczeciaDzialalnosci = input.DataRozpoczeciaDzialalnosci;
            }
            await db.SaveChangesAsync();
            return await db.Settings.FindAsync(1);
        });

        app.MapGet("/api/taxes/monthly", async (string month, AppDbContext db) =>
        {
            var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
            var sums = TaxAggregator.Aggregate(month,
                await db.SalesInvoices.ToListAsync(),
                await db.CostInvoices.ToListAsync(), u);
            var pit = PitCalc.ZaliczkaMiesieczna(sums, u);
            var vatDue = u.Vatowiec ? Money.Round2(sums.VatNalezny - sums.VatNaliczony) : 0m;
            var zus = ZusCalc.Miesieczny(u);
            return Results.Ok(new { sums, pit, vatDoZaplaty = vatDue, zus });
        });

        app.MapGet("/api/taxes/yearly", async (string year, AppDbContext db) =>
        {
            var u = await db.Settings.FindAsync(1) ?? new TaxpayerSettings();
            var sales = await db.SalesInvoices.ToListAsync();
            var costs = await db.CostInvoices.ToListAsync();
            var miesiace = sales.Select(s => s.DataSprzedazy.Length >= 7 ? s.DataSprzedazy[..7] : "")
                .Concat(costs.Select(c => c.DataKsiegowania.Length >= 7 ? c.DataKsiegowania[..7] : ""))
                .Where(m => m.StartsWith(year, StringComparison.Ordinal))
                .Distinct().OrderBy(m => m).ToList();
            var podsumowania = miesiace
                .Select(m => TaxAggregator.Aggregate(m, sales, costs, u)).ToList();
            var przychod = Money.Round2(podsumowania.Sum(s => s.PrzychodNetto));
            var koszty = Money.Round2(podsumowania.Sum(s => s.KosztyNettoPit));
            var splitRoczny = podsumowania
                .SelectMany(s => s.RyczaltSplit)
                .GroupBy(p => p.Stawka)
                .Select(g => new RyczaltSplit(g.Key, Money.Round2(g.Sum(p => p.Przychod))))
                .ToList();
            var roczny = PitCalc.Roczny(przychod, koszty,
                u.ZusSpoleczneMies * 12, u.ZusZdrowotnaMies * 12, u, splitRoczny);
            return Results.Ok(new { miesiace = podsumowania, przychod, koszty, rocznyPit = roczny });
        });

        var kontrahenci = app.MapGroup("/api/kontrahenci");
        kontrahenci.MapGet("/", async (string? q, AppDbContext db) =>
        {
            var list = await db.Contractors.OrderBy(c => c.Nazwa).ToListAsync();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var needle = q.Trim().ToLowerInvariant();
                list = list.Where(c =>
                    c.Nazwa.ToLowerInvariant().Contains(needle) ||
                    c.Nip.Contains(needle)).ToList();
            }
            return list.Select(DtoMapper.ToDto).ToList();
        });
        kontrahenci.MapGet("/{id}", async (string id, AppDbContext db) =>
            await db.Contractors.FindAsync(id) is { } e ? Results.Ok(DtoMapper.ToDto(e)) : Results.NotFound());
        kontrahenci.MapPost("/", async (ContractorDto dto, AppDbContext db) =>
        {
            var e = DtoMapper.ToEntity(dto);
            db.Contractors.Add(e);
            await db.SaveChangesAsync();
            return Results.Created($"/api/kontrahenci/{e.Id}", DtoMapper.ToDto(e));
        });
        kontrahenci.MapPut("/{id}", async (string id, ContractorDto dto, AppDbContext db) =>
        {
            var e = await db.Contractors.FindAsync(id);
            if (e is null) return Results.NotFound();
            DtoMapper.ApplyTo(e, dto);
            await db.SaveChangesAsync();
            return Results.Ok(DtoMapper.ToDto(e));
        });
        kontrahenci.MapDelete("/{id}", async (string id, AppDbContext db) =>
        {
            var e = await db.Contractors.FindAsync(id);
            if (e is null) return Results.NotFound();
            db.Contractors.Remove(e);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapGet("/api/slowniki/pkd", () => Slowniki.Pkd);
        app.MapGet("/api/slowniki/ryczalt", () => Slowniki.Ryczalt);

        app.MapGet("/api/rejestry/podmiot", async (string nip, RejestryService rejestry, CancellationToken ct) =>
        {
            var digits = new string([.. nip.Where(char.IsDigit)]);
            if (digits.Length != 10)
                return Results.BadRequest(new { code = "ZLY_NIP", message = "NIP musi mieć 10 cyfr." });
            try
            {
                var podmiot = await rejestry.ZnajdzPoNip(digits, ct);
                return podmiot is null
                    ? Results.NotFound(new { code = "NIE_ZNALEZIONO", message = "Nie znaleziono podmiotu w Białej Liście VAT." })
                    : Results.Ok(podmiot);
            }
            catch (OperationCanceledException)
            {
                return Results.Problem("Przekroczono czas oczekiwania na rejestry.", statusCode: 504);
            }
        });
    }
}
