// Ulgi PIT: wspólne rozliczenie, IP Box 5%, B+R, zwrot składek (ryczałt),
// rozliczenie roczne zdrowotnej ryczałtowca. Szacunki do weryfikacji z US/interpretacją.
import { useState, type JSX } from 'react';
import { odliczenieBR, ryczaltPodatek, ulgaIpBox, wspolneRozliczenie } from '../../src-shared/tax/pit.js';
import { rozliczenieZdrowotnejRyczalt } from '../../src-shared/tax/zus.js';
import type { TaxForm } from '../../src-shared/tax/types.js';
import { fmtMoney } from '../lib/format.js';

export function Ulgi({
  forma,
  dochodSkala,
  przychodRoczny,
  stawkaRyczaltu,
  ryczaltSplit,
  odliczenieRyczalt,
  spoleczneRoczne,
  zdrowotnaZapłacona,
}: {
  forma: TaxForm;
  dochodSkala: number;
  przychodRoczny: number;
  stawkaRyczaltu: number;
  ryczaltSplit: { stawka: number; przychod: number }[];
  odliczenieRyczalt: number;
  spoleczneRoczne: number;
  zdrowotnaZapłacona: number;
}): JSX.Element {
  const [dochodWsp, setDochodWsp] = useState(Math.max(0, Math.round(dochodSkala)));
  const [ipDochod, setIpDochod] = useState('');
  const [brKoszty, setBrKoszty] = useState('');
  const [zwrot, setZwrot] = useState('');

  const wsp = wspolneRozliczenie(dochodWsp || 0);
  const ipNum = Number(ipDochod) || 0;
  const ip = ulgaIpBox(ipNum, forma === 'liniowy' ? 'liniowy' : 'skala');
  const brNum = Number(brKoszty) || 0;
  const brOdl = odliczenieBR(brNum);
  const brStawka = forma === 'liniowy' ? 0.19 : forma === 'ryczalt' ? stawkaRyczaltu : 0.12;
  const zwrotNum = Number(zwrot) || 0;
  // Zwrot wchodzi w przychód: przelicz split proporcjonalnie do wyższego przychodu.
  const zwrotPodatekEff = zwrotNum > 0
    ? (() => {
      const razem = ryczaltSplit.reduce((a, p) => a + p.przychod, 0) || przychodRoczny;
      const skala = razem > 0 ? (razem + zwrotNum) / razem : 1;
      const split = (ryczaltSplit.length > 0 ? ryczaltSplit : [{ stawka: stawkaRyczaltu, przychod: razem }])
        .map((p) => ({ stawka: p.stawka, przychod: Math.round(p.przychod * skala * 100) / 100 }));
      return ryczaltPodatek(split, stawkaRyczaltu, odliczenieRyczalt);
    })()
    : null;
  const rozl = rozliczenieZdrowotnejRyczalt(przychodRoczny, spoleczneRoczne, zdrowotnaZapłacona);

  return (
    <div className="card">
      <h3>Ulgi i rozliczenia roczne (szacunki)</h3>
      <div className="row">
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>Wspólne rozliczenie małżonków</b>
          {forma !== 'skala' ? (
            <div className="muted">Zablokowane na {forma === 'liniowy' ? 'liniowym (PIT-36L)' : 'ryczałcie (PIT-28)'} — tylko skala (PIT-36).</div>
          ) : (
            <>
              <div className="muted">Dochód do podziału na pół:</div>
              <input type="number" min={0} step="any" value={dochodWsp} onChange={(e) => setDochodWsp(Number(e.target.value))} style={{ maxWidth: 160 }} />
              <div className="muted" style={{ marginTop: 4 }}>
                Samodzielnie: {fmtMoney(wsp.samodzielnie)} • wspólnie: <b>{fmtMoney(wsp.wspolnie)}</b>
                {wsp.korzysc > 0 ? ` • korzyść ${fmtMoney(wsp.korzysc)}` : ' • bez korzyści'}
              </div>
            </>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>IP Box 5%</b>
          <div className="muted">Kwalifikowany dochód z IP (ewidencja + interpretacja wymagane):</div>
          <input type="number" min={0} step="any" value={ipDochod} onChange={(e) => setIpDochod(e.target.value)} placeholder="np. 100000" style={{ maxWidth: 160 }} />
          {ipNum > 0 && (
            <div className="muted" style={{ marginTop: 4 }}>
              Normalnie: {fmtMoney(ip.podatekNormalnie)} • IP Box: <b>{fmtMoney(ip.podatekIpBox)}</b> • oszczędność {fmtMoney(ip.oszczednosc)}
            </div>
          )}
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>B+R (art. 26e)</b>
          <div className="muted">Koszty kwalifikowane do odliczenia od podstawy:</div>
          <input type="number" min={0} step="any" value={brKoszty} onChange={(e) => setBrKoszty(e.target.value)} placeholder="np. 50000" style={{ maxWidth: 160 }} />
          {brNum > 0 && (
            <div className="muted" style={{ marginTop: 4 }}>
              Odliczenie: {fmtMoney(brOdl)} • szac. oszczędność PIT ~{fmtMoney(Math.round(brOdl * brStawka * 100) / 100)} (stawka brzegowa — do weryfikacji)
            </div>
          )}
        </div>
        {forma === 'ryczalt' && (
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>Zwrot odliczonych składek → przychód</b>
            <div className="muted">Zwrócone składki dolicz do przychodu roku zwrotu:</div>
            <input type="number" min={0} step="any" value={zwrot} onChange={(e) => setZwrot(e.target.value)} placeholder="np. 2000" style={{ maxWidth: 160 }} />
            {zwrotPodatekEff !== null && (
              <div className="muted" style={{ marginTop: 4 }}>
                Podatek po zwrocie: <b>{fmtMoney(zwrotPodatekEff)}</b>
              </div>
            )}
            <div className="muted" style={{ marginTop: 6 }}>
              Rozliczenie zdrowotnej: tier {fmtMoney(rozl.miesieczna)}/mies. • należna {fmtMoney(rozl.naleznaRok)} •{' '}
              {rozl.roznica > 0 ? <>dopłata <b>{fmtMoney(rozl.roznica)}</b> (DRA za IV do 20 V)</> : rozl.roznica < 0 ? <>nadpłata {fmtMoney(-rozl.roznica)} (wniosek o zwrot do 1 VI)</> : 'na zero'}
            </div>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Ulga na start w PIT nie dotyczy B2B. IP Box wymaga ewidencji IP i interpretacji; B+R — mnożnika z art. 26e/18d.
      </p>
    </div>
  );
}
