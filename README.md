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
- **Koszty**: flaga **pojazdowa** — mieszany → **50% VAT, 75% PIT**; wyłącznie firma → 100% (wymaga VAT-26); prywatny → 0%.
- **Formy opodatkowania (2026)**: skala 12% do 120k / 32% powyżej + kwota wolna 30k (PIT-36),
  liniowy 19% (PIT-36L), ryczałt 12% IT (PIT-28). Stawki edytowalne w Ustawieniach.
- **VAT**: należny − naliczony (po korekcie pojazdowej). **ZUS**: społeczne + zdrowotna
  (skala 9%, liniowy 4,9%, ryczałt) + FP.
- **Pulpit**: KPI + wykresy (recharts). **Roczny PIT**: formularz + podstawa + podatek.
- **Kontrahenci**: baza klientów (CRUD) + wyszukiwanie po NIP w rejestrach —
  Biała Lista VAT (status VAT, REGON, adres) wzbogacana odpisem KRS (e-mail, kody PKD).
- **Profil firmy**: dane sprzedawcy + kody PKD (CEIDG) w Ustawieniach, z uzupełnianiem z rejestrów.
- **Stawki ryczałtu**: pełne 10 stawek (art. 12) z tabelą referencyjną; stawka domyślna +
  per pozycja faktury, PIT dzieli odliczenie ZUS proporcjonalnie (wymóg ewidencji wg stawek).
- **Deklaracje**: eksport stubów JPK_V7M XML / ZUS DRA / KSeF JSON (frontend, do ręcznej wysyłki).
  Prawdziwe wysyłki (certyfikaty, KSeF 2.0) — docelowo po stronie API.

## API

| Metoda | Endpoint | Opis |
|---|---|---|
| GET/POST | `/api/sales`, `/api/sales/{id}` | Faktury sprzedaży (+PUT/DELETE) |
| GET/POST | `/api/costs`, `/api/costs/{id}` | Koszty (+PUT/DELETE) |
| GET/POST | `/api/kontrahenci`, `/api/kontrahenci/{id}` | Kontrahenci (+PUT/DELETE, `?q=` szukaj) |
| GET/PUT | `/api/settings` | Ustawienia + profil firmy + PKD (1 wiersz) |
| GET | `/api/taxes/monthly?month=yyyy-MM` | Sumy + zaliczka PIT + VAT + ZUS |
| GET | `/api/taxes/yearly?year=yyyy` | Miesiące + przychód/koszty YTD + roczny PIT |
| GET | `/api/slowniki/pkd`, `/api/slowniki/ryczalt` | Dane referencyjne (PKD, 10 stawek) |
| GET | `/api/rejestry/podmiot?nip=` | Podmiot z rejestrów (Biała Lista → KRS); 400/404/504 |

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
