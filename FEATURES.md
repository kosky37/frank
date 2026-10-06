# Frank — Funkcje i caveaty księgowo-podatkowe (PL 2026, JDG B2B programista)

> Żywa specyfikacja. Jeśli w trakcie prac wyjdzie inspiracja na nową funkcję —
> dopisz ją tutaj (sekcja `Inbox`) zanim zaczniesz kodować.
> Stan na 2026-10-05. Źródła: MF, ZUS, GUS, KAS (KSeF 2.0, JPK, Biała Lista).

## 0. Dla kogo (persona)

- JDG, zwykle **1 faktura sprzedaży / miesiąc + kilka kosztów** (paliwo, sprzęt, SaaS).
- Chce: wystawić fakturę w 60 s, wrzucić koszt zdjęciem/paragonem, wiedzieć **ile zapłacić
  i do kiedy** (PIT zaliczka, VAT, ZUS), wysłać JPK/KSeF/ZUS bez księgowej,
  a w kwietniu kliknąć „Roczny PIT”.
- Nie chce: pełnego FK, kadr, magazynu, dekretacji. Ma być **prościej niż iFirma/wFirma**,
  nie pełniej.

### Czym wygrywamy z iFirma/wFirma dla tej persony
1. **Zero klików zbędnych**: domyślna sprzedaż 23% / 12% ryczałt / liniowy, kopiuj-poprzedni-miesiąc.
2. **Jasne „ile i do kiedy”**: jeden pasek zobowiązań (PIT+VAT+ZUS) z terminami i numerami kont.
3. **Uczciwe ostrzeżenia**: Biała Lista >15k, MPP, VAT-26, KSeF mikro-pułapka, ex-pracodawca.
4. **Symulator formy opodatkowania** na żywych danych (skala vs liniowy vs ryczałt + danina).
5. **Tryb lokalny**: działa bez backendu (localStorage), sync do API gdy wróci.

---

## 1. Status wdrożenia (2026-10-06)

| Obszar | Działa | Brakuje / do poprawy |
|---|---|---|
| Faktury sprzedaży | CRUD, rodzaje (sprzedaży/korygująca/zaliczkowa/proforma/uproszczona), VAT 23/8/5/0/zw/np/oo, statusy, numeracja + twarda blokada duplikatów, PDF + walidator 106e, waluty+NBP 1-klik, MPP + zał. 15, KSeF online/offline24/awaria | wysyłka produkcyjna KSeF (certyfikat), mail do klienta z cyklicznej |
| Koszty | CRUD, pojazd 50% VAT / 75% PIT / 100% z VAT-26 / 0%, bramka art. 23 + paragon bez NIP, import CSV/WB, preset paliwo, rejestr środków trwałych + amortyzacja, limity aut 2026, ewidencja przebiegu | — |
| PIT miesięczny | skala 12%+ulga 300/mies, liniowy 19% (limit 14 100), ryczałt multi-stawki z prop. ZUS, danina 4% >1M, zaliczki mies./kwart. | — |
| PIT roczny | PIT-36/36L/28 + próg 120k, wspólne rozliczenie (szacunek), IP Box 5%, B+R, zwrot składek (ryczałt), XML + PIT/B + PIT/O + PIT-DS | wysyłka e-Deklaracji (po stronie MF) |
| VAT | należny−naliczony, vatowiec on/off, okres mies/kwart, limit 240k + pro-rata + alert 90%, podsumowanie UE (oo/np) + VIES | — |
| ZUS | schematy z wyliczeniem 1-klik (start/preferencyjny/Mały Plus/duży), zdrowotna 9%/4,9%/tiers + rozliczenie roczne, FP warunkowe 2,45%, wakacje, DRA XML + mock | wysyłka prod (Płatnik/eZUS) |
| KSeF 2.0 | FA(3) z trybami + UPO (mock), odbiór zakupowych, masowa wysyłka, obowiązki 1.02/1.04.2026 + kary 2028 w Terminach | certyfikat prod + ZAW-FA |
| JPK | JPK_V7M/V7K + walidator, JPK_PKPIR/EWP/ST, e-PIT roboczy | XSD MF + podpis (po stronie użytkownika) |
| ZUS DRA | XML + edycja + mock, NRS, kody tytułu, termin 20. | — |
| Rejestry | Biała Lista + KRS + GUS REGON + VIES, NIP checksum, dowody BL + ZAW-NR 7d, CEIDG licznik PKD | auto-mapa PKD 2007→2025 (tablica GUS) |
| Pulpit | KPI + „ile i do kiedy” + „na rękę” (efektywna, marża) + prognoza + tier-alert, tort, porównywarka YTD/XII, kalendarz + iCal/CSV | — |
| Ustawienia | profil + logo, PKD, 10 stawek ryczałtu, pojazd, ZUS 1-klik, klucze (KSeF/GUS/NRS/e-Doręczenia), stawki roczne, backup + CSV | — |

