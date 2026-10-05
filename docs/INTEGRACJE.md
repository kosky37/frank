# Integracje — klik po kliku (KSeF, JPK, ZUS, GUS, NBP, e-Doręczenia, e-PIT)

Wszystkie sekrety wklejasz w aplikacji: **Ustawienia → Integracje**
(`ksefToken`, `ksefSrodowisko`, `gusApiKey`, `zusNrs`, `edoreczeniaAdres`, `zusKodTytulu`).
Niczego nie commituj do repo.

## 1. KSeF 2.0 (faktury ustrukturyzowane)

1. Demo: załóż konto na **ksef-test.mf.gov.pl** → Uwierzytelnianie → generuj **token**.
2. Wklej token w Integracjach, środowisko = **demo**. Pobierz FA(3)-JSON z zakładki Integracje.
3. Produkcja (od 2026 faktury B2B obowiązkowo przez KSeF): wyrób **certyfikat KSeF**
   i złóż **ZAW-FA** (zgłoszenie osoby upoważnionej) na podatki.gov.pl.
4. Podpis: kwalifikowany (~200 zł/rok) albo profil zaufany; wysyłka z UPO jako dowodem.

## 2. JPK_V7M (VAT)

1. W Integracjach wybierz miesiąc → **Pobierz JPK_V7M** (Nagłówek/Podmiot/Ewidencja/Deklaracja).
2. Zweryfikuj z **XSD MF** (schemat v2), podpisz kwalifikowanym, wyślij przez **e-Urząd Skarbowy**.
3. Termin: do 25. dnia po miesiącu (rozliczenie miesięczne) / kwartale.

## 3. ZUS DRA (Płatnik / PUE eZUS)

1. Załóż konto na **PUE/eZUS** (zus.pl), pobierz swój **NRS** (indywidualny rachunek do przelewów).
2. Wklej NRS + **kod tytułu**: `05 40` start (ulga 6 mies.) / `05 90` Mały ZUS Plus / `01 10` duży.
3. Pobierz DRA-XML z aplikacji → wczytaj w **Płatniku** / PUE, sprawdź, wyślij.
4. Termin: do 20. dnia miesiąca.

## 4. GUS BIR, NBP, mikrorachunek

- **GUS BIR**: klucz z **api.stat.gov.pl** → wklej jako `gusApiKey` (podpowiedzi REGON/NIP).
- **NBP**: bez klucza — kursy pobierają się same (`/api/nbp/kurs?waluta=EUR&data=...`), fallback EUR 4.32 / USD 4.05.
- **Mikrorachunek**: liczony z NIP (`/api/mikrorachunek?nip=…`); przed pierwszym przelewem
  **zweryfikuj w generatorze MF** — aplikacja liczy lokalnie (mod 97).

## 5. e-Doręczenia + Twój e-PIT

- **e-Doręczenia**: skrzynka na **edoreczenia.gov.pl**, adres `ADE:PL-…` → wklej w Integracjach.
  Obowiązek dla CEIDG od **1.10.2026**.
- **Twój e-PIT**: rozliczenie roczne PIT-36/36L/28 w usłudze MF **15 II – 30 IV**;
  aplikacja daje zestawienie kontrolne (`buildPitRocznyXml`).

## Demo vs prod

| Obszar | Demo (bezpieczne) | Produkcja |
|---|---|---|
| KSeF | ksef-test.mf.gov.pl + token | certyfikat + ZAW-FA, UPO wiążące |
| JPK_V7M | podgląd XML lokalnie | XSD MF + podpis kwalifikowany + e-Urząd |
| ZUS DRA | podgląd XML, mock `/api/mock/zus/dra` | Płatnik / PUE, prawdziwy NRS |
| GUS/NBP | klucz testowy / fallback | klucz BIR, kurs z dnia roboczego przed sprzedażą |
| e-Doręczenia | — | skrzynka ADE obowiązkowa od 1.10.2026 |
