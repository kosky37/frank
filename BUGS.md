UNRESOLVED:

RESOLVED:

- settings tiles are still narrow
  → drugi pass: `.sections` min 340→360px (420px na ≥1400px); karty „Moja firma” i „Opodatkowanie”
  rozpięte na 2 kolumny (`span2`, z fallbackiem na mobile); formularz firmy jako 2-kolumnowa siatka
  (`.form-grid`: nazwa+NIP, REGON+telefon, adres+e-mail obok siebie; wyszukiwarka rejestrów i PKD na pełną szerokość);
  szerokie tabele (deklaracje ZUS, odbiór KSeF) rozpięte na całą szerokość (`span-all`).

- the tiles are narrow, they don't need to be
  → `styles.css`: `.kpi-grid` min 220→250px (280px na ≥1400px), gap 12→14px; kafelki rozciągają się na pełną szerokość.
- on large screens the amount of utilized space is minimal
  → `main` max-width 1220→1500px + centrowanie; `.sections` min 300→340px; breakpoint ≥1400px
  z szerszym paddingiem. Sidebar bez zmian (248px).
