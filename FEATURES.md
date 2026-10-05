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

## 1. Status wdrożenia (2026-10-05)

| Obszar | Działa | Brakuje / do poprawy |
|---|---|---|
| Faktury sprzedaży | CRUD, VAT 23/8/5/0/zw/np/oo, statusy, KSeF stub | numeracja automatyczna, korekty, duplikaty, PDF, waluty+NBP, aneks 15/MPP flaga |
| Koszty | CRUD, pojazd 50% VAT / 75% PIT / 100% z VAT-26 / 0% | import CSV/paragon, limity amortyzacji 2026 (225/150/100k), rata leasingu rozbicie |
| PIT miesięczny | skala 12%+ulga 300/mies, liniowy 19%, ryczałt 12%+multi-stawki z prop. ZUS | **stawki ZUS 2025, nie 2026**; zdrowotna ryczałt tiers; limit liniowy 14 100 nie 12 900; danina 4% >1M; zaliczki kwartalne |
| PIT roczny | PIT-36/36L/28 + próg 120k | wizard z załącznikami (PIT/B,O,D), ulgi (IP Box 5%, B+R), wspólne rozliczenie — blokada dla liniowego |
| VAT | należny−naliczony, vatowiec on/off, okres mies/kwart | limit zwolnienia **240k** (nie 200k), mały podatnik, VAT-UE, korekta roczna, split payment |
| ZUS | społeczne+zdrowotna+FP z ustawień | **kwoty 2026**: duży 1 926,76 (FP 138,47), zdrow. min 432,54 od II; schematy: start/preferencyjny/Mały ZUS Plus 36m w 60m/duży; ryczałt 498/830/1495; rozliczenie roczne IV/DRA do 20 V, zwrot do 1 VI |
| KSeF 2.0 | stub JSON z listy faktur | FA(3) schema, token→certyfikat od 2027, tryby offline24/awaria, UPO, odbiór zakupowych, obowiązki 1.02/1.04.2026, kary od 2028 |
| JPK | stub JPK_V7M | **prawdziwy JPK_V7M wg XSD MF v2**, JPK_PKPIR/EWP/KR_PD+ST (obowiązek wysyłki od 2027 za 2026), walidacja XSD |
| ZUS DRA | stub JSON | XML Płatnik/eZUS, NRS, kod tytułu (05 40/05 90/duży), termin 20. |
| Rejestry | Biała Lista + KRS (adres, e-mail, PKD), NIP checksum | GUS REGON, CEIDG PKD 2007→2025 (deadline 31.12.2026), archiwizacja dowodu sprawdzenia, bramka >15k + ZAW-NR 7d |
| Pulpit | KPI + recharts | kalendarz terminów, „na rękę”, prognoza cashflow, efektywna stawka, porównywarka form |
| Ustawienia | profil, PKD, 10 stawek ryczałtu, pojazd, ZUS edytowalne | klucze integracji (KSeF token, certyfikat, e-Urząd), NBP cache, e-Doręczenia od 1.10.2026 |

