import { useMemo, useState, type JSX } from 'react';
import { api, type UrzadSk } from '../lib/api.js';

/** Składnia bez polskich znaków do filtrowania lokalnego (jak backend Fold). */
export function foldUrzad(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function ranga(u: UrzadSk, nq: string): number {
  if (u.kod.toLowerCase().startsWith(nq)) return 0;
  const idx = foldUrzad(u.nazwa).indexOf(nq);
  return idx < 0 ? Number.MAX_SAFE_INTEGER : 1000 + idx;
}

/**
 * Ranking jak w backendzie (`UrzedySkarbowe.Ranga`): kod od początku zawsze
 * pierwszy, w nazwie wygrywa wcześniejsza pozycja (np. "wa" → WARSZAWA,
 * nie WAŁBRZYCH — kolejność pliku tego nie gwarantuje).
 */
export function filtrujUrzedy(lista: UrzadSk[], q: string, limit = 10): UrzadSk[] {
  const nq = foldUrzad(q.trim());
  if (!nq) return [];
  return lista
    .map((u) => ({ u, r: ranga(u, nq) }))
    .filter((x) => x.r < Number.MAX_SAFE_INTEGER)
    .sort((a, b) => a.r - b.r || (a.u.kod < b.u.kod ? -1 : 1))
    .slice(0, limit)
    .map((x) => x.u);
}

/**
 * Wybór urzędu skarbowego po nazwie / mieście / kodzie (nikt nie zna numeru
 * swojego US na pamięć). Lista ze słownika MF (`GET /api/slowniki/urzedy`),
 * filtrowana lokalnie; przy braku API działa ręczny wpis 4 cyfr.
 */
export function UrzadLookup({
  value,
  onPick,
}: {
  /** aktualny kod (4 cyfry) albo pusto */
  value: string;
  /** wybrany kod ('' = wyczyszczony) */
  onPick: (kod: string) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<UrzadSk[] | null>(null);
  const [otwarte, setOtwarte] = useState(false);

  async function laduj(): Promise<void> {
    if (lista) return;
    try {
      setLista(await api.urzedy(''));
    } catch {
      setLista([]);
    }
  }

  const wybrany: UrzadSk | undefined = useMemo(
    () => (lista ?? []).find((u) => u.kod === value),
    [lista, value],
  );

  const wyniki = useMemo(() => filtrujUrzedy(lista ?? [], q), [q, lista]);

  function wybierz(u: UrzadSk): void {
    onPick(u.kod);
    setQ('');
    setOtwarte(false);
  }

  return (
    <div className="menu-wrap" style={{ width: '100%' }}>
      <div className="row" style={{ gap: 8, width: '100%' }}>
        <input
          value={q}
          style={{ flex: 1 }}
          onChange={(e) => { setQ(e.target.value); setOtwarte(true); void laduj(); }}
          onFocus={() => { setOtwarte(true); void laduj(); }}
          onBlur={() => {
            // ręczny wpis 4 cyfr też akceptujemy
            const d = q.replace(/\D/g, '').slice(0, 4);
            if (/^\d{4}$/.test(d) && d !== value) onPick(d);
            window.setTimeout(() => setOtwarte(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && wyniki.length > 0) { e.preventDefault(); wybierz(wyniki[0]); }
            if (e.key === 'Escape') setOtwarte(false);
          }}
          placeholder={wybrany ? `${wybrany.kod} — ${wybrany.nazwa}` : 'np. Warszawa, Kraków, 1435…'}
          aria-label="Wyszukaj urząd skarbowy po mieście lub nazwie"
        />
        {value && (
          <button
            type="button"
            className="btn ghost small"
            title="Wyczyść kod urzędu"
            onClick={() => onPick('')}
          >
            ✕
          </button>
        )}
      </div>
      {value && !q && (
        <div className="field-hint">
          Wybrany: <b>{value}</b>{wybrany ? ` — ${wybrany.nazwa}` : ' (nazwa pojawi się po wpisaniu miasta)'}
        </div>
      )}
      {otwarte && q.trim() && (
        <div className="menu left" role="listbox" aria-label="Znalezione urzędy" style={{ left: 0, right: 0, maxHeight: 260, overflowY: 'auto' }}>
          {lista === null && <div className="muted" style={{ padding: '8px 10px' }}>Ładowanie słownika urzędów…</div>}
          {lista !== null && wyniki.length === 0 && (
            <div className="muted" style={{ padding: '8px 10px' }}>
              Brak wyników — wpisz 4-cyfrowy kod ręcznie albo doprecyzuj miasto.
            </div>
          )}
          {wyniki.map((u) => (
            <button
              key={u.kod}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => { e.preventDefault(); wybierz(u); }}
            >
              <b>{u.kod}</b><span className="muted">— {u.nazwa}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
