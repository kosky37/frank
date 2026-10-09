UNRESOLVED:

RESOLVED:

KSeF „Sprawdź połączenie” → HTTP 502 na każdym środowisku (2026-10-09):

- **Ścieżki gubiły `/v2`** — `Send()` wysyłał `/auth/challenge` z wiodącym `/`, więc `HttpClient`
  porzucał segment `/v2` z `BaseAddress` i requesty lądowały w `https://api-*.ksef.mf.gov.pl/auth/...`
  zamiast `.../v2/auth/...` (KSeF: 404 → u nas 502). Fix w `KsefClient.cs`: `BaseAddress` z końcowym
  `/` + `TrimStart('/')` w `Send()`. Na żywo: zły URL → 404, poprawny `.../v2/auth/challenge` → 200.
- **`authenticationToken` to obiekt, nie string** — `POST /auth/ksef-token` zwraca 202
  `{ referenceNumber, authenticationToken: { token, validUntil } }`, a klient czytał token
  jak płaski string, więc polling `GET /auth/{ref}` dostałby 401. Fix: odczyt zagnieżdżonego `.token`.
- Polling kończy się od razu na każdym statusie ≥ 400 z opisem MF
  (spec: 415/425/450/460/470/480/500/550), nie tylko 415/425/450.
- Testy: `KsefClientTests.cs` (URL-e z `/v2` na test/demo/prod + pełny przepływ tokenem na
  fałszywym serwerze z self-signed RSA; na starym kodzie 4/4 czerwone, po fixie zielone).
- Dla użytkownika: token działa tylko na środowisku, na którym go wygenerowano
  (test/demo/prod), a NIP firmy w Ustawieniach musi zgadzać się z kontekstem tokenu,
  inaczej KSeF zwróci 450. Do sprawdzenia połączenia i odbioru wystarczą prawa odczytu;
  wysyłka wymaga InvoiceWrite (osobny token).
  Pusty/zły NIP daje teraz jasne 400 `BRAK_NIP` (wcześniej przechodziło aż do MF i wracało jako 502).
- Frontend gubił treść błędu backendu (`req()` w `api.ts` pokazywał tylko `HTTP 400`)
  → `ApiError.message` zawiera teraz `message` z odpowiedzi (`{ code, message }`), więc UI pokazuje
  konkretny powód; testy w `api.test.ts` (z `message` i z pustym body).

Audyt poprawności + przebudowa UI (Batch I, 2026-10-06):

