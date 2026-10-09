NEW:

- Prawdziwy OCR paragonów (zdjęcie → pozycja kosztowa bez ręcznego przepisywania)
- PSD2 / automatyczna rekoncyliacja bankowa (statusy zapłat z banku, nie tylko CSV)
- Multi-user / auth + RODO (obecnie każdy z URL widzi dane firmy)
- Wysyłka KSeF certyfikatem KSeF (po 31.12.2026 tokeny umierają) + UPO; wysyłka JPK podpisem
  kwalifikowanym (dla spółek / nie-JDG); wysyłka e-PIT (PIT-36/36L/28)
  (zrobione w Batch H: KSeF tokenem + JPK danymi autoryzującymi; reszta wymaga certyfikatów użytkownika)
- Kadry/płace, magazyn, pełne FK — out of scope dla persony 1-fakturowego (celowo nie będzie)

IMPLEMENTED:

- ikona aplikacji (favicon)
  → `frontend/public/favicon.svg` (gradient indygo→fiolet + białe „F” + zielony akcent, spójne z `.brand-logo`)
  + PNG fallbacki (`favicon-16x16/32x32`, `apple-touch-icon` 180, `android-chrome` 192/512) i `favicon.ico`
  (raster z tej samej geometrii, skrypt bez zależności w temp); `site.webmanifest` + `theme-color`;
  linki w `frontend/index.html` (ścieżki względne `./` — działają w dev, dist i wwwroot Dockera bez zmian backendu).

- dopracowanie aplikacji jako zamiennika iFirmy/wFirmy: sprawdzenie poprawności, brakujące funkcje, lepszy UX/UI (2026-10-06)
  → Batch I w `FEATURES.md`. Poprawki poprawności opisane w `BUGS.md` (m.in. zły mikrorachunek, kurs NBP w święta,
  korekty w KSeF/JPK, zdrowotna od poprzedniego miesiąca). Nowe: dane przelewu przy każdym zobowiązaniu
  (mikrorachunek/NRS + tytuł MF), terminy ze świętami i trybem kwartalnym, prawdziwa faktura korygująca, e-mail do klienta,
  domyślny rachunek/termin płatności, szablony kosztów + kwota brutto, globalny wybór roku. UI: nowy design system,
  sidebar z licznikami, routing w URL, szuflada faktury, zakładki na stronach Podatki/e-Urząd/Koszty/Ustawienia, mobile.

- pobieranie faktur z ksef
  → `KsefOdbior.tsx` + `POST /api/ksef/odbior` (metadane KSeF 2.0: numer, NIP/nazwa sprzedawcy,
  netto/VAT/brutto, waluta); przycisk „Pobierz faktury z KSeF”, statusy nowa/zaksięgowana,
  import jednym klikiem jako koszt, blokada duplikatów po numerze. Token z Aplikacji Podatnika
  (PZ jednorazowo) wystarcza — certyfikat dopiero po 31.12.2026. Środowiska test/demo/prod.
- wypełnianie deklaracji, edycja deklaracji ZUS i VAT/JPK
  → kwoty DRA edytowalne per wiersz (społeczne/zdrowotna/FP, `DeklaracjeZus.tsx`,
  korekty w localStorage `frank-korekta-dra`, badge „korekta” + „Cofnij”); korekty zdrowotnej/FP
  trafiają do eksportu KEDU. JPK budowany z bazy przez backend (podgląd + XSD + wysyłka),
  paragony bez NIP pomijane z raportem.

- wartosci na torcie + eksport CSV kontrahentów
- import wyciągu bankowego (WB) do kosztów
  → `parseBankCsv()` w `Costs.tsx`: format `data;opis;kwota` (mBank/ING/PKO, `;`/`,`), ujemne = wydatki → netto=|kwota|,
  wpływy pomijane, VAT 23% do ręcznej weryfikacji; przycisk `Import CSV / WB` z autowykrywaniem
  (najpierw próba `parseCostsCsv`, fallback `parseBankCsv`); testy w `audit-fixes.test.ts`.
- zdjęcie paragonu/faktury kosztowej
  → `FotoKosztu` w `Costs.tsx`: input `image/*`, downscale do 1200px JPEG 0.8, localStorage `frank-cost-photos`,
  miniatura w podglądzie kosztu + `Pobierz zdjęcie`; brak wysyłki do API (offline-first).
- import kontrahentów z faktur
  → `Contractors.tsx`: `brakujacyZfaktur` (NIP z faktur spoza bazy) + `Importuj z faktur (N)` + banner przy pustej bazie,
  badge `z faktur` w tabeli.
- polskie daty w UI
  → `formatDataPL()` w `format.ts` (ISO → DD.MM.RRRR); użyte w Fakturach, Kosztach, Terminach.
- dostępność i kontrast (lighthouse)
  → meta description, `aria-label` na selectach/filtrach, `min-height` touch-targetów,
  muted AA w obu motywach; kontrast badge poprawiony.
