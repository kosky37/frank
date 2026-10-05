using Frank.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Frank.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<SalesInvoice> SalesInvoices => Set<SalesInvoice>();
    public DbSet<CostInvoice> CostInvoices => Set<CostInvoice>();
    public DbSet<Contractor> Contractors => Set<Contractor>();
    public DbSet<TaxpayerSettings> Settings => Set<TaxpayerSettings>();

    public static string ResolveDbPath(string? dataDir, string contentRoot)
    {
        var dir = string.IsNullOrWhiteSpace(dataDir)
            ? Path.Combine(contentRoot, "data")
            : dataDir;
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "frank.sqlite");
    }

    /// Addytywne łatki schematu dla istniejących baz (EnsureCreated nie migruje).
    /// Tylko ADD COLUMN / CREATE TABLE IF NOT EXISTS — zmiany destrukcyjne wymagają ręcznej interwencji.
    public void EnsureColumns()
    {
        PatchTable("Settings", SettingsColumns);
        foreach (var g in ExtraColumns.GroupBy(c => c.Table))
            PatchTable(g.Key, g.Select(c => (c.Name, c.Type, c.Default)).ToArray());
        // Tabele z nowych wersji (EnsureCreated nie tworzy brakujących tabel w istniejącej bazie).
        Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS "Contractors" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_Contractors" PRIMARY KEY,
                "Nazwa" TEXT NOT NULL,
                "Nip" TEXT NOT NULL,
                "Regon" TEXT NULL,
                "Adres" TEXT NOT NULL,
                "Email" TEXT NULL,
                "Telefon" TEXT NULL,
                "Notatki" TEXT NULL,
                "Zrodlo" TEXT NOT NULL
            )
            """);
    }

    private static readonly (string Name, string Type, string Default)[] SettingsColumns =
    [
        ("FirmaNazwa", "TEXT", "''"),
        ("FirmaNip", "TEXT", "''"),
        ("FirmaRegon", "TEXT", "''"),
        ("FirmaAdres", "TEXT", "''"),
        ("FirmaEmail", "TEXT", "''"),
        ("FirmaTelefon", "TEXT", "''"),
        ("PkdJson", "TEXT", "'[]'"),
        ("KsefToken", "TEXT", "NULL"),
        ("KsefSrodowisko", "TEXT", "NULL"),
        ("GusApiKey", "TEXT", "NULL"),
        ("ZusNrs", "TEXT", "NULL"),
        ("EdoreczeniaAdres", "TEXT", "NULL"),
        ("ZusKodTytulu", "TEXT", "NULL"),
        ("DataRozpoczeciaDzialalnosci", "TEXT", "NULL"),
    ];

    private static readonly (string Table, string Name, string Type, string Default)[] ExtraColumns =
    [
        ("CostInvoices", "NieodliczalnyArt23", "INTEGER", "0"),
    ];

    private void PatchTable(string table, (string Name, string Type, string Default)[] cols)
    {
        HashSet<string> existing;
        try { existing = ColumnsOf(table); } catch { return; }
        foreach (var (name, type, dflt) in cols)
        {
            if (existing.Contains(name)) continue;
            var notNull = dflt == "NULL" ? "" : "NOT NULL";
            // Nazwy kolumn z zamkniętej listy stałych — nie z inputu użytkownika.
#pragma warning disable EF1002
            Database.ExecuteSqlRaw(
                $"ALTER TABLE \"{table}\" ADD COLUMN \"{name}\" {type} {notNull} DEFAULT {dflt}".Trim());
#pragma warning restore EF1002
        }
    }

    private HashSet<string> ColumnsOf(string table)
    {
        using var cmd = Database.GetDbConnection().CreateCommand();
        cmd.CommandText = $"SELECT name FROM pragma_table_info('{table}')";
        if (cmd.Connection is null) return [];
        var wasClosed = cmd.Connection.State == System.Data.ConnectionState.Closed;
        if (wasClosed) cmd.Connection.Open();
        try
        {
            using var r = cmd.ExecuteReader();
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while (r.Read()) set.Add(r.GetString(0));
            return set;
        }
        finally
        {
            if (wasClosed) cmd.Connection.Close();
        }
    }

    public void EnsureSeeded()
    {
        Database.EnsureCreated();
        EnsureColumns();
        if (!Settings.Any())
            Settings.Add(new TaxpayerSettings());
        if (!SalesInvoices.Any() && !CostInvoices.Any())
        {
            SalesInvoices.Add(new SalesInvoice
            {
                Id = "demo1",
                Numer = "1/01/2026",
                KontrahentId = "k1",
                KontrahentNazwa = "Acme Sp. z o.o.",
                KontrahentNip = "5250000000",
                KontrahentAdres = "Warszawa",
                DataWystawienia = "2026-01-31",
                DataSprzedazy = "2026-01-31",
                TerminPlatnosci = "2026-02-14",
                PozycjeJson = """[{"nazwa":"Usługi programistyczne 01/2026","ilosc":1,"cenaNetto":20000,"stawkaVat":0.23,"stawkaRyczaltu":0.12}]""",
                Status = "wystawiona",
                Zaplacona = true,
            });
            CostInvoices.AddRange(
                new CostInvoice
                {
                    Id = "demo-c1",
                    Numer = "FV/ORLEN/1",
                    Wystawca = "Orlen",
                    DataZakupu = "2026-01-10",
                    DataKsiegowania = "2026-01-10",
                    Kategoria = "paliwo",
                    Pojazdowy = true,
                    UzytkowaniePojazdu = "mieszany",
                    Netto = 1000m,
                    StawkaVat = "0.23",
                    Opis = "paliwo — mix 50% VAT / 75% PIT",
                },
                new CostInvoice
                {
                    Id = "demo-c2",
                    Numer = "FV/COMPUTRONIK/2",
                    Wystawca = "Komputronik",
                    DataZakupu = "2026-01-12",
                    DataKsiegowania = "2026-01-12",
                    Kategoria = "sprzet",
                    Pojazdowy = false,
                    UzytkowaniePojazdu = "mieszany",
                    Netto = 5000m,
                    StawkaVat = "0.23",
                    Opis = "dysk SSD + RAM",
                });
        }
        SaveChanges();
    }
}
