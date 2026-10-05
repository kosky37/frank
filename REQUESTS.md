NEW:

IMPLEMENTED:

- pie chart with how much money went to which tax, how much was saved through deducting costs, how much was ZUS, how much was the net profit
  → `frontend/src/components/PodzialSrodkow.tsx` (tort na Pulpicie): Zysk netto / Koszty / ZUS / PIT / VAT do zapłaty (YTD)
  + nota „dzięki kosztom oszczędzasz X PIT” (PIT bez kosztów − PIT, liczony `pitRoczny` z kosztami=0).
- deklaracje ZUS
  → `frontend/src/components/DeklaracjeZus.tsx` (sekcja w Integracje): miesięczne DRA z XML (`buildZusDraXml`
  z wyliczonym ZUS: zdrowotna od dochodu + wakacje), status robocza/wysłana w localStorage,
  wysyłka do `POST /api/mock/zus/dra` (fallback: oznaczenie lokalne).
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