Szczegóły liczb w rozdziale 3 — to jest **kontrakt** dla silnika (`src-shared/tax/*` + `Tax/` w C#).

---

## 2. Lista funkcji (docelowa)

### F1 Sprzedaż (must)
- [x] CRUD faktury, pozycje (nazwa, ilość, netto, VAT, stawka ryczałtu per pozycja)
- [x] Statusy `robocza → wystawiona → w_ksef → oplacona` (robocza NIE wchodzi do PIT/VAT)
- [ ] **Automatyczna numeracja** `N/MM/RRRR` + kontynuacja serii, blokada duplikatów
- [ ] **Faktura korygująca / zaliczkowa / proforma / uproszczona do 450 zł / paragon z NIP**
- [ ] **Waluty (EUR/USD)**: kurs NBP średni z dnia roboczego przed sprzedażą, VAT w PLN zawsze
- [ ] **MPP**: auto-dopiska gdy pozycja z zał. 15 + brutto >15 000 (typowy dev: zwykle OFF, ale flaga musi być)
- [ ] **PDF / wydruk** + podgląd przed KSeF; 11 pól art. 106e (walidator braków)
- [ ] Termin płatności + **przypomnienie o nieopłaconej** (badge „przeterminowana X d”)
- [ ] Duplikuj miesiąc („kopiuj poprzednią”) — 1 klik dla stałej stawki B2B

### F2 Koszty (must)
- [x] CRUD kosztu, kategorie, `pojazdowy + uzytkowaniePojazdu`
- [x] Pojazd mieszany **50% VAT / 75% PIT**, firmowy 100% (ostrzeżenie bez VAT-26), prywatny 0%
- [ ] **Bramka kosztu**: paragon bez NIP → VAT 0 (pole `vatNaliczonyDowolny`), reprezentacja/fines → blokada z art. 23
- [ ] **Samochód 2026**: cap amortyzacji/leasingu **EV 225k / <50g 150k / spalinowy 100k** (auta od 2026; starsze 150/225k), ewidencja przebiegu dla 100%
- [ ] Import **CSV / wyciąg bankowy** + szybkie „dodaj paliwo 500 zł”
- [ ] Amortyzacja jednorazowa / liniowa dla sprzętu (laptop >10k), `JPK_ST`

### F3 PIT (must — serce apki)
- [x] Miesięczna zaliczka: skala / liniowy / ryczałt (multi-stawki, ZUS prop.)
- [x] Roczny: PIT-36 / 36L / 28, próg 120k, kwota zmniejszająca 3 600
- [ ] **Porównywarka form** na danych YTD + prognoza do XII (killer feature vs iFirma)
- [ ] **Danina solidarnościowa 4% >1 000 000** (PIT-DS) — info + doliczenie
- [ ] Zaliczki **miesięczne / kwartalne** (mały podatnik, start-up), termin **20.**, mikrorachunek
- [ ] Zdrowotna liniowy: odliczenie **do 14 100/rok (2026)** — miesięcznie min(limit−YTD)
- [ ] Ryczałt: odliczenie **społeczne + 50% zdrowotnej**; zwrot odliczonych → przychód roku zwrotu
- [ ] Skala: zdrowotna **bez odliczenia**; wspólne rozliczenie / samotny rodzic (blokada na liniowym)
- [ ] Ulgi: **IP Box 5%** (ewidencja IP + interpretacja), B+R, ulga na start w PIT (N/A dla B2B — komunikat)

### F4 VAT (must)
- [x] VAT należny−naliczony, nievatowiec → 0
- [ ] Limit zwolnienia **240 000 (2026)** + licznik pro-rata dla starterów, alert 90%
- [ ] Rozliczenie mies./kwart. (V7M/V7K), termin **25.**, zapłata = osobny obowiązek
- [ ] WDT/WNT/export 0%, VAT-UE, OSS — minimalnie (dev z klientem UE: `oo/np` + VIES check)

### F5 ZUS (must)
- [x] Deklaracje DRA per miesiąc (XML + status + wysyłka do mocka, sekcja w Integracje)
- [x] Wakacje składkowe (1 mies./rok bez społecznych+FP, zdrowotna zostaje)
- [x] Kwartalne podsumowania PIT/VAT (ZUS zawsze miesięcznie — tak stanowi prawo)
- [ ] Schematy: **ulga na start (6 mies, tylko zdrowotna) → preferencyjny (24 mies, ~456,18 bez FP) → Mały ZUS Plus (36 mies w oknie 60 mies, baza od dochodu, reset puli od 1.01.2026) → duży**
- [ ] Zdrowotna: skala **9%**, liniowy **4,9%** (min 432,54), ryczałt **498,35 / 830,58 / 1 495,04** wg przychodu rocznego−społeczne (podbicie tieru w trakcie roku + rozliczenie roczne)
- [ ] Składkowy rok **II–I** (skala/liniowy) vs kalendarzowy (ryczałt); **styczeń = 314,96**, od II = 432,54
- [ ] FP **2,45%** tylko gdy podstawa ≥ płaca min; wypadkowa 1,67% (samodzielny)

### F6 Deklaracje i wysyłki (must)
- [x] Odbiór faktur zakupowych z KSeF + import jako koszty (demo fixtures, blokada duplikatów)
- [x] Edytowalne deklaracje: DRA per wiersz + JPK_V7M per miesiąc (korekty w localStorage, XML po korekcie)
- [ ] **JPK_V7M/V7K** wg XSD MF + podpis kwalifikowany → e-Urząd; podgląd XML + walidacja
- [ ] **KSeF 2.0 FA(3)**: wyślij/odbierz, nr KSeF + UPO, offline24/awaria/korekta; **obowiązek odbioru od 1.02.2026, wystawiania od 1.04.2026** (duzi >200M od 1.02); tokeny żyją do 31.12.2026
- [ ] **ZUS DRA** XML → eZUS/Płatnik, termin 20., NRS jednym przelewem
- [ ] **Roczny e-PIT**: XML PIT-36/36L/28 + załączniki, Twój e-PIT NIE akceptuje ich z automatu (aktywna wysyłka)

### F7 Rejestry i weryfikacje (must)
- [x] Biała Lista (status VAT, REGON, adres) + KRS (e-mail, PKD), NIP checksum
- [ ] **Bramka płatności >15 000**: sprawdź Białą Listę w dniu zlecenia, archiwizuj dowód (ID/PDF); escape: MPP albo **ZAW-NR w 7 dni**; od IX.2026 brak sankcji kosztowej PIT, **solidarna VAT zostaje**
- [ ] GUS REGON, CEIDG (PKD 2007→2025 do 31.12.2026, potem auto-reklasyfikacja), VIES dla UE
- [ ] NBP tabela A/C (cache dzienny)

### F8 Pulpit / obserwowalność (nice — tu bijemy iFirmę)
- [x] KPI + wykres przychód/koszty/VAT
- [x] Tort „Gdzie idą pieniądze” (PIT/VAT/ZUS/koszty/zysk + oszczędność z kosztów)
- [x] Porównywarka pełnego obciążenia PIT+ZUS+danina (nie tylko PIT)
- [ ] **„Ile do zapłaty i do kiedy”**: PIT do 20., ZUS do 20., VAT do 25., roczny do 30 IV, DRA roczna do 20 V
- [ ] **Dochód „na rękę”** (przychód − koszty − PIT − ZUS − VAT do zapłaty), efektywna stawka, marża
- [ ] Prognoza cashflow do końca roku, alert progu 120k / tieru ryczałt-zdrowotnej / limitu VAT 240k
- [ ] Kalendarz terminów + eksport iCal/CSV, powiadomienia w UI

### F9 Dane i niezawodność
- [x] SQLite + EF, seed demo, tryb lokalny localStorage, fire-and-forget sync
- [ ] Eksport/import JSON+CSV, backup 1-klik, retencja **5 lat docs / 10 lat KSeF** (info w UI)
- [ ] `JPK_PKPIR/JPK_EWP/JPK_KR_PD + JPK_ST` — trzymaj miesięcznie, wyślesz w 2027 za 2026
- [ ] e-Doręczenia skrzynka (obowiązek CEIDG od 1.10.2026) — link + status w Ustawieniach

### Inbox (pomysły dopisywane w trakcie)
- [ ] Symulator „etat vs B2B” (ZUS pracodawcy vs JDG) — magnes na nowych B2B
- [ ] Cykliczna faktura (cron miesięczny) + mail do klienta
- [ ] Płatności: link do przelewu, status z banku (PSD2 stub)
- [ ] KSeF: masowa wysyłka miesiąca jednym klikiem
- [ ] Dark-mode PDF, logo firmy na fakturze

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
| **KSeF 2.0** (write+read) | token KSeF (do 31.12.26) → potem **certyfikat KSeF / pieczęć + ZAW-FA**; NIP; środowisko demo `https://ksef-test.mf.gov.pl`; UPO. Jak uzyskać: e-Urząd → KSeF → „Uwierzytelnianie” → token lub wniosek o certyfikat; duzi: pieczęć kwalifikowana u QTSP. | `POST /api/mock/ksef/wyslij` (przyjmuje FA(3)-like JSON, zwraca `ksefId`+`upo`, symuluje offline24/awaria), `GET /api/mock/ksef/faktury`, UI toggle Demo/Prod + pole tokenu | stub JSON → **do przebudowy na FA(3)** |
| **JPK_V7M/K** | XSD MF v2 + **podpis kwalifikowany** (QTSP, ~200 zł/rok) + e-Urząd (bramka `e-dokumenty.mf.gov.pl`). Jak: kup certyfikat → zarejestruj w e-Urzędzie → wyślij XML → UPO. | `buildJpkV7M()` generuje **prawdziwy XML v2** (nagłówek+ewidencja+deklaracja), walidacja XSD w testach, przycisk „pobierz + instrukcja wysyłki” | stub → **do przebudowy** |
| **ZUS DRA / eZUS** | konto PUE/eZUS + **NRS** (przelew), kod tytułu (05 40 start / 05 90 mały / 01 duży). Jak: pue.zus.pl → rejestracja → DRA Kreator/Płatnik → wyślij do 20. | `buildZusDraXml()` + `POST /api/mock/zus/dra` (waliduje sumy, zwraca potwierdzenie), UI: NRS + kod tytułu | stub JSON → **do przebudowy** |
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
- [ ] Batch E — polerowanie: onboarding, PDF faktury, masowa wysyłka KSeF miesiąca, iCal terminów, backup 1-klik, checklista „audyt przed wysyłką”, testy e2e

Kryterium „gotowe”: `dotnet test` + `bun run test` zielone, faktura wystawiona w <60 s,
miesięczne rozliczenie (PIT+VAT+ZUS z terminami i kwotami do przelewu) bez kalkulatora obok.
