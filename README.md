# Frank — minimalistyczna księgowość JDG (B2B programista)

Bun + Vite + React + TypeScript (frontend) + .NET 10 Web API + EF Core SQLite (backend).
Polski system podatkowy 2026. Uruchamiane w Dockerze jako jeden kontener.

```
┌──────────────┐      ┌───────────────────────────────────┐
│   Przeglądarka│      │  Docker: frank-ksiegowosc         │
│               │      │  ┌──────────┐    ┌─────────────┐  │
│  React (Vite  │◄────►│  │ wwwroot/ │    │ Frank.Api   │  │
│  dist)        │ same │  │ (statyki)│    │ /api/*      │  │
│               │ origin│  └──────────┘    │ EF Core     │  │
└──────────────┘      │                   │ frank.sqlite│  │
                      │                   │ (/data ⟵ vol)│  │
                      └───────────────────────────────────┘
```

## Szybki start

```powershell
# Dev: 2 terminale
dotnet run --project backend/Frank.Api          # API na http://localhost:5203
cd frontend; bun install; bun run dev           # UI na http://localhost:5173 (proxy /api)

# Testy
dotnet test backend/Frank.Api.Tests             # C#: silnik podatkowy (parzyste z TS)
cd frontend; bun run test                       # TS: silnik podatkowy UI

# Docker (prod w jednym kontenerze)
docker compose up --build -d                    # http://localhost:8080
docker compose logs -f
```

Dane SQLite żyją w wolumenie `frank-data` (`FRANK_DATA_DIR=/data`).
Pierwsze uruchomienie seeduje demo (faktura 20 000 zł + 2 koszty) — tak samo jak tryb lokalny frontendu.

## Co działa

- **Faktury sprzedaży**: wystawianie, VAT 23%/8%/5%/0%/zw/np/oo, statusy robocza → KSeF.
  Auto-numeracja `N/MM/RRRR`, kopiuj-poprzedni-miesiąc, korekty, waluty (kurs NBP),
  flaga MPP + rachunek + pieczątka sprawdzenia Białej Listy (ostrzeżenie >15 000 zł).
- **Koszty**: flaga **pojazdowa** — mieszany → **50% VAT, 75% PIT**; wyłącznie firma → 100% (wymaga VAT-26); prywatny → 0%.
  Blokada art. 23 (reprezentacja/prywatne), paragon-bez-NIP (VAT 0), import CSV, hint limitów aut 2026 (EV 225k / <50g 150k / spal. 100k).
- **Formy opodatkowania (2026)**: skala 12% do 120k / 32% powyżej + kwota wolna 30k (PIT-36),
  liniowy 19% (PIT-36L, zdrowotna w limicie **14 100/rok**), ryczałt 12% IT (PIT-28).
  **Porównywarka form** na żywych danych YTD + **danina 4% >1M** (PIT-DS).
- **VAT**: należny − naliczony (po korekcie pojazdowej), pasek **limitu 240k** z alertem 90%.
  **ZUS 2026**: duży **1 926,76** (FP 138,47), zdrowotna min **432,54** (I: 314,96),
  schematy start/preferencyjny/Mały ZUS Plus/duży, ryczałt **498/831/1495** wg przychodu.
- **Pulpit**: „ile do zapłaty i do kiedy” (PIT 20. / ZUS 20. / VAT 25. / roczny 30 IV),
  dochód **„na rękę”**, tort **„Gdzie idą pieniądze”** (PIT/VAT/ZUS/koszty/zysk + oszczędność z kosztów),
  kalendarz **Terminów 2025–2027** z odhaczaniem, wykresy (recharts). **Roczny PIT**: formularz + podstawa + podatek + danina.
- **Kontrahenci**: baza klientów (CRUD, eksport CSV) + wyszukiwanie po NIP w rejestrach —
  Biała Lista VAT (status VAT, REGON, adres) wzbogacana odpisem KRS (e-mail, kody PKD).
