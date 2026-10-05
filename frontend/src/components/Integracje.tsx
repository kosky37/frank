import { useMemo, useState, type JSX } from 'react';
import { aggregateMonth } from '../../src-shared/tax/pit.js';
import {
  buildJpkV7M,
  buildKsefFA3,
  buildZusDraXml,
  czyNipPoprawny,
  mikrorachunek,
} from '../../src-shared/tax/integrations.js';
import { updateSettings, useStore } from '../lib/store.js';
import { monthLabel, todayISO } from '../lib/format.js';
import { Field } from './ui.js';
import { DeklaracjeZus } from './DeklaracjeZus.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const KODY_TYTULU = [
  { kod: '05 40', opis: 'Start (ulga 6 mies.)' },
  { kod: '05 90', opis: 'Mały ZUS Plus' },
  { kod: '01 10', opis: 'Duży ZUS' },
];

export function IntegracjeTab(): JSX.Element {
  const { sales, costs, settings } = useStore();
  const miesiace = useMemo(() => {
    const s = new Set<string>();
    sales.forEach((x) => s.add(x.dataSprzedazy.slice(0, 7)));
    costs.forEach((x) => s.add(x.dataKsiegowania.slice(0, 7)));
    if (s.size === 0) s.add(todayISO().slice(0, 7));
    return [...s].sort();
  }, [sales, costs]);
  const [miesiac, setMiesiac] = useState(miesiace[miesiace.length - 1] ?? todayISO().slice(0, 7));
  const [idFaktury, setIdFaktury] = useState('');

  const sums = useMemo(
    () => aggregateMonth(miesiac, sales, costs, settings),
    [miesiac, sales, costs, settings],
  );
  const fakturyMiesiaca = sales.filter(
    (s) => s.dataSprzedazy.slice(0, 7) === miesiac && s.status !== 'robocza',
  );
  const wybrana = fakturyMiesiaca.find((f) => f.id === idFaktury) ?? fakturyMiesiaca[0];
  const mikro =
    settings.firmaNip && czyNipPoprawny(settings.firmaNip) ? mikrorachunek(settings.firmaNip) : null;

  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void {
    updateSettings({ [k]: v } as Partial<typeof settings>);
  }

  const podmiot = {
    nip: settings.firmaNip,
    nazwa: settings.firmaNazwa,
    adres: settings.firmaAdres,
    email: settings.firmaEmail,
  };
  const podgladJpk = buildJpkV7M(miesiac, sales, costs, sums, podmiot).payload.slice(0, 800);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Integracje</h2>
          <p>KSeF, JPK_V7M, ZUS DRA, NBP i mikrorachunek — klucze w jednym miejscu, pliki do pobrania.</p>
        </div>
      </div>
      <div className="sections">
        <div className="card">
          <h3>Środowisko i klucze</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Środowisko KSeF">
              <div className="row">
                <label className="inline">
                  <input
                    type="radio"
                    checked={(settings.ksefSrodowisko ?? 'demo') === 'demo'}
                    onChange={() => set('ksefSrodowisko', 'demo')}
                  />
                  Demo (ksef-test)
                </label>
                <label className="inline">
                  <input
                    type="radio"
                    checked={settings.ksefSrodowisko === 'prod'}
                    onChange={() => set('ksefSrodowisko', 'prod')}
                  />
                  Produkcja
                </label>
              </div>
            </Field>
            <Field label="Token KSeF 2.0" hint="Z ksef-test.mf.gov.pl (demo) — do 31.12.2026, potem certyfikat + ZAW-FA.">
              <input
                type="password"
                value={settings.ksefToken ?? ''}
                onChange={(e) => set('ksefToken', e.target.value)}
                placeholder="Wklej token…"
                autoComplete="off"
              />
            </Field>
            <Field label="Klucz API GUS BIR (REGON)" hint="Z api.stat.gov.pl — NBP nie wymaga klucza.">
              <input
                value={settings.gusApiKey ?? ''}
                onChange={(e) => set('gusApiKey', e.target.value)}
                placeholder="Klucz BIR…"
                autoComplete="off"
              />
            </Field>
            <Field label="Indywidualny rachunek ZUS (NRS)" hint="Z PUE/eZUS — służy do przelewów składek.">
              <input
                value={settings.zusNrs ?? ''}
                onChange={(e) => set('zusNrs', e.target.value)}
                placeholder="NRS…"
                inputMode="numeric"
              />
            </Field>
            <Field label="Kod tytułu ZUS">
              <select value={settings.zusKodTytulu ?? '01 10'} onChange={(e) => set('zusKodTytulu', e.target.value)}>
                {KODY_TYTULU.map((k) => (
                  <option key={k.kod} value={k.kod}>
                    {k.kod} — {k.opis}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Adres e-Doręczeń" hint="Obowiązkowy dla CEIDG od 1.10.2026 (edoreczenia.gov.pl).">
              <input
                value={settings.edoreczeniaAdres ?? ''}
                onChange={(e) => set('edoreczeniaAdres', e.target.value)}
                placeholder="ADE:PL-…"
              />
            </Field>
          </div>
        </div>

        <div className="card">
          <h3>Pliki do wysyłki</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Miesiąc">
              <select className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
                {miesiace.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            </Field>
            <Field label="Faktura do KSeF">
              <select value={wybrana?.id ?? ''} onChange={(e) => setIdFaktury(e.target.value)}>
                {fakturyMiesiaca.length === 0 && <option value="">(brak faktur w miesiącu)</option>}
                {fakturyMiesiaca.map((f) => (
                  <option key={f.id} value={f.id}>{f.numer} — {f.kontrahent.nazwa}</option>
                ))}
              </select>
            </Field>
            <div className="row">
              <button
                className="btn"
                onClick={() =>
                  download(`JPK_V7M-${miesiac}.xml`, buildJpkV7M(miesiac, sales, costs, sums, podmiot).payload)}
              >
                Pobierz JPK_V7M
              </button>
              <button
                className="btn secondary"
                disabled={!wybrana}
                onClick={() => {
                  if (wybrana) download(`KSeF-${wybrana.numer.replaceAll('/', '-')}.json`, buildKsefFA3(wybrana, settings.firmaNip ?? '').payload);
                }}
              >
                Pobierz KSeF FA(3)
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  download(
                    `ZUS-DRA-${miesiac}.xml`,
                    buildZusDraXml(miesiac, sums, settings.zusNrs ?? '', settings.zusKodTytulu ?? '01 10', settings.zusFPMies).payload,
                  )}
              >
                Pobierz ZUS DRA
              </button>
            </div>
            {mikro && (
              <p className="muted">
                Mikrorachunek z NIP firmy (do weryfikacji w generatorze MF): <b>{mikro}</b>
              </p>
            )}
            <pre>{podgladJpk}…</pre>
          </div>
        </div>

        <DeklaracjeZus miesiace={miesiace} sales={sales} costs={costs} settings={settings} />

        <div className="card">
          <h3>Jak to podłączyć (skrót)</h3>
          <ol className="muted" style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>KSeF: token z ksef-test.mf.gov.pl → wklej wyżej; produkcja wymaga certyfikatu + ZAW-FA.</li>
            <li>JPK_V7M: pobierz XML, podpisz kwalifikowanym (~200 zł/rok) i wyślij przez e-Urząd.</li>
            <li>ZUS: konto PUE/eZUS + NRS; kod tytułu zgodny ze schematem (05 40 / 05 90 / 01 10).</li>
            <li>GUS BIR: klucz z api.stat.gov.pl; NBP bez klucza (kursy z automatu).</li>
            <li>e-Doręczenia: skrzynka na edoreczenia.gov.pl; Twój e-PIT: 15 II – 30 IV.</li>
          </ol>
          <p className="muted">Pełna instrukcja klik-po-kliku: <b>docs/INTEGRACJE.md</b> (demo vs prod).</p>
        </div>
      </div>
    </>
  );
}
