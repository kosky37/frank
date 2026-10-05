namespace Frank.Api.Reference;

// Dane referencyjne: kody PKD 2007 (wybór dla JDG) oraz stawki ryczałtu
// wg art. 12 ust. 1 ustawy o zryczałtowanym PIT (10 stawek, stan 2026).
// Stawkę wyznacza PKWiU usługi, nie sam PKD — tabela ma charakter pomocniczy.

public sealed record PkdEntry(string Kod, string Nazwa);

public sealed record RyczaltEntry(
    decimal Stawka,
    string Tytul,
    string Zakres,
    string Przyklady);

public static class Slowniki
{
    public static readonly PkdEntry[] Pkd =
    [
        new("62.01.Z", "Działalność związana z oprogramowaniem"),
        new("62.02.Z", "Działalność związana z doradztwem w zakresie informatyki"),
        new("62.03.Z", "Działalność związana z zarządzaniem urządzeniami informatycznymi"),
        new("62.09.Z", "Pozostała działalność usługowa w zakresie technologii informatycznych i komputerowych"),
        new("63.11.Z", "Przetwarzanie danych; zarządzanie stronami internetowymi (hosting) i podobna działalność"),
        new("63.12.Z", "Działalność portali internetowych"),
        new("58.21.Z", "Działalność wydawnicza w zakresie gier komputerowych"),
        new("58.29.Z", "Działalność wydawnicza w zakresie pozostałego oprogramowania"),
        new("70.22.Z", "Pozostałe doradztwo w zakresie prowadzenia działalności gospodarczej i zarządzania"),
        new("73.11.Z", "Działalność agencji reklamowych"),
        new("74.10.Z", "Działalność w zakresie specjalistycznego projektowania"),
        new("74.20.Z", "Działalność fotograficzna"),
        new("71.12.Z", "Działalność w zakresie inżynierii i związane z nią doradztwo techniczne"),
        new("69.20.Z", "Działalność rachunkowo-księgowa; doradztwo podatkowe"),
        new("85.59.B", "Pozostałe pozaszkolne formy edukacji, gdzie indziej niesklasyfikowane"),
        new("95.11.Z", "Naprawa i konserwacja komputerów i urządzeń peryferyjnych"),
        new("47.91.Z", "Sprzedaż detaliczna prowadzona przez domy sprzedaży wysyłkowej lub Internet"),
        new("68.20.Z", "Wynajem i zarządzanie nieruchomościami własnymi lub dzierżawionymi"),
        new("90.03.Z", "Artystyczna i literacka działalność twórcza"),
        new("96.02.Z", "Fryzjerstwo i pozostałe zabiegi kosmetyczne"),
        new("49.32.Z", "Działalność taksówek osobowych"),
        new("41.20.Z", "Roboty budowlane związane ze wznoszeniem budynków mieszkalnych i niemieszkalnych"),
    ];

    public static readonly RyczaltEntry[] Ryczalt =
    [
        new(0.17m, "Wolne zawody",
            "Przychody osiągane w zakresie wolnych zawodów wykonywanych osobiście (art. 4 ust. 1 pkt 11).",
            "adwokat, notariusz, radca prawny, biegły rewident, księgowy, doradca podatkowy, tłumacz, rzecznik patentowy"),
        new(0.15m, "Wybrane usługi niematerialne",
            "M.in. pośrednictwo w sprzedaży hurtowej, reklama i badanie rynku, fotografia, usługi związane z zatrudnieniem, działalność kulturalna i rozrywkowa.",
            "agencja reklamowa, fotograf, pośrednik, biuro podróży"),
        new(0.14m, "Medycyna, architektura, inżynieria",
            "Opieka zdrowotna (dział PKWiU 86), usługi architektoniczne i inżynierskie oraz badania i analizy techniczne (dział 71), specjalistyczne projektowanie (74.1).",
            "lekarz na kontrakcie, architekt, inżynier, projektant"),
        new(0.125m, "Najem powyżej 100 tys. zł i wybrane usługi",
            "Nadwyżka ponad 100 000 zł rocznie: najem/podnajem/dzierżawa, zakwaterowanie (55), wynajem nieruchomości (68.20.1), B+R (72), wynajem rzeczy ruchomych (77), pomoc społeczna z zakwaterowaniem (87).",
            "wynajmujący z przychodem > 100 tys. zł"),
        new(0.12m, "IT i oprogramowanie",
            "Wydawanie gier i oprogramowania (58.21, 58.29), doradztwo w zakresie sprzętu (62.02.10.0), oprogramowanie (ex 62.01.1, 62.01.2), doradztwo soft (ex 62.02), instalowanie (ex 62.09.20.0), zarządzanie sieciami (62.03.1).",
            "programista, DevOps, architekt oprogramowania, administrator"),
        new(0.10m, "Obrót nieruchomościami",
            "Kupno i sprzedaż nieruchomości na własny rachunek (PKWiU 68.10.1).",
            "obrót mieszkaniami i gruntami (68.10.Z)"),
        new(0.085m, "Większość usług",
            "Działalność usługowa niewymieniona w innych stawkach, najem do 100 tys. zł, gastronomia z alkoholem > 1,5%, edukacja (85), kultura (91), wytwarzanie z powierzonego materiału, prowizje.",
            "tester manualny, trener, sprzątanie, taxi, korepetycje"),
        new(0.055m, "Produkcja, budowlanka, transport",
            "Działalność wytwórcza, roboty budowlane, przewozy ładunków taborem > 2 t.",
            "wykonawca budowlany, stolarz, przewoźnik"),
        new(0.03m, "Handel i gastronomia",
            "Usługi w zakresie handlu, gastronomia bez alkoholu > 1,5%, produkcja zwierzęca, zbycie ruchomych składników majątku firmowego.",
            "sklep, bar bez alkoholu, hodowca"),
        new(0.02m, "Sprzedaż z własnej uprawy",
            "Sprzedaż przetworzonych nieprzemysłowo produktów roślinnych i zwierzęcych z własnej uprawy, hodowli lub chowu.",
            "rolnik sprzedający przetwory"),
    ];
}