- **Profil firmy**: dane sprzedawcy + kody PKD (CEIDG) w Ustawieniach, z uzupełnianiem z rejestrów.
- **Stawki ryczałtu**: pełne 10 stawek (art. 12) z tabelą referencyjną; stawka domyślna +
  per pozycja faktury, PIT dzieli odliczenie ZUS proporcjonalnie (wymóg ewidencji wg stawek).
- **Integracje i wysyłka** (zakładka + `docs/INTEGRACJE.md`): prawdziwy **JPK_V7M XML** wg schematu MF,
  **KSeF FA(3)**-like + mock bramki (`/api/mock/ksef/*`, tryb demo/prod + token),
  **ZUS DRA** per miesiąc ze statusami (`/api/mock/zus/dra`), **mikrorachunek** z NIP (`/api/mikrorachunek`),
  kursy **NBP** z cache (`/api/nbp/kurs`), **stawki roczne** (`/api/slowniki/stawki?rok=`),
  pola na klucz GUS / NRS / e-Doręczenia w Ustawieniach.

## API

| Metoda | Endpoint | Opis |
|---|---|---|
| GET/POST | `/api/sales`, `/api/sales/{id}` | Faktury sprzedaży (+PUT/DELETE) |
| GET/POST | `/api/costs`, `/api/costs/{id}` | Koszty (+PUT/DELETE) |
| GET/POST | `/api/kontrahenci`, `/api/kontrahenci/{id}` | Kontrahenci (+PUT/DELETE, `?q=` szukaj) |
| GET/PUT | `/api/settings` | Ustawienia + profil firmy + PKD + klucze integracji (1 wiersz) |
| GET | `/api/taxes/monthly?month=yyyy-MM` | Sumy + zaliczka PIT + VAT + ZUS |
| GET | `/api/taxes/yearly?year=yyyy` | Miesiące + przychód/koszty YTD + roczny PIT |
| GET | `/api/slowniki/pkd`, `/api/slowniki/ryczalt` | Dane referencyjne (PKD, 10 stawek) |
| GET | `/api/slowniki/stawki?rok=` | Stawki roczne ZUS/limitów (2025/2026, fallback: najnowszy ≤ rok) |
| GET | `/api/rejestry/podmiot?nip=` | Podmiot z rejestrów (Biała Lista → KRS); 400/404/504 |
| POST | `/api/mock/ksef/wyslij` | Mock KSeF 2.0: przyjmuje fakturę, zwraca `ksefId` + `upoId` |
| GET | `/api/mock/ksef/faktury` | Mock KSeF: lista odebranych (pusta w demo) |
| POST | `/api/mock/zus/dra` | Mock eZUS: waliduje sumy, zwraca potwierdzenie + XML DRA |
| GET | `/api/nbp/kurs?waluta=&data=` | Kurs NBP (tabela A→C, fallback statyczny); `PLN` → 1 |
| GET | `/api/mikrorachunek?nip=` | Mikrorachunek wyliczony z NIP (zweryfikuj w generatorze MF) |

Rejestry wymagają internetu (kontener też) i mieszczą się w limicie 100 zapytań/dzień
metody `search` Białej Listy.

Kształty JSON 1:1 z typami frontendu (`frontend/src-shared/tax/types.ts`), klucze camelCase.

## Uwagi architektoniczne

- **Dwa silniki podatkowe (świadomie)**: TS w `frontend/src-shared/tax/` liczy natychmiast w UI
  (podgląd, wykresy), C# w `backend/Frank.Api/Tax/` liczy autorytatywnie dla zapisanych danych.
  Testy `tax.test.ts` i `TaxCalcTests.cs` są parzyste (te same 9 przypadków) — rozjazd wyłapie CI.
- **Frontend bez API też działa**: `initStore()` próbuje `/api`, przy braku backendu spada do
  localStorage (badge „tryb lokalny” w nawigacji). Mutacje zawsze zapisują lokalnie,
  do API synchronizują fire-and-forget gdy jest online.
- CORS dla Vite dev (`http://localhost:5173`) tylko w Development; w Dockerze same-origin.