- **Mikrorachunek podatkowy był błędny** — przelewy PIT/VAT poszłyby na nieistniejący rachunek
  → wg MF numer to `LK 10100071 222 Y NIP 00`, gdzie **Y=2 dla NIP**; generator pomijał cyfrę Y
  (`10100071222` + NIP + `000`). Fix w `integrations.ts` `mikrorachunek()` i `MockIntegrations.Mikrorachunek` (C#);
  testy struktury MF w `integrations.test.ts` i `IntegrationsTests.Mikrorachunek_StrukturaMf_Y2Nip`.
  Mimo to przed pierwszym przelewem porównaj numer z generatorem na podatki.gov.pl.
- Kurs NBP dla faktur walutowych: dzień przed sprzedażą pomijał tylko weekendy, nie święta; na 404 brany był
  **najnowszy** kurs (faktura z marca dostawała dzisiejszy kurs) → `nbp.ts`: `dzienPoprzedniRoboczy` pomija święta
  ustawowe (art. 31a VAT — ostatni dzień roboczy), a przy braku tabeli pyta NBP o zakres 10 dni wstecz
  (`zakresDoDnia`) i bierze ostatnie notowanie; „najnowszy kurs” tylko dla dat bieżących/przyszłych.
- Terminy przesuwały się tylko z weekendów, nie ze świąt (np. 20.04 po Wielkanocy, 11.11), i ignorowały
  rozliczenie kwartalne → `lib/terminy.ts`: święta PL (z Wielkanocą, Bożym Ciałem, Wigilią od 2025),
  art. 12 § 5 Ordynacji, PIT/VAT kwartalnie tylko I/IV/VII/X (JPK_V7K co miesiąc jako sama ewidencja), VAT tylko dla vatowca.
- JPK_V7 gubił wiersze z ujemnymi kwotami (faktury korygujące) — warunek `> 0` → `!= 0` w `JpkV7Builder`.
- JPK_V7 odrzucał nabywców z UE (NIP z prefiksem kraju, wpisywane na sztywno `PL`) → `Kontrahent()` rozdziela
  kod kraju i numer, `KodKrajuNadaniaTIN` = prefiks kraju.
- KSeF odmawiał wysłania faktury korygującej, a FA(3) nie miał bloku korekty → `KsefEndpoints`: korygujące
  dopuszczone, `DaneFaKorygowanej` z numerem KSeF oryginału (albo `NrKSeFN`), `TypKorekty`; rachunek z ustawień.
- „Korekta” w Sprzedaży tylko duplikowała fakturę → `szablonKorekty()`: rodzaj korygująca, numer korygowanej,
  ujemne ilości (storno do edycji na różnicę), wyczyszczone KSeF/zapłata; `brakiArt106e` akceptuje ujemne kwoty
  korekty, ale wymaga numeru korygowanej i wartości ≠ 0.
- Pulpit w październiku pokazywał zobowiązania ze stycznia i ujemną prognozę; „na rękę” odejmował VAT
  (który nie jest kosztem) → Pulpit liczy z jednej księgi roku (`rozliczenieRoku`): zaliczki PIT narastająco,
  zdrowotna od dochodu poprzedniego miesiąca, nadwyżka VAT przenoszona; „Do zapłaty” = realne zobowiązania z terminami.
- Tort „Gdzie idą pieniądze” odejmował VAT od przychodu netto → `PodzialSrodkow` bez VAT (VAT to nie Twoje pieniądze).
- Deklaracje ZUS liczyły zdrowotną od dochodu bieżącego miesiąca (powinna od poprzedniego) → wiersze DRA z księgi roku;
  to samo w propozycji KEDU (`ZusEndpoints`).
- Faktury walutowe liczone w walucie, nie w PLN, w PIT/VAT/JPK; proforma trafiała do JPK → przeliczenie po kursie
  z faktury (`TaxEngine`, `JpkEndpoints`, silnik TS), proforma wyłączona.
- Limit zwolnienia VAT 200k/240k pokazywany vatowcom; Koszty pokazywały „VAT do odliczenia” nievatowcom
  (i liczyły koszt PIT jak dla vatowca — bez doliczenia VAT do kosztu) → warunki na `settings.vatowiec`
  (Pulpit, `Costs.tsx`: `deductibleCostPit/deductibleVatCost(c, vatowiec)`).
- „Paliwo 500 zł” jednym klikiem księgował zmyślony koszt 500 zł → zastąpione szablonami (Paliwo, paragon bez NIP,
  abonament, telefon, bank), które otwierają formularz z podpowiedziami; dodane wpisywanie kwoty brutto.
- Sprzęt > 10 000 zł księgowany jako jednorazowy koszt bez ostrzeżenia → ostrzeżenie o środku trwałym
  i odesłanie do zakładki amortyzacji.
- JPK/ZUS domyślnie otwierały ostatni miesiąc z dokumentami zamiast poprzedniego (rozliczanego) → domyślnie poprzedni miesiąc.
- Porównywarka form używała uproszczonego ZUS → liczy pełną księgę roku dla każdej formy (PIT, zdrowotna, społeczne+FP).
- Błędy synchronizacji z API były ciche (dane tylko lokalnie bez informacji) → toast z błędem.

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

- JPK vs przykład MF: brak strefy w dacie, Miesiac z zerem, brak NrKSeF, placeholdery zamiast danych właściciela (2026-10-09):
  → `JpkV7Builder.Naglowek`: `DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ` → `DateTimeOffset.Now:yyyy-MM-ddTHH:mm:ss.fffffffzzz`
  (jak w przykładzie MF `2026-05-13T17:57:05.9611902+02:00` — offset + ułamki zamiast gołego `Z`).
  → `Miesiac` bez wiodącego zera: nowy `NormalizujMiesiac()` (int 1..12 → string), użyty w `ZbudujV7M`/`ZbudujV7K`
  (endpoint przekazywał `"03"` z `RRRR-MM`; przykład MF ma `<Miesiac>3</Miesiac>`; `"03"` przechodzi XSD jako byte,
  ale nie zgadza się ze wzorem MF).
  → `NrKSeF`: regex `WzorNrKsef` był case-sensitive (`[0-9A-F]`) — numery z małymi literami hex z API KSeF
  lądowały w `<BFK>` zamiast `<NrKSeF>`; teraz `IgnoreCase` + normalizacja do `UpperInvariant`
  (XSD `TNumerKSeF` wymaga wielkich A-F). Gdy faktura nie ma (jeszcze) numeru KSeF, `<BFK>1</BFK>` zostaje —
  tak wymaga schemat (choice NrKSeF/OFF/BFK/DI); numer pojawia się po wysyłce do KSeF
  (sprzedaż: `KsefId`, zakupy: `Import z KSeF (nr)` w opisie).
  → Imię/nazwisko/DOB: podgląd JPK wstawiał na sztywno `IMIE/NAZWISKO/1900-01-01`, bo `TaxpayerSettings`
  nie miało pól właściciela. Dodane `WlascicielImie/WlascicielNazwisko/WlascicielDataUrodzenia`
  (encja + kolumny `EnsureColumns` + mapowanie PUT `/api/settings` + typ TS + karta „Dane właściciela”
  w Ustawieniach → Firma i faktury); podgląd bierze je z Ustawień (placeholdery tylko gdy puste, z jawną uwagą),
  wysyłka uzupełnia puste pola formularza z Ustawień, formularz wysyłki je podpiera (placeholder NIP/telefon/kod już były).
  → Testy: `JpkV7_NaglowekMiesiacBezZera_DataZeStrefa_NrKsefWgPrzykladuMf` (numer z przykładu użytkownika
  `1010000000-20200101-000000000000-00` → `<NrKSeF>`, `<Miesiac>3</Miesiac>`, data ze strefą, XSD V7M+V7K),
  `JpkV7_NrKsef_MaleLiteryNormalizowane_FalszyweDoBfk`, `JpkV7_NormalizujMiesiac_OdrzucaSpozaZakresu`;
  `dotnet test` 52 + `bun run test` 126 zielone, `tsc` czyste.

- JPK follow-up: DataWytworzeniaJPK w UTC zamiast PL; brak NrKSeF w ZakupWiersz (2026-10-09):
  → Strefa na sztywno Europe/Warsaw: nowy `JpkV7Builder.CzasPolski()` (IANA na Linuksie/dockerze,
  fallback `Central European Standard Time` na Windows, potem czas lokalny) — `DateTimeOffset.Now`
  w kontenerze dawał +00:00, bo docker chodzi na UTC. Test `JpkV7_DataWytworzenia_WStrefiePolski`
  wymaga `+01:00/+02:00`. Dodatkowo `TZ: Europe/Warsaw` w `docker-compose.yml` (spójne logi).
  → ZakupWiersz: root cause to `c.Opis.Contains("KSeF(")` w `JpkEndpoints` — frontend zapisuje
  `Import z KSeF (nr)` ZE spacją, więc Contains (bez spacji) nigdy nie pasował i numer z opisu
  przepadał (zawsze `<BFK>`). Bramka usunięta — sam regex `WytnijKsef` (`KSeF\s*\(`) wystarcza.
  → Ponadto numer nie powinien mieszkać w opisie: nowa kolumna `CostInvoices.KsefId`
  (encja + DTO + `DtoMapper` + patch `EnsureColumns`), typ TS `ksefId`, odbiór KSeF zapisuje je
  wprost, JPK bierze `KsefId ?? WytnijKsef(Opis)` (fallback dla starych wpisów), edycja kosztu
  przepisuje `ksefId` (wcześniej gubione przy zapisie), duplikowanie je czyści (kopia to inny dokument),
  podgląd kosztu pokazuje `Nr KSeF`. Manualne koszty bez numeru nadal poprawnie dają `<BFK>`.
  → Testy: `JpkEndpoints_WytnijKsef_ZnajdujeNumerZeSpacja` (obie pisownie + fallback + `<NrKSeF>` w XML + XSD);
  `dotnet test` 54 + `bun run test` 126 zielone, `tsc` czyste.

- JPK bez kompletu danych + wyszukiwarka urzędów skarbowych (2026-10-09):
  → Podgląd (`GET /api/jpk/podglad`) nie zwraca już 400 przy pustych ustawieniach: nowy tryb `lagodny`
  w `ZbudujZDb` wstawia jawne placeholdery (NIP `0000000000`, e-mail `brak@przyklad.pl`, kod `0000`,
  IMIE/NAZWISKO/1900-01-01) i zbiera `braki[]` (NIP/e-mail/kod urzędu/imię/nazwisko/DOB z podpowiedzią
  gdzie uzupełnić); odpowiedź zwraca `braki`, a UI pokazuje je wprost po pobraniu
  („Do uzupełnienia przed wysyłką (w pliku są placeholdery): …”). Wysyłka (`POST /api/jpk/wyslij`)
  zostaje twarda (400 `ZLE_DANE`) — to prawdziwa deklaracja do MF, placeholdery nie przejdą.
  → Wyszukiwarka US: `Reference/UrzedySkarbowe.cs` parsuje urzędowy słownik MF
  (`KodyUrzedowSkarbowych_v8-0E.xsd`, ~400 urzędów — ten sam plik, którym XSD sprawdza `<KodUrzedu>`),
  nowy `GET /api/slowniki/urzedy?q=` z fold bez polskich znaków (`lodz`→Łódź, `wroclaw`→Wrocław,
  Ł/ł mapowane jawnie, bo FormD ich nie rozkłada); UI `UrzadLookup.tsx` (podpowiedzi kod—nazwa,
  Enter-wybór, ręczny wpis 4 cyfr, fallback przy braku API) wpięty w Ustawienia → Urzędy
  i w formularz wysyłki JPK (nadpisanie kodu). Test `UrzedySkarbowe_ZSlownikaMf_WyszukiwaniePoMiescieBezZnakow`;
  `dotnet test` 55 + `bun run test` 126 zielone, `tsc` czyste.

- JPK: blokada podglądu przy brakach + naprawa wyszukiwarki US (2026-10-09):
  → Zwrot o 180° na życzenie: przycisk „Pobierz i zwaliduj XML” jest zablokowany, dopóki Ustawienia
  nie mają kompletu (NIP z checksumą, e-mail, kod US 4 cyfry, imię/nazwisko/DOB właściciela) —
  nad przyciskiem wisi lista braków z linkiem do Ustawień + `title` z brakami na przycisku.
  Backendowy tryb łagodny + `braki[]` zostają jako siatka bezpieczeństwa dla wołań spoza UI.
  → Wyszukiwarka US, dwa root causes: (1) `Szukaj("", limit 100)` ucinał listę do pierwszych 100
  wpisów — Warszawa (kody 1431+) w ogóle nie docierała do UI; puste q zwraca teraz pełne ~400.
  (2) `slice(0, 8)` w kolejności pliku spychał Warszawę pod Wałbrzych/Wąbrzeźno/Puławy —
  obie strony (C# `Ranga` + TS `filtrujUrzedy`) sortują teraz: kod od początku, potem pozycja
  w nazwie (`wa` → WARSZAWA pierwsza). (3) Przezroczystość: `background: var(--card)` —
  zmienna nie istnieje (jest `--surface`), więc dropdown był transparentny; teraz klasy `.menu`
  z design systemu (kryjące tło, cień, z-index).
  → Testy: `UrzedySkarbowe_PustaFrazaZwracaWszystkie_WaRankujeWarszawe`, `UrzadLookup.test.ts` (5);
  `dotnet test` 56 + `bun run test` 131 zielone, `tsc` czyste.
