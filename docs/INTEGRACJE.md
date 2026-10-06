# Integracje — klik po kliku (KSeF, JPK, ZUS, GUS, NBP, e-Doręczenia, e-PIT)

Wszystko działa z aplikacji — bez podpisu kwalifikowanego:
**KSeF tokenem** (Profil Zaufany jednorazowo przy generowaniu tokenu),
**JPK danymi autoryzującymi** (NIP/PESEL + imię + nazwisko + data urodzenia + przychód sprzed 2 lat),
**ZUS przez plik KEDU** (ZUS nie ma API do wysyłki — import w Płatniku/ePłatniku).

Sekrety operacyjne wklejasz w aplikacji: **Ustawienia → Integracje**
(`ksefToken`, `ksefSrodowisko`, `gusApiKey`, `zusNrs`, `zusKodTytulu`, `kodUrzedu` w Ustawieniach).
Danych autoryzujących JPK aplikacja **nie zapisuje** (podajesz je przy każdej wysyłce).
Niczego nie commituj do repo.

## 1. KSeF 2.0 (faktury ustrukturyzowane FA(3))

**Jak uzyskać token (jednorazowo, Profilem Zaufanym):**
1. Wejdź na **Aplikację Podatnika** środowiska, z którego chcesz korzystać:
   test → `https://ksef-test.mf.gov.pl`, demo → `https://ksef-demo.mf.gov.pl`, prod → `https://ksef.mf.gov.pl`.
2. Zaloguj się **Profilem Zaufanym** (login.gov.pl / mObywatel) w kontekście swojego NIP.
3. Ustawienia → Uwierzytelnianie/Tokeny → **Generuj token KSeF** (uprawnienia InvoiceWrite + InvoiceRead).
4. Token wklej w aplikacji: Ustawienia → Integracje → **Token KSeF 2.0**, wybierz środowisko
   (test = `api-test`, demo = `api-demo`, prod = `api`) i kliknij **„Sprawdź połączenie”**.
5. Wysyłka: Sprzedaż → szczegóły faktury → **„Wyślij do KSeF”** albo Integracje → **„Wyślij N faktur do KSeF”**.
   Backend buduje prawdziwy **FA(3) XML** (XSD MF), szyfruje (AES-256-CBC + RSA-OAEP) i wysyła
   sesją online; numer KSeF zapisuje się na fakturze. **„Podgląd FA(3) XML”** pobiera XML bez wysyłki.
6. Odbiór zakupów: Integracje → **„Pobierz faktury z KSeF”** (metadane: numer, NIP/nazwa sprzedawcy,
   netto/VAT/brutto) → **„Zaksięguj koszt”**. Stawkę VAT zweryfikuj z treścią faktury w Aplikacji Podatnika.

Uwagi: środowisko **test współdzielą integratorzy** — tylko dane testowe, losowy NIP.
Token ma zamrożone uprawnienia (zmiana = nowy token). Tokeny żyją do 31.12.2026 — potem certyfikat KSeF + ZAW-FA.
Faktury korygujące/zaliczkowe/proformy wysyłaj ręcznie w Aplikacji Podatnika (osobny błąd backendu).

## 2. JPK_V7M(3) / JPK_V7K(3) (VAT, od 01.02.2026)

1. Uzupełnij w Ustawieniach: NIP, nazwę, adres, **e-mail**, **kod urzędu skarbowego** (4 cyfry).
2. Integracje → **JPK_V7 — podgląd i wysyłka** → wybierz miesiąc (V7M) albo zaznacz **V7K** (kwartał).
3. **„Podgląd JPK (XSD)”** — pobiera XML budowany z bazy + wynik walidacji urzędowym schematem MF.
4. Wysyłka **danymi autoryzującymi** (bez kwalifikowanego, tylko JDG/osoby fizyczne):
   imię + nazwisko + data urodzenia + NIP albo PESEL + **przychód z zeznania sprzed 2 lat**
   (w 2026 → przychód za 2024; 0, gdy brak). Gdzie znaleźć kwotę: e-Urząd → Deklaracje → Historia deklaracji → PIT za 2024.
5. Najpierw **„Wyślij JPK (test)”** (bramka `test-e-dokumenty.mf.gov.pl`), potem **„Wyślij (produkcja)”**.
   UPO pobiera się automatycznie; **„Sprawdź status”** odświeża po numerze referencyjnym.
6. Cel złożenia: 1 = złożenie, 2 = korekta. Termin: do 25. dnia po miesiącu/kwartale.
   Nadwyżka domyślnie przechodzi na następny okres (P_62), bez wniosku o zwrot.

