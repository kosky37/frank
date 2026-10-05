// Dane referencyjne (kopia zapasowa dla trybu offline).
// Źródło prawdy: GET /api/slowniki/pkd i /api/slowniki/ryczalt.
// Stawki wg art. 12 ust. 1 ustawy o zryczałtowanym PIT (10 stawek, 2026).
// Stawkę wyznacza PKWiU usługi, nie sam PKD.

export interface PkdEntry {
  kod: string;
  nazwa: string;
}

export interface RyczaltEntry {
  stawka: number;
  tytul: string;
  zakres: string;
  przyklady: string;
}

export const PKD: PkdEntry[] = [
  { kod: '62.01.Z', nazwa: 'Działalność związana z oprogramowaniem' },
  { kod: '62.02.Z', nazwa: 'Działalność związana z doradztwem w zakresie informatyki' },
  { kod: '62.03.Z', nazwa: 'Działalność związana z zarządzaniem urządzeniami informatycznymi' },
  { kod: '62.09.Z', nazwa: 'Pozostała działalność usługowa w zakresie technologii informatycznych i komputerowych' },
  { kod: '63.11.Z', nazwa: 'Przetwarzanie danych; zarządzanie stronami internetowymi (hosting) i podobna działalność' },
  { kod: '63.12.Z', nazwa: 'Działalność portali internetowych' },
  { kod: '58.21.Z', nazwa: 'Działalność wydawnicza w zakresie gier komputerowych' },
  { kod: '58.29.Z', nazwa: 'Działalność wydawnicza w zakresie pozostałego oprogramowania' },
  { kod: '70.22.Z', nazwa: 'Pozostałe doradztwo w zakresie prowadzenia działalności gospodarczej i zarządzania' },
  { kod: '73.11.Z', nazwa: 'Działalność agencji reklamowych' },
  { kod: '74.10.Z', nazwa: 'Działalność w zakresie specjalistycznego projektowania' },
  { kod: '74.20.Z', nazwa: 'Działalność fotograficzna' },
  { kod: '71.12.Z', nazwa: 'Działalność w zakresie inżynierii i związane z nią doradztwo techniczne' },
  { kod: '69.20.Z', nazwa: 'Działalność rachunkowo-księgowa; doradztwo podatkowe' },
  { kod: '85.59.B', nazwa: 'Pozostałe pozaszkolne formy edukacji, gdzie indziej niesklasyfikowane' },
  { kod: '95.11.Z', nazwa: 'Naprawa i konserwacja komputerów i urządzeń peryferyjnych' },
  { kod: '47.91.Z', nazwa: 'Sprzedaż detaliczna prowadzona przez domy sprzedaży wysyłkowej lub Internet' },
  { kod: '68.20.Z', nazwa: 'Wynajem i zarządzanie nieruchomościami własnymi lub dzierżawionymi' },
  { kod: '90.03.Z', nazwa: 'Artystyczna i literacka działalność twórcza' },
  { kod: '96.02.Z', nazwa: 'Fryzjerstwo i pozostałe zabiegi kosmetyczne' },
  { kod: '49.32.Z', nazwa: 'Działalność taksówek osobowych' },
  { kod: '41.20.Z', nazwa: 'Roboty budowlane związane ze wznoszeniem budynków mieszkalnych i niemieszkalnych' },
];

export const RYCZALT: RyczaltEntry[] = [
  { stawka: 0.17, tytul: 'Wolne zawody', zakres: 'Przychody z wolnych zawodów wykonywanych osobiście (art. 4 ust. 1 pkt 11).', przyklady: 'adwokat, notariusz, doradca podatkowy, tłumacz' },
  { stawka: 0.15, tytul: 'Wybrane usługi niematerialne', zakres: 'M.in. pośrednictwo hurtowe, reklama, fotografia, zatrudnienie, kultura i rozrywka.', przyklady: 'agencja reklamowa, fotograf, pośrednik' },
  { stawka: 0.14, tytul: 'Medycyna, architektura, inżynieria', zakres: 'Opieka zdrowotna (dz. 86), usługi architektoniczne/inżynierskie i badania techniczne (dz. 71), specjalistyczne projektowanie (74.1).', przyklady: 'lekarz na kontrakcie, architekt, inżynier' },
  { stawka: 0.125, tytul: 'Najem powyżej 100 tys. zł i wybrane usługi', zakres: 'Nadwyżka ponad 100 000 zł: najem, zakwaterowanie (55), wynajem nieruchomości (68.20.1), B+R (72), wynajem rzeczy (77).', przyklady: 'wynajmujący z przychodem > 100 tys. zł' },
  { stawka: 0.12, tytul: 'IT i oprogramowanie', zakres: 'Wydawanie gier/oprogramowania (58.21, 58.29), doradztwo sprzętowe, oprogramowanie (62.01), doradztwo soft (62.02), zarządzanie sieciami (62.03.1).', przyklady: 'programista, DevOps, administrator' },
  { stawka: 0.1, tytul: 'Obrót nieruchomościami', zakres: 'Kupno i sprzedaż nieruchomości na własny rachunek (68.10.1).', przyklady: 'obrót mieszkaniami (68.10.Z)' },
  { stawka: 0.085, tytul: 'Większość usług', zakres: 'Usługi niewymienione w innych stawkach, najem do 100 tys. zł, gastronomia z alkoholem, edukacja (85), kultura (91).', przyklady: 'tester manualny, trener, taxi' },
  { stawka: 0.055, tytul: 'Produkcja, budowlanka, transport', zakres: 'Działalność wytwórcza, roboty budowlane, przewozy ładunków > 2 t.', przyklady: 'wykonawca budowlany, przewoźnik' },
  { stawka: 0.03, tytul: 'Handel i gastronomia', zakres: 'Usługi w zakresie handlu, gastronomia bez alkoholu, produkcja zwierzęca, zbycie składników majątku.', przyklady: 'sklep, bar bez alkoholu' },
  { stawka: 0.02, tytul: 'Sprzedaż z własnej uprawy', zakres: 'Sprzedaż nieprzetworzonych przemysłowo produktów z własnej uprawy/hodowli.', przyklady: 'rolnik sprzedający przetwory' },
];
