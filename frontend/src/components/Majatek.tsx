// Majątek: rejestr środków trwałych (amortyzacja) + kalkulator limitu auta 2026 +
// ewidencja przebiegu (pojazd 100%). Dane lokalne (localStorage), eksport CSV.
import { useMemo, useState, type JSX } from 'react';
import { ewidencjaCsv, limitAuta, odpisZaRok, sumaKm, type NapedAuta, type SrodekTrwaly, type WpisPrzebiegu } from '../lib/majatek.js';
import type { SrodekDoJpk } from '../../src-shared/tax/integrations.js';
import { fmtMoney, todayISO } from '../lib/format.js';
import { uid } from '../lib/store.js';

const KEY_SRODKI = 'frank-srodki-trwale';
const KEY_KM = 'frank-przebieg';

function wczytaj<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch { /* ignore */ }
  return [];
}

function zapisz(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch { /* ignore */ }
}

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function srodkiDoJpk(srodki: SrodekTrwaly[], rok: number): SrodekDoJpk[] {
  return srodki.map((s) => {
    const r = odpisZaRok(s, rok, 0);
    return { nazwa: s.nazwa, wartosc: s.wartosc, umorzenie: r.umorzenie };
  });
}

export function Majatek(): JSX.Element {
  const [srodki, setSrodki] = useState<SrodekTrwaly[]>(() => wczytaj<SrodekTrwaly>(KEY_SRODKI));
  const [wpisy, setWpisy] = useState<WpisPrzebiegu[]>(() => wczytaj<WpisPrzebiegu>(KEY_KM));
  const [rok, setRok] = useState(new Date().getFullYear());
  // formularz środka
  const [nazwa, setNazwa] = useState('');
  const [wartosc, setWartosc] = useState('');
  const [metoda, setMetoda] = useState<'jednorazowa' | 'liniowa'>('jednorazowa');
  const [stawka, setStawka] = useState('20');
  // kalkulator auta
  const [naped, setNaped] = useState<NapedAuta>('spalinowe');
  const [cenaAuta, setCenaAuta] = useState('');
  const [rokAuta, setRokAuta] = useState(String(new Date().getFullYear()));
  // wpis km
  const [trasa, setTrasa] = useState('');
  const [km, setKm] = useState('');
  const [cel, setCel] = useState('');

  const odpisy = useMemo(() => srodki.map((s) => ({ s, r: odpisZaRok(s, rok, 0) })), [srodki, rok]);
  const sumaOdpisow = odpisy.reduce((a, o) => a + o.r.odpis, 0);
  const limit = (Number(cenaAuta) || 0) > 0 ? limitAuta(naped, Number(cenaAuta), Number(rokAuta) || rok) : null;

  function dodajSrodek(): void {
    const w = Number(wartosc) || 0;
    if (!nazwa.trim() || !(w > 0)) return;
    const next = [...srodki, {
      id: uid('st'), nazwa: nazwa.trim(), wartosc: w,
      dataNabycia: todayISO(), metoda, stawkaRoczna: metoda === 'liniowa' ? Number(stawka) || 20 : undefined,
    }];
    setSrodki(next);
    zapisz(KEY_SRODKI, next);
    setNazwa('');
    setWartosc('');
  }

  function dodajWpis(): void {
    const k = Number(km) || 0;
    if (!trasa.trim() || !(k > 0)) return;
    const next = [...wpisy, { id: uid('km'), data: todayISO(), trasa: trasa.trim(), km: k, cel: cel.trim() || 'służbowo' }];
    setWpisy(next);
    zapisz(KEY_KM, next);
    setTrasa('');
    setKm('');
  }

  return (
    <>
      <div className="card">
        <h3>Środki trwałe i amortyzacja</h3>
        {srodki.length === 0 ? (
          <p className="muted">Pusto — dodaj np. laptopa powyżej 10 tys. (jednorazowo albo liniowo).</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nazwa</th><th className="num">Wartość</th><th>Metoda</th><th className="num">Odpis {rok}</th><th className="num">Netto</th><th /></tr></thead>
              <tbody>
                {odpisy.map(({ s, r }) => (
                  <tr key={s.id}>
                    <td><b>{s.nazwa}</b><div className="muted">{s.dataNabycia}</div></td>
                    <td className="num">{fmtMoney(s.wartosc)}</td>
                    <td>{s.metoda === 'jednorazowa' ? 'jednorazowa' : `liniowa ${s.stawkaRoczna}%`}</td>
                    <td className="num"><b>{fmtMoney(r.odpis)}</b></td>
                    <td className="num">{fmtMoney(r.wartoscNetto)}</td>
                    <td><button className="btn ghost small" onClick={() => { const next = srodki.filter((x) => x.id !== s.id); setSrodki(next); zapisz(KEY_SRODKI, next); }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="muted" style={{ marginTop: 6 }}>
          Suma odpisów {rok}: <b>{fmtMoney(sumaOdpisow)}</b> (KUP — ujmij w kosztach rocznego PIT){' '}
          • rok: <input type="number" value={rok} onChange={(e) => setRok(Number(e.target.value) || rok)} style={{ maxWidth: 90 }} aria-label="Rok odpisu" />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div><label className="muted">Nazwa</label><input value={nazwa} onChange={(e) => setNazwa(e.target.value)} placeholder="Laptop" /></div>
          <div><label className="muted">Wartość (zł)</label><input type="number" min={0} step="any" value={wartosc} onChange={(e) => setWartosc(e.target.value)} style={{ maxWidth: 140 }} /></div>
          <div>
            <label className="muted">Metoda</label>
            <select value={metoda} onChange={(e) => setMetoda(e.target.value as typeof metoda)}>
              <option value="jednorazowa">Jednorazowa</option>
              <option value="liniowa">Liniowa</option>
            </select>
          </div>
          {metoda === 'liniowa' && (
            <div><label className="muted">Stawka %/rok</label><input type="number" min={1} max={100} value={stawka} onChange={(e) => setStawka(e.target.value)} style={{ maxWidth: 90 }} /></div>
          )}
          <div style={{ alignSelf: 'end' }}><button className="btn small" onClick={dodajSrodek}>Dodaj środek</button></div>
        </div>
      </div>

      <div className="card">
        <h3>Limit auta 2026 (kalkulator)</h3>
        <div className="row">
          <div>
            <label className="muted">Napęd</label>
            <select value={naped} onChange={(e) => setNaped(e.target.value as NapedAuta)}>
              <option value="ev">EV / wodór (cap 225k)</option>
              <option value="niskoemisyjne">&lt;50g CO₂ (cap 150k)</option>
              <option value="spalinowe">Spalinowe (cap 100k)</option>
            </select>
          </div>
          <div><label className="muted">Wartość (zł)</label><input type="number" min={0} step="any" value={cenaAuta} onChange={(e) => setCenaAuta(e.target.value)} style={{ maxWidth: 150 }} /></div>
          <div><label className="muted">Rok wprowadzenia</label><input type="number" value={rokAuta} onChange={(e) => setRokAuta(e.target.value)} style={{ maxWidth: 100 }} /></div>
        </div>
        {limit && (
          <div className={limit.nadwyzka > 0 ? 'warn' : 'info'} style={{ marginTop: 8 }}>
            {limit.opis} — odliczalne {fmtMoney(limit.odliczalne)}
            {limit.nadwyzka > 0 ? `, nadwyżka ${fmtMoney(limit.nadwyzka)} bez amortyzacji/leasingu.` : ' — całość w limicie.'}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Ewidencja przebiegu (pojazd 100% + VAT-26)</h3>
        <div className="muted">Suma: <b>{sumaKm(wpisy)} km</b> ({wpisy.length} wpisów)</div>
        <div className="row" style={{ marginTop: 8 }}>
          <div><label className="muted">Trasa</label><input value={trasa} onChange={(e) => setTrasa(e.target.value)} placeholder="Gdańsk–Warszawa" /></div>
          <div><label className="muted">km</label><input type="number" min={0} step="any" value={km} onChange={(e) => setKm(e.target.value)} style={{ maxWidth: 100 }} /></div>
          <div><label className="muted">Cel</label><input value={cel} onChange={(e) => setCel(e.target.value)} placeholder="klient" /></div>
          <div style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
            <button className="btn small" onClick={dodajWpis}>Dodaj wpis</button>
            <button className="btn secondary small" disabled={wpisy.length === 0} onClick={() => download(`ewidencja-przebiegu-${rok}.csv`, ewidencjaCsv(wpisy))}>
              Eksport CSV
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