## 3. ZUS DRA → KEDU 5.6 (Płatnik / eZUS)

ZUS **nie udostępnia API** do składania DRA — jedyna droga to plik KEDU:
1. Załóż konto na **PUE/eZUS** (zus.pl), pobierz swój **NRS** (indywidualny rachunek do przelewów).
2. Wklej NRS + **kod tytułu**: `05 40` start / `05 70` preferencyjny / `05 90` Mały ZUS Plus / `05 10` duży (sam za siebie).
3. Integracje → sekcja **Deklaracje ZUS (DRA)** → przy miesiącu **„KEDU”**.
   Aplikacja proponuje podział na fundusze (emerytalne/rentowe/chorobowe/wypadkowe), podstawy i blok XI —
   sprawdź, popraw, **„Pobierz KEDU”** (walidacja urzędowym XSD ZUS 5.6).
4. Import: **Płatnik** → Dokumenty wprowadzone → Importuj dokumenty, albo **ePłatnik** (do 100 ubezpieczonych)
   → Dokumenty ubezpieczeniowe → Import KEDU. Sprawdź kwoty, podpisz **Profilem Zaufanym** (bezpłatnie) i wyślij.
5. Termin: do 20. dnia miesiąca, jednym przelewem na NRS. Mały ZUS Plus: podstawę od dochodu uzupełnij ręcznie.

## 4. GUS BIR, VIES, NBP, mikrorachunek

- **GUS BIR**: klucz z **api.stat.gov.pl** → wklej jako `gusApiKey` (Ustawienia → Integracje).
  Wyszukiwanie: `GET /api/rejestry/gus?nip=` (NIP 10 cyfr albo REGON 9/14) — logowanie SOAP + `DaneSzukajPodmioty`.
- **VIES** (kontrahenci UE, WDT/WNT): `GET /api/rejestry/vies?kraj=DE&nip=…` — sprawdź przed 0%.
  WDT wymaga też VAT-UE (zgłoś przed pierwszą transakcją) i dowodu wywozu; usługi B2C do UE idą przez OSS.
- **NBP**: bez klucza — kursy pobierają się same (`/api/nbp/kurs?waluta=EUR&data=...`), fallback EUR 4.32 / USD 4.05.
- **Mikrorachunek**: liczony z NIP (`/api/mikrorachunek?nip=…`); przed pierwszym przelewem
  **zweryfikuj w generatorze MF** — aplikacja liczy lokalnie (mod 97).

## 5. e-Doręczenia + Twój e-PIT

- **e-Doręczenia**: skrzynka na **edoreczenia.gov.pl**, adres `ADE:PL-…` → wklej w Integracjach.
  Obowiązek dla CEIDG od **1.10.2026**. Status (adres ustawiony/brak) widać w Integracjach.
- **Twój e-PIT**: rozliczenie roczne PIT-36/36L/28 w usłudze MF **15 II – 30 IV**;
  aplikacja daje roboczy XML z PIT/B, PIT/O (ulgi) i PIT-DS (`buildPitRocznyXmlFull`, przycisk w Podatkach).
  PIT-36/36L/28 wysyłasz aktywnie — Twój e-PIT ich nie akceptuje z automatu.

## 6. JPK roczne (KPiR/EWP/ST)

- **JPK_PKPIR / JPK_EWP / JPK_ST**: budowane lokalnie z dokumentów i rejestru środków trwałych
  (przyciski w Integracjach). Trzymaj miesięcznie — pierwsza wysyłka w **2027 za 2026**.
  JDG na KPiR/EWP nie prowadzi ksiąg rachunkowych, więc JPK_KR_PD nie dotyczy.

## Demo vs prod

| Obszar | Test / demo (bezpieczne) | Produkcja |
|---|---|---|
| KSeF | test/demo + token, wysyłka FA(3) z aplikacji, UPO testowe | token prod, FA(3) jak na teście, UPO wiążące |
| JPK_V7M/V7K | podgląd XML + XSD lokalnie, wysyłka danymi autoryzującymi na test | wysyłka danymi autoryzującymi (JDG) na prod, UPO do 25. |
| ZUS DRA | podgląd propozycji + KEDU lokalnie | KEDU → Płatnik/ePłatnik, podpis PZ, wysyłka do 20. |
| GUS/NBP | klucz testowy / fallback | klucz BIR, kurs z dnia roboczego przed sprzedażą |
| e-Doręczenia | — | skrzynka ADE obowiązkowa od 1.10.2026 |