Szczegóły liczb w rozdziale 3 — to jest **kontrakt** dla silnika (`src-shared/tax/*` + `Tax/` w C#).

---

## 2. Lista funkcji (docelowa)

### F1 Sprzedaż (must)
- [x] CRUD faktury, pozycje (nazwa, ilość, netto, VAT, stawka ryczałtu per pozycja)
- [x] Statusy `robocza → wystawiona → w_ksef → oplacona` (robocza NIE wchodzi do PIT/VAT)
- [x] **Automatyczna numeracja** `N/MM/RRRR` + kontynuacja serii, twarda blokada duplikatów (zapis zablokowany + audyt)
- [x] **Faktura korygująca / zaliczkowa / proforma / uproszczona do 450 zł / paragon z NIP** (rodzaj dokumentu + proforma poza PIT/VAT + sync do API)
- [x] **Waluty (EUR/USD)**: kurs NBP 1-klik (średni z dnia roboczego przed sprzedażą), VAT w PLN zawsze (adnotacja kursu na wydruku)
- [x] **MPP**: flaga zał. 15 per faktura + auto-ostrzeżenie powyżej 15 tys. + adnotacja w FA(3) (audyt: brak MPP przy zał. 15 to bloker)
- [x] **PDF / wydruk** + podgląd przed KSeF; walidator 11 pól art. 106e (audyt `art106e`); logo firmy + wariant dark-mode w silniku wydruku
- [x] Termin płatności + **badge „przeterminowana X d”** (licznik dni w Sprzedaży i na Pulpicie)
- [x] Duplikuj miesiąc („kopiuj poprzednią”) — 1 klik dla stałej stawki B2B

### F2 Koszty (must)
- [x] CRUD kosztu, kategorie, `pojazdowy + uzytkowaniePojazdu`
- [x] Pojazd mieszany **50% VAT / 75% PIT**, firmowy 100% (ostrzeżenie bez VAT-26), prywatny 0%
- [x] **Bramka kosztu**: paragon bez NIP → VAT 0 (pole `vatNaliczonyDowolny`), reprezentacja/fines → blokada z art. 23
- [x] **Samochód 2026**: cap amortyzacji/leasingu **EV 225k / <50g 150k / spalinowy 100k** (auta od 2026; starsze 150/225k) + kalkulator + ewidencja przebiegu dla 100% (CSV)
- [x] Import **CSV / wyciąg bankowy** + szybkie „dodaj paliwo 500 zł” (1 klik)
- [x] Amortyzacja jednorazowa / liniowa dla sprzętu (rejestr środków trwałych + odpisy roczne), `JPK_ST`

### F3 PIT (must — serce apki)
- [x] Miesięczna zaliczka: skala / liniowy / ryczałt (multi-stawki, ZUS prop.)
- [x] Roczny: PIT-36 / 36L / 28, próg 120k, kwota zmniejszająca 3 600
- [x] **Porównywarka form** na danych YTD + prognoza do XII (przełącznik w karcie)
- [x] **Danina solidarnościowa 4% >1 000 000** (PIT-DS) — info + doliczenie
- [x] Zaliczki **miesięczne / kwartalne** (mały podatnik, start-up), termin **20.**, mikrorachunek
- [x] Zdrowotna liniowy: odliczenie **do 14 100/rok (2026)** — miesięcznie min(limit−YTD)
- [x] Ryczałt: odliczenie **społeczne + 50% zdrowotnej**; zwrot odliczonych → przychód roku zwrotu (pole w karcie Ulg)
- [x] Skala: zdrowotna **bez odliczenia**; wspólne rozliczenie / samotny rodzic — szacunek dla skali, blokada na liniowym/ryczałcie
- [x] Ulgi: **IP Box 5%** (szacunek + wymóg ewidencji i interpretacji), B+R (odliczenie), ulga na start w PIT (N/A dla B2B — komunikat)

### F4 VAT (must)
- [x] VAT należny−naliczony, nievatowiec → 0
- [x] Limit zwolnienia **240 000 (2026)** + licznik pro-rata dla starterów (`240k/365*dni`), alert 90%
- [x] Rozliczenie mies./kwart. (V7M/V7K — pobieranie XML kwartału), termin **25.**, zapłata = osobny obowiązek
- [x] WDT/WNT/export 0%, VAT-UE, OSS — minimalnie: podsumowanie `oo/np` YTD + check VIES (`/api/rejestry/vies`) + noty VAT-UE/OSS

### F5 ZUS (must)
- [x] Deklaracje DRA per miesiąc (XML + status + wysyłka do mocka, sekcja w Integracje)
- [x] Wakacje składkowe (1 mies./rok bez społecznych+FP, zdrowotna zostaje)
- [x] Kwartalne podsumowania PIT/VAT (ZUS zawsze miesięcznie — tak stanowi prawo)
- [x] Schematy: **ulga na start (6 mies, tylko zdrowotna) → preferencyjny (24 mies, ~456,18 bez FP) → Mały ZUS Plus (36 mies w oknie 60 mies, baza od dochodu, reset puli od 1.01.2026) → duży** + przycisk „Podstaw wyliczenie schematu”
- [x] Zdrowotna: skala **9%**, liniowy **4,9%** (min 432,54), ryczałt **498,35 / 830,58 / 1 495,04** wg przychodu rocznego−społeczne + alert tieru w prognozie + rozliczenie roczne (dopłata DRA-IV do 20 V / zwrot do 1 VI)
- [x] Składkowy rok **II–I** (skala/liniowy) vs kalendarzowy (ryczałt); **styczeń = 314,96**, od II = 432,54
- [x] FP **2,45%** tylko gdy podstawa ≥ płaca min (funkcja + nota); wypadkowa 1,67% (wchodzi w społeczne)

### F6 Deklaracje i wysyłki (must)
- [x] Odbiór faktur zakupowych z KSeF 2.0 + import jako koszty (metadane: numer/NIP/nazwa/netto/VAT/brutto, blokada duplikatów)
- [x] Edytowalne deklaracje: DRA per wiersz (korekty w localStorage, trafiają do KEDU)
- [x] **JPK_V7M(3)/V7K(3)** wg XSD MF (walidacja w backendzie) + wysyłka **danymi autoryzującymi** (bez kwalifikowanego, JDG) → bramka e-Dokumenty, UPO w aplikacji; cel 1/2, nadwyżka na następny okres
- [x] **KSeF 2.0 FA(3)**: wyślij (Sprzedaż + masowo) / odbierz / podgląd XML / sprawdzenie połączenia, nr KSeF + UPO, tryby online/offline24/awaria; **obowiązek odbioru od 1.02.2026, wystawiania od 1.04.2026** (duzi >200M od 1.02); tokeny żyją do 31.12.2026 (przypomnienie o certyfikacie)
- [x] **ZUS DRA → KEDU 5.6** (propozycja z wyliczeń + edycja funduszy/podstaw + walidacja XSD ZUS) → import w Płatniku/ePłatniku, podpis PZ, termin 20., NRS jednym przelewem
- [x] **Roczny e-PIT**: roboczy XML PIT-36/36L/28 + PIT/B + PIT/O (ulgi) + PIT-DS, Twój e-PIT NIE akceptuje ich z automatu (aktywna wysyłka)

### F7 Rejestry i weryfikacje (must)
- [x] Biała Lista (status VAT, REGON, adres) + KRS (e-mail, PKD), NIP checksum
- [x] **Bramka płatności >15 000**: sprawdź Białą Listę w dniu zlecenia, archiwizuj dowód (ID + timestamp, JSON); escape: MPP albo **ZAW-NR w 7 dni** (deadline w podglądzie); od IX.2026 brak sankcji kosztowej PIT, **solidarna VAT zostaje**
- [x] GUS REGON (`/api/rejestry/gus` + klucz BIR + przycisk w Kontrahentach), VIES dla UE (`/api/rejestry/vies` + check w Podatkach); CEIDG: słownik PKD + licznik do 31.12.2026 + link (auto-mapa 2007→2025 wg tablicy GUS — do weryfikacji z urzędem)
- [x] NBP tabela A/C (cache dzienny + proxy + fallback)

### F8 Pulpit / obserwowalność (nice — tu bijemy iFirmę)
- [x] KPI + wykres przychód/koszty/VAT
- [x] Tort „Gdzie idą pieniądze” (PIT/VAT/ZUS/koszty/zysk + oszczędność z kosztów)
- [x] Porównywarka pełnego obciążenia PIT+ZUS+danina (nie tylko PIT)
- [x] **„Ile do zapłaty i do kiedy”**: PIT do 20., ZUS do 20., VAT do 25., roczny do 30 IV, DRA roczna do 20 V
- [x] **Dochód „na rękę”** (przychód − koszty − PIT − ZUS − VAT do zapłaty), efektywna stawka, marża
- [x] Prognoza cashflow do końca roku (ekstrapolacja YTD), alert progu 120k / tieru ryczałt-zdrowotnej / limitu VAT 240k
- [x] Kalendarz terminów + eksport iCal/CSV, powiadomienia w UI (top-3 nadchodzących)

### F9 Dane i niezawodność
- [x] SQLite + EF, seed demo, tryb lokalny localStorage, fire-and-forget sync
- [x] Eksport/import JSON+CSV (faktury/koszty CSV + import kosztów), backup 1-klik, retencja **5 lat docs / 10 lat KSeF** (info w UI)
- [x] `JPK_PKPIR/JPK_EWP + JPK_ST` — trzymaj miesięcznie, wyślesz w 2027 za 2026 (JPK_KR_PD nie dotyczy JDG na KPiR/EWP)
- [x] e-Doręczenia skrzynka (obowiązek CEIDG od 1.10.2026) — adres + status + link w Integracjach

### Inbox (pomysły dopisywane w trakcie)
- [x] Symulator „etat vs B2B” (ZUS pracodawcy vs JDG) — magnes na nowych B2B (zakładka Symulatory)
- [x] Cykliczna faktura (generator zaległych z szablonu; mail do klienta wymaga skrzynki — stub)
- [x] Płatności: kopiuj dane przelewu + status ręczny (stub PSD2 — status z banku wymaga API banku)
- [x] KSeF: masowa wysyłka miesiąca jednym klikiem
- [x] Dark-mode PDF (przełącznik w podglądzie faktury), logo firmy na fakturze (URL w Ustawieniach → nagłówek wydruku)

---

## 3. Caveaty podatkowe 2026 (kontrakt liczbowy)

> Po publikacji obwieszczeń MF/ZUS liczby zmieniaj w `rates2026.ts` + `TaxEngine.cs`
> (testy parzyste `tax.test.ts` ↔ `TaxCalcTests.cs` muszą zostać zielone).

| Parametr | Wartość 2026 | Uwaga |
|---|---|---|
| Płaca minimalna | **4 806** (cały rok) | FP tylko gdy podstawa ≥ to |
| Przeciętne prognozowane | **9 420** → duża baza 60% = **5 652** | społeczne licz od 5 652 |
| Przeciętne IV kw 2025 (GUS 22.01.2026) | **9 228,64** | baza zdrowotnej ryczałt |
| Preferencyjna baza (30% min) | **1 441,80** | |
| Duży ZUS społeczne+chorobowe | emeryt 1 103,27 + rent 452,16 + chor 138,47 + wypad 94,39 = **1 788,29** | +FP 138,47 = **1 926,76** |
| FP+FS | **2,45%** → 138,47 od dużej bazy | tylko podstawa ≥4 806 |
| Zdrowotna min | **I: 314,96 → od II: 432,54** | rok składkowy II–I |
| Zdrowotna skala / liniowy | **9% / 4,9%** dochodu, min jak wyżej | skala: brak odliczenia |
| Zdrowotna ryczałt | **498,35 / 830,58 / 1 495,04** (≤60k / ≤300k / >300k przychodu−społeczne) | podbicie w roku + rozliczenie roczne |
| Liniowy limit zdrowotnej | **14 100/rok** (nie 12 900) | miesięcznie: min(zdr, limit−YTD) |
| Skala | **12% do 120 000, 32% powyżej**, kwota zmn. **3 600**, wolna **30 000** | zaliczka: 12% −300/mies, 32% rocznie |
| Liniowy | **19%**, brak kwoty wolnej, brak wspólnego | PIT-36L + PIT/B |
| Ryczałt IT | **12%** (PKWiU 62.01/62.02/62.03.1); 8,5% tester/koordynacja; 15% licencje/hosting z przetwarzaniem; pełne 10 stawek art. 12 | **stawka z PKWiU czynności, nie z PKD ani nazwy stanowiska**; multi-stawki per pozycja; bez ewidencji wg stawek US przyjmie min. 8,5% |
| Ryczałt limit wejścia | **2M € = 8 517 200** (przychód 2025) | kwartalne zaliczki gdy ≤200k € |
| Danina solidarnościowa | **+4% powyżej 1 000 000** dochodu | PIT-DS do rocznego |
| VAT standard | 23% (dev B2B); zwrot z faktur zakupowych po korekcie pojazdowej | nievatowiec → VAT 0, ale brak odliczeń |
| Limit zwolnienia VAT | **240 000** (od 1.01.2026), pro-rata `240k/365*dni` | IT **może** korzystać (nie z art. 113(13)); alert 90% |
| JPK_V7 | M mies / K kwart (ewid. mies + dek. kwart), termin **25.** | zapłata VAT też do 25., przelew osobno |
| PIT zaliczka / ryczałt | **20.** następnego mies./kwart. na **mikrorachunek** | brak deklaracji miesięcznej |
| ZUS DRA + przelew | **20.** (os. prawne 15., budżet 5.), **1 NRS** | weekend → następny roboczy |
| PIT roczny | **15 II – 30 IV**, podatek do 30 IV; złożony przed 15 II = złożony 15 II | Twój e-PIT auto-akceptuje tylko 37/38 — 36/36L/28 wyślij aktywnie |
| Zdrowotna roczna | DRA IV do **20 V**, wniosek o zwrot do **1 VI** | nadpłata nie wraca sama |
| Pojazd mieszany | **VAT 50%, PIT 75%** (z netto + 50% nieodliczonego VAT) | bez VAT-26, bez ewidencji |
| Pojazd 100% | VAT-26 do **25. mies. po I wydatku** + ewidencja + regulamin; 1 km prywatnie = utrata | UI: twardy warning bez VAT-26 |
| Auta od 2026 cap | **EV/wodór 225k, <50g 150k, spalinowe 100k** | starsze: 150/225k; sprzedaż zawsze 23% VAT |
| KSeF 2.0 | odbiór wszyscy od **1.02.26**, wystawianie od **1.04.26** (duzi od 1.02); mikro ≤10k/mies do 31.12.26; tokeny do 31.12.26, potem certyfikaty; kary od **1.01.28** | faktura = wysłana do KSeF (nie wydrukowana); offline24 = data z dokumentu |
| Biała Lista >15k | sprawdź w dniu zlecenia; escape **MPP lub ZAW-NR 7 dni** | od IX.26 brak sankcji PIT-kosztowej, VAT solidarny zostaje |
| CEIDG PKD | 2007→**2025 do 31.12.26**, potem auto-reklasyfikacja | nigdy nie wywódź ryczałtu z PKD |
| KPiR od 1.01.26 | tylko elektronicznie, nowy wzór, link do KSeF ID; trzymaj `JPK_PKPIR+ST` | pierwsza wysyłka w 2027 za 2026 |
| Dokumenty | faktura do **15. nast. mies.**; paragon+NIP do 450 zł; faktury w walucie: VAT po kursie NBP z dnia rob. przed sprzedażą | archiwum 5 lat (KSeF 10 lat) |

### Pułapki implementacyjne (checklist dla kodu)
1. Styczeń ≠ reszta roku (zdrowotna min), rok składkowy II–I vs kalendarzowy.
2. Trzy różne podstawy: PIT ≠ zdrowotna ≠ VAT — nie mieszaj.
3. Kumulacje: dochód YTD (próg 120k, zaliczki), przychód YTD (tier ryczałt-zdrowotnej, limit VAT 240k, Mały ZUS 120k).
4. Multi-stawki ryczałtu per pozycja + proporcjonalny ZUS (art. 15).
5. Ex-pracodawca B2B: brak ulg ZUS + ryzyko etatu (PIP) — warning w onboardingu.
6. Mikro-KSeF 10k: 1 przekroczenie = trwały KSeF — nie proponuj obchodzenia.
7. Certyfikaty przed 31.12.2026 (tokeny umierają) — przypomnienie w UI od XI.
8. Zwrot odliczonego ZUS → przychód roku zwrotu (ryczałt).

---

## 4. Integracje zewnętrzne — co trzeba, klucze i mocki

Zasada: **wszystko konfigurowalne**. Sekrety użytkownika → UI (Ustawienia → Integracje,
localStorage + `/api/settings`, nigdy do repo). Sekrety wdrożenia → env (`docker-compose.yml`).

| Integracja | Produkcja — co potrzebne | Mock w repo | Status |
|---|---|---|---|
| **KSeF 2.0** (write+read) | token KSeF (do 31.12.26) → potem **certyfikat KSeF / pieczęć + ZAW-FA**; NIP; środowiska test/demo/prod. Jak uzyskać: Aplikacja Podatnika → logowanie Profilem Zaufanym (jednorazowo) → Ustawienia → Tokeny → generuj (InvoiceWrite+InvoiceRead) → wklej w Integracjach. | `POST /api/ksef/wyslij` (FA(3) XML + AES/RSA, sesja online, nr KSeF + UPO), `GET /api/ksef/podglad`, `POST /api/ksef/odbior` (metadane zakupów → koszty), `POST /api/ksef/sprawdz`; mocki `/api/mock/ksef/*` zostają jako fallback | **działa (test/demo/prod)** |
| **JPK_V7M(3)/V7K(3)** | **dane autoryzujące** (NIP/PESEL + imię + nazwisko + data urodzenia + przychód sprzed 2 lat; tylko JDG, bez kwalifikowanego) albo podpis kwalifikowany; bramka `e-dokumenty.mf.gov.pl`; UPO. | `GET /api/jpk/podglad` (XML z bazy + walidacja XSD MF 14090/14089), `POST /api/jpk/wyslij` (ZIP+AES+RSA+InitUpload+AuthData → PUT → Finish → Status/UPO), `GET /api/jpk/status/{ref}`; XSD + klucze MF w `Schemas/` i `Keys/` | **działa (test/prod)** |
| **ZUS DRA / eZUS** | konto PUE/eZUS + **NRS** (przelew), kod tytułu (05 40 / 05 70 / 05 90 / 05 10). ZUS **nie ma API** do wysyłki — model plikowy jak wFirma/inFakt. Jak: pue.zus.pl → rejestracja → import KEDU w Płatniku/ePłatniku → podpis PZ → wyślij do 20. | `GET /api/zus/kedu-propozycja` (wartości z wyliczeń) + `POST /api/zus/kedu` (KEDU 5.6 + walidacja XSD ZUS); UI: edycja funduszy/podstaw + pobranie + instrukcja importu | **działa (eksport KEDU)** |
| **e-Urząd / mikrorachunek** | NIP → generator mikrorachunku (Luhn-like MF, liczony lokalnie, bez klucza). Podatek tylko przelewem na mikrorachunek. | liczone lokalnie + test, link „zapłać w banku” | brak → **do dodania** |
| **Biała Lista VAT** | bez klucza (limit 100/dzień `search`), prod: `wl-api.mf.gov.pl`. | już działa; dodać **cache + dowód sprawdzenia** (timestamp+ID) + bramkę >15k | działa |
| **KRS odpis** | bez klucza (`api-krs.ms.gov.pl`), wzbogaca o e-mail/PKD | działa | działa |
| **GUS REGON (BIR)** | klucz API GUS (`api.stat.gov.pl`, darmowy po rejestracji, sid w nagłówku) → pole w Ustawieniach | mock zwraca przykładowy podmiot; testy na fixture | brak → **do dodania** |
| **CEIDG** | bez klucza (wyszukiwarka), PKD 2025 słownik GUS | link + słownik PKD w `Slowniki` | częściowo |
| **NBP kursy** | bez klucza (`api.nbp.pl`), cache 24h | `GET /api/nbp/kurs?waluta&data` (proxy+cache), fallback tabela | brak → **do dodania** |
| **Twój e-PIT** | profil zaufany / mObywatel; PIT-36/36L/28 tylko aktywnie | eksport XML + instrukcja krok-po-kroku w wizardzie | stub → **do dodania** |
| **e-Doręczenia** | skrzynka `edoreczenia.gov.pl` (obowiązek CEIDG od 1.10.26) | status-link w Ustawieniach | brak → **do dodania (link)** |

Szczegółowe „klik-po-kliku jak uzyskać dostęp” → **`docs/INTEGRACJE.md`** (do napisania w Batch B).

---

## 5. Plan dojścia do „świetne” (kolejność)

- [x] Batch 0 — scaffold, dual-engine, rejestry, stuby (jest)
- [x] **Batch A — prawda podatkowa**: stawki ZUS 2026 (duży 1 926,76 / FP 138,47 / zdrow. min 432,54+I 314,96), zdrowotna tiers ryczałtu 498/831/1495, limit liniowy 14 100, danina 4% >1M, VAT 240k, art. 23, testy parzyste 19/22
- [x] **Batch B — prawdziwe deklaracje**: JPK_V7M wg schematu MF (Ewidencja+Deklaracja), FA(3)-like KSeF, DRA XML, mocki KSeF/ZUS (`/api/mock/*`), mikrorachunek (`/api/mikrorachunek`), NBP proxy+cache (`/api/nbp/kurs`), `docs/INTEGRACJE.md` z instrukcjami kluczy
- [x] **Batch C — UX 1-fakturowego**: „ile i do kiedy” (PIT 20./ZUS 20./VAT 25./roczny 30 IV), „na rękę”, pasek limitu VAT 240k, porównywarka form, Terminy 2026, schematy ZUS w Ustawieniach (start/preferencyjny/Mały Plus/duży), okres VAT + zaliczki kwartalne
- [x] **Batch D — fakturowanie**: auto-numeracja N/MM/RRRR, kopiuj-poprzedni-miesiąc, korekty, waluty+NBP, MPP+rachunek+Biała Lista (>15k), art. 23, paragon-bez-NIP, import CSV kosztów, eksport CSV kontrahentów
- [x] **REQUESTS (7)**: tort podziału środków, deklaracje ZUS, rozliczenia kwartalne, kalendarz terminów 2025–27 z odhaczaniem, porównywarka PIT+ZUS+danina, stawki roczne jednym klikiem (`/api/slowniki/stawki`), wakacje składkowe
- [x] **Batch E — polerowanie: onboarding (kreator 4-krokowy, `Onboarding.tsx`), PDF faktury (wydruk art. 106e → „Zapisz jako PDF”, `fakturaHtml`), masowa wysyłka KSeF miesiąca (`KsefMasowa.tsx`), iCal terminów (`buildIcs` + Eksport w `Terminy.tsx`), backup 1-klik (JSON eksport/import z walidacją, `Backup.tsx`), checklista „audyt przed wysyłką” (`Audyt.tsx` + `audytPrzedWysylka`: NIP/duplikaty/bramka 15k/VAT-26/KSeF), testy `batchE.test.ts` (13 testów)
- [x] **Batch F — audyt 2026-10-06 (NaN + standard): `zusFpMies→zusFPMies` (backend `JsonPropertyName` + frontend normalizacja + guardy `round2`/`fmtMoney`), PIT roczny YTD zamiast ×12 (`Dashboard`/`Taxes` + `naReke` YTD + tort z tabelą + Porównywarka YTD `miesiace`), `stawki` FP casing, daty PL (`formatDataPL`), a11y/kontrast/touch-targety (lighthouse 1.0/1.0/1.0), import WB (`parseBankCsv`) + foto paragonu (localStorage), import kontrahentów z faktur, walidacja JPK/NIP + mikrorachunek/NRS z kopiowaniem, szukajka PKD; testy `audit-fixes.test.ts` (7), `dotnet test` 23 + `bun run test` 62 zielone
- [x] Batch F — szybkie wygrane: twarda blokada duplikatów numerów, badge „po terminie X d”, kurs NBP 1-klik w fakturze, walidator 11 pól art. 106e w audycie, preset „Paliwo 500 zł”, limit VAT pro-rata dla starterów, pobieranie JPK_V7K kwartału, efektywna stawka + marża, prognoza YTD→XII z alertem tieru zdrowotnej, eksport CSV terminów, logo firmy + dark-mode w silniku wydruku (`quickwins.ts`, `quickwins.test.ts` 15 testów, `buildJpkV7K` + 2 testy)
- [x] Batch G — reszta must-have: rodzaje faktur (korygująca/zaliczkowa/proforma/uproszczona, proforma poza PIT/VAT, sync pól do API + kolumny + proforma w `TaxAggregator`), zał. 15 + tryby KSeF w FA(3)/mocku, schematy ZUS 1-klik + FP warunkowe + rozliczenie zdrowotnej, ulgi (wspólne/IP Box/B+R/zwrot) + e-PIT z PIT/B/O/DS, VIES + GUS BIR (endpointy + testy), JPK_PKPIR/EWP/ST + walidator, rejestr amortyzacji + limity aut + ewidencja przebiegu, dowody BL + ZAW-NR, CSV faktur/kosztów, UE/VIES, etat-vs-B2B + cykliczne + przelew-stub + dark-toggle, ex-pracodawca w onboardingu, CEIDG-licznik, e-Doręczenia-status (`majatek.ts`, `Ulgi.tsx`, `UeVies.tsx`, `EtatVsB2b.tsx`, `Cykliczne.tsx`, `Majatek.tsx`; `dotnet test` 28 + `bun run test` zielone)
- [x] **Batch H — prawdziwe wysyłki (bez kwalifikowanego, 2026-10-06)**: KSeF 2.0 tokenem (PZ jednorazowo przy generowaniu tokenu) — `KsefClient` (challenge→token→sesja online→FA(3)→UPO) + `Fa3Builder` (XSD MF FA(3) 1-0E, walidacja strict offline) + endpointy `/api/ksef/*` (wyślij/podgląd/odbiór metadanych/UPO/sprawdź) + UI (wyślij z Sprzedaży/masowo, podgląd XML, sprawdzenie połączenia, odbiór metadanych → koszty); JPK_V7M(3)/V7K(3) wg XSD MF (14090/14089, kwoty w groszach, BFK/NrKSeF, paragony bez NIP pomijane z raportem) — `JpkV7Builder` + `JpkGateway` (ZIP+AES+RSA+InitUpload+AuthData → PUT → Finish → Status/UPO) + endpointy `/api/jpk/*` + formularz danych autoryzujących (niezapisywane); ZUS DRA → **KEDU 5.6** (`ZusKeduBuilder` + XSD ZUS + `/api/zus/*` + panel eksportu z propozycją, korekty DRA trafiają do KEDU) — ZUS nie ma API do wysyłki, import w Płatniku/ePłatniku + podpis PZ; XSD offline (`XsdWalidator`); `dotnet test` 39 + `bun run test` 93 zielone

Kryterium „gotowe”: `dotnet test` + `bun run test` zielone, faktura wystawiona w <60 s,
miesięczne rozliczenie (PIT+VAT+ZUS z terminami i kwotami do przelewu) bez kalkulatora obok.