- mikrorachunek i NRS przy zobowiązaniach
  → Pulpit „Ile do zapłaty”: mikrorachunek z NIP przy PIT + NRS przy ZUS;
  Integracje: `Kopiuj` do schowka dla obu, hinty przy braku NIP/NRS.
- walidacja JPK/KSeF przed pobraniem + tabela tortu
  → Integracje blokują `JPK_V7M/FA(3)` bez poprawnego NIP firmy; `PodzialSrodkow`: tabela kwot + udziałów %.
- wyszukiwarka PKD w Ustawieniach
  → pole filtrujące `62.01 / oprogramowanie` nad listą checkboxów.
- pie chart with how much money went to which tax, how much was saved through deducting costs, how much was ZUS, how much was the net profit
  → `frontend/src/components/PodzialSrodkow.tsx` (tort na Pulpicie): Zysk netto / Koszty / ZUS / PIT / VAT do zapłaty (YTD)
  - nota „dzięki kosztom oszczędzasz X PIT” (PIT bez kosztów − PIT, liczony `pitRoczny` z kosztami=0).
- deklaracje ZUS
  → `frontend/src/components/DeklaracjeZus.tsx` (sekcja w Integracje): miesięczne DRA
  (zdrowotna od dochodu + wakacje), status w localStorage, panel **Eksport KEDU 5.6**
  (`GET /api/zus/kedu-propozycja` + `POST /api/zus/kedu`, walidacja XSD ZUS):
  podział na fundusze, podstawy, blok XI; import w Płatniku/ePłatniku, podpis PZ, wysyłka do 20.
- wysyłka KSeF FA(3) i JPK_V7M(3)/V7K(3) bez podpisu kwalifikowanego (Batch H)
  → `POST /api/ksef/wyslij` (FA(3) XML + szyfrowanie + sesja online, nr KSeF + UPO;
  wyślij z faktury i masowo), `GET /api/ksef/podglad` (XSD MF), `POST /api/ksef/sprawdz`;
  `GET /api/jpk/podglad` + `POST /api/jpk/wyslij` danymi autoryzującymi (NIP/PESEL + imię +
  nazwisko + data urodzenia + przychód sprzed 2 lat; JDG; dane niezapisywane) + UPO;
  XSD offline (`XsdWalidator`, schematy MF/ZUS w `backend/Frank.Api/Schemas/`).
  Testy: `IntegrationsTests.cs` (FA3/JPK/KEDU strict XSD) — `dotnet test` 39 zielone.
- kwartalne rozliczanie składek
  → `aggregateQuarter()` w `pit.ts` + tabela „Rozliczenie kwartalne” w Podatki (PIT/VAT szac. per Q1–Q4
  z terminami 20./25. po kwartale); ZUS zostaje miesięczny do 20. (tak stanowi prawo — dopisane w UI);
  tryb kwartalny wybierasz w Ustawieniach (zaliczka PIT, okres VAT → JPK_V7K).
- kalendarz z terminami płatności, deklaracji
  → `Terminy.tsx` przebudowany na kalendarz 2025/2026/2027: generowane terminy PIT 20. / ZUS 20. / VAT 25.
  (weekendy przesunięte na poniedziałek) + zdarzenia roczne (PIT 15II–30IV, DRA roczna 20V, KSeF, e-Doręczenia, PKD);
  odhaczanie opłaconych (localStorage), „najbliższe 3” tylko nieodhaczone.
- porównanie ile wyniosłyby moje podatki i składki przy innej formie opodatkowania
  → `porownajPelneObciazenie()` w `pit.ts` + nowa `Porownywarka`: kolumny PIT / ZUS (rok) / danina / RAZEM,
  ZUS liczony regułami formy (skala 9%, liniowy 4,9%, ryczałt tier z przychodu), badge „najniższe”.
- automatyczne pobieranie wysokości skłądaek/ wartości podatków w danym roku
  → tabela `RATES_2025`/`RATES_2026` + `stawkiNaRok()` (TS) i `Slowniki.Stawki` + `GET /api/slowniki/stawki?rok=` (C#);
  karta „Stawki na rok” w Ustawieniach: pobiera z API z fallbackiem lokalnym i podstawia duży ZUS jednym klikiem.
  Kursy walut już wcześniej same z NBP (`/api/nbp/kurs` + cache).
- wakacje składowe
  → pole `wakacjeSkladkoweMiesiac` (ustawienia + kolumna DB + API): wybrany miesiąc ma zerowe społeczne + FP
  (zdrowotna zostaje, zgodnie z ustawą) — w `zusMiesieczny`, `aggregateMonth`, `TaxAggregator`, DRA i rocznym ZUS
  (11 zamiast 12 mies.). Badge „wakacje” w deklaracjach ZUS. Testy TS + C#.
