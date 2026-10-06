UNRESOLVED:

RESOLVED:

- settings tiles are still narrow
  → drugi pass: `.sections` min 340→360px (420px na ≥1400px); karty „Moja firma” i „Opodatkowanie”
  rozpięte na 2 kolumny (`span2`, z fallbackiem na mobile); formularz firmy jako 2-kolumnowa siatka
  (`.form-grid`: nazwa+NIP, REGON+telefon, adres+e-mail obok siebie; wyszukiwarka rejestrów i PKD na pełną szerokość);
  szerokie tabele (deklaracje ZUS, odbiór KSeF) rozpięte na całą szerokość (`span-all`).
- JPK podgląd zawsze z błędem „Osoba fizyczna: wymagane imię i nazwisko” (endpoint wołał builder
  z pustymi danymi osobowymi) → `JpkEndpoints.cs`: podgląd używa roboczych danych (IMIE/NAZWISKO/1900-01-01)
  + flaga `uwaga` w odpowiedzi i UI; prawdziwe dane tylko przy wysyłce (niezapisywane).
- Koszt bez NIP (np. paragon Orlen z seeda) blokował cały JPK błędem ZLE_DANE
  → `JpkEndpoints.cs`: koszty bez 10-cyfrowego NIP są pomijane w ewidencji (VAT i tak nieodliczalny
  bez NIP) i raportowane w `pominiete` (podgląd + wysyłka + UI). Sprzedaż bez NIP zostaje twardym błędem.
- FA(3) XSD: publikowany plik v10 (`StrukturyDanych_v10-0E`) nie zawiera 12 typów bazowych etd
  (TNaturalny, TData, TWybor1, …) wymaganych przez schemat FA(3) → nowy plik pomocniczy
  `Schemas/etd-2022-01-05-brakujace.xsd` (definicje jak w MF v12) + pre-ładowanie w `XsdWalidator.cs`;
  test FA3 jest strict (bez trybu pominiętego).
- Fałszywe KSeF-id (mock `KSEF-…`) trafiałyby do `<NrKSeF>` i psuły XSD JPK
  → `JpkV7Builder.ZnakKsef`: numer tylko gdy pasuje do wzoru MF (TNumerKSeF), inaczej `<BFK>1</BFK>`.

- NaN zł na Pulpicie/Podatkach (ZUS, Na rękę, Porównywarka, DRA)
  → root cause: backend `ZusFpMies` serializował się jako `zusFpMies`, frontend oczekiwał `zusFPMies`
  (`types.ts:87`, `zus.ts:65`). `settings.zusFPMies` = undefined → NaN w `zusMiesieczny`, `rocznyZusForma`, `Dashboard`.
  Fix: `Entities.cs`: `[JsonPropertyName("zusFPMies")]`; `Slowniki.cs`: `[property: JsonPropertyName("zusDuzyFP")]`;
  `api.ts`: `mapSettingsIn` akceptuje obie pisownie + defaulty z `DEFAULT_SETTINGS`, `saveSettings` wysyła obie;
  `store.ts`: `normalizeSettings` dla starego localStorage; `vat.ts`: `round2` guarduje non-finite → 0;
  `format.ts`: `fmtMoney` guarduje non-finite → `—`. Testy: `audit-fixes.test.ts` (4).
- PIT roczny 0,00 zł przy 1 mies. przychodu vs zaliczka 2285 zł + „oszczędzasz 0 zł” + tort bez PIT/ZUS
  → `Dashboard.tsx:50-52`, `Taxes.tsx:43-44` liczyły `zus*12` zamiast YTD. Przy 20k przychodu i 12×1788 ZUS dochód <0 → 0.
  Fix: YTD — `zusSpolYtd = sum(s.zusSpoleczne)`, zdrowotna/ZUS YTD z `zusMiesieczny` per miesiąc,
  `naReke = przychod-koszty-PIT-zusYtd-VAT`, `pitBezKosztow` na tych samych YTD;
  labelki `YTD (N mies.)`, `PodzialSrodkow` z tabelą kwot + udziałów i guardem na NaN.
- `batchE.ts` duplicate `const v = salesVat(inv)` — build/test czerwony
  → usunięty duplikat (l.320); `batchE.test.ts` fixture uzupełniona o `firmaNazwa/adres` (wymaga `art106e`).
- `stawki?rok=` zwracało `zusDuzyFp` (małe p), frontend czytał `zusDuzyFP` → undefined → NaN po „Zastosuj stawki”
  → backend `JsonPropertyName("zusDuzyFP")`, frontend akceptuje obie + fallback do `stawkiNaRok()`;
  `Settings.tsx`: `zastosujStawki` z guardem `Number.isFinite`.
- Daty ISO w UI (`2026-10-20`) zamiast PL
  → `format.ts`: `formatDataPL()`; użyte w `Sales.tsx`, `Costs.tsx`, `Terminy.tsx` (najbliższe 3 + kalendarz).
- Lighthouse: brak meta description, selecty bez labeli, małe touch-targety, słaby kontrast muted
  → `index.html` meta description; `aria-label` na filtrach (Sales/Costs/Taxes/Integracje/Terminy);
  `styles.css`: muted dark/light podniesione do AA, `min-height` 40/36/32, checkbox 20px.
- Kontrahenci `0 z 0` mimo faktury na Acme — brak syncu z faktur
  → `Contractors.tsx`: `brakujacyZfaktur` + przycisk `Importuj z faktur (N)` + banner + badge `z faktur`.
- JPK/KSeF do pobrania z pustym NIP (`<NIP></NIP>`) — odrzut w MF
  → `Integracje.tsx`: warn przy braku NIP/nazwy, disabled na `Pobierz JPK_V7M/FA(3)`, kopiuj mikrorachunek/NRS.
- „Ile do zapłaty” bez numerów kont
  → `Dashboard.tsx`: mikrorachunek z NIP (z `czyNipPoprawny`) + NRS przy wierszach PIT/ZUS.
- PKD: 20+ checkboxów w 220px bez szukania
  → `Settings.tsx`: filtr tekstowy `pkdQ` z `aria-label`.
- Tort „Gdzie idą pieniądze” tylko 2 wycinki, bez wartości
  → `PodzialSrodkow.tsx`: guard `safe()`, tabela kategorii z kwotą + udziałem % posortowana malejąco.
- Porównywarka pokazywała PIT 0 dla wszystkich form (12 mies. ZUS vs 1 mies. przychodu)
  → `zus.ts`: `rocznyZusForma(..., miesiace=12)`, `pit.ts`: `porownajPelneObciazenie(..., miesiace)`,
  `Porownywarka.tsx`: prop `miesiace` + label `YTD N mies.`, `Taxes.tsx` przekazuje `sums.length`;
  testy YTD w `audit-fixes.test.ts`. Lighthouse po fixach: a11y 1.0 / best 1.0 / SEO 1.0.

- the tiles are narrow, they don't need to be
  → `styles.css`: `.kpi-grid` min 220→250px (280px na ≥1400px), gap 12→14px; kafelki rozciągają się na pełną szerokość.
- on large screens the amount of utilized space is minimal
  → `main` max-width 1220→1500px + centrowanie; `.sections` min 300→340px; breakpoint ≥1400px
  z szerszym paddingiem. Sidebar bez zmian (248px).
