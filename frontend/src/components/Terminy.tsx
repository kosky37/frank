import { useMemo, type JSX } from 'react';

interface Termin {
  data: string; // ISO yyyy-mm-dd
  tytul: string;
  opis: string;
}

function terminRoczny(miesiac: number, dzien: number): string {
  return `2026-${String(miesiac).padStart(2, '0')}-${String(dzien).padStart(2, '0')}`;
}

const TERMINY_2026: Termin[] = [
  { data: terminRoczny(1, 20), tytul: 'PIT zaliczka za XII', opis: 'PIT zaliczka miesięczna/kwartalna — do 20. stycznia' },
  { data: terminRoczny(1, 20), tytul: 'ZUS DRA za XII', opis: 'Składki + deklaracja DRA — do 20. stycznia' },
  { data: terminRoczny(1, 26), tytul: 'VAT za XII / IV kw.', opis: 'JPK_V7M / JPK_V7K + zapłata VAT — do 25. stycznia' },
  { data: terminRoczny(2, 1), tytul: 'KSeF: obowiązek odbioru', opis: 'Od 1.02.2026 obowiązkowy odbiór faktur w KSeF' },
  { data: terminRoczny(2, 15), tytul: 'PIT roczny: start', opis: 'Od 15 lutego usługa Twój e-PIT (PIT-36/36L/28)' },
  { data: terminRoczny(2, 20), tytul: 'PIT zaliczka za I', opis: 'PIT zaliczka — do 20. lutego' },
  { data: terminRoczny(2, 20), tytul: 'ZUS DRA za I', opis: 'Składki + deklaracja DRA — do 20. lutego' },
  { data: terminRoczny(2, 25), tytul: 'VAT za I', opis: 'JPK_V7M + zapłata VAT — do 25. lutego' },
  { data: terminRoczny(3, 20), tytul: 'PIT zaliczka za II', opis: 'PIT zaliczka — do 20. marca' },
  { data: terminRoczny(3, 20), tytul: 'ZUS DRA za II', opis: 'Składki + deklaracja DRA — do 20. marca' },
  { data: terminRoczny(3, 25), tytul: 'VAT za II', opis: 'JPK_V7M + zapłata VAT — do 25. marca' },
  { data: terminRoczny(4, 1), tytul: 'KSeF: obowiązek wystawiania', opis: 'Od 1.04.2026 obowiązkowe wystawianie w KSeF (duże firmy od 1.02)' },
  { data: terminRoczny(4, 20), tytul: 'PIT zaliczka za III / I kw.', opis: 'PIT zaliczka miesięczna i kwartalna — do 20. kwietnia' },
  { data: terminRoczny(4, 20), tytul: 'ZUS DRA za III', opis: 'Składki + deklaracja DRA — do 20. kwietnia' },
  { data: terminRoczny(4, 25), tytul: 'VAT za III / I kw.', opis: 'JPK_V7M / JPK_V7K + zapłata VAT — do 25. kwietnia' },
  { data: terminRoczny(4, 30), tytul: 'PIT roczny: koniec', opis: 'PIT-36 / PIT-36L / PIT-28 + zapłata podatku — do 30 kwietnia' },
  { data: terminRoczny(5, 20), tytul: 'DRA roczna (zdrowotna)', opis: 'Roczne rozliczenie składki zdrowotnej — do 20 maja' },
  { data: terminRoczny(6, 1), tytul: 'Zwrot nadpłaty zdrowotnej', opis: 'Wniosek o zwrot nadpłaty składki zdrowotnej — do 1 czerwca' },
  { data: terminRoczny(10, 1), tytul: 'e-Doręczenia', opis: 'Obowiązkowy adres do e-Doręczeń (CEIDG) — od 1.10.2026' },
  { data: terminRoczny(12, 31), tytul: 'CEIDG: PKD 2025', opis: 'Aktualizacja kodów PKD do klasyfikacji PKD 2025 — do 31.12.2026' },
];

function dzisISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function Terminy(): JSX.Element {
  const dzis = dzisISO();
  const najblizsze = useMemo(
    () => TERMINY_2026.filter((t) => t.data >= dzis).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 3),
    [dzis],
  );
  return (
    <>
      <div className="card">
        <h3>Najbliższe 3 terminy</h3>
        {najblizsze.length === 0 ? (
          <p className="muted">Brak nadchodzących terminów 2026.</p>
        ) : (
          <div className="unpaid">
            {najblizsze.map((t) => (
              <div key={`${t.data}-${t.tytul}`} className="unpaid-row">
                <div className="who">
                  <b>{t.tytul}</b>
                  <small>{t.opis}</small>
                </div>
                <span className="amt">{t.data}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3>Terminy 2026 (JDG)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th>Obowiązek</th><th>Szczegóły</th></tr>
            </thead>
            <tbody>
              {TERMINY_2026.map((t, i) => (
                <tr key={`${t.data}-${t.tytul}-${i}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.data}</td>
                  <td><b>{t.tytul}</b></td>
                  <td className="muted">{t.opis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          PIT zaliczka — do 20. następnego miesiąca (kwartalna: do 20. po kwartale).
          ZUS DRA — do 20. następnego miesiąca. VAT — do 25. następnego miesiąca
          (kwartalny: do 25. po kwartale). PIT roczny: 15 lutego – 30 kwietnia.
        </p>
      </div>
    </>
  );
}
