// Kwota słownie po polsku (np. „dwadzieścia cztery tysiące sześćset złotych 00/100”).

const JEDNOSCI = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const NASTKI = [
  'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście',
  'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście',
];
const DZIESIATKI = [
  '', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści',
  'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt',
];
const SETKI = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
const GRUPY: [string, string, string][] = [
  ['', '', ''],
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['milion', 'miliony', 'milionów'],
  ['miliard', 'miliardy', 'miliardów'],
];

/** Odmiana: 1 → [0], 2–4 (bez 12–14) → [1], reszta → [2]. */
export function odmiana(n: number, formy: [string, string, string]): string {
  if (n === 1) return formy[0];
  const d = n % 10;
  const s = n % 100;
  if (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) return formy[1];
  return formy[2];
}

function trojka(n: number): string {
  const s = Math.floor(n / 100);
  const reszta = n % 100;
  const out = [SETKI[s]];
  if (reszta >= 10 && reszta < 20) out.push(NASTKI[reszta - 10]);
  else {
    out.push(DZIESIATKI[Math.floor(reszta / 10)]);
    out.push(JEDNOSCI[reszta % 10]);
  }
  return out.filter(Boolean).join(' ');
}

/** Liczba całkowita słownie (0 → „zero”). */
export function liczbaSlownie(liczba: number): string {
  let n = Math.floor(Math.abs(liczba));
  if (n === 0) return 'zero';
  const czesci: string[] = [];
  let g = 0;
  while (n > 0 && g < GRUPY.length) {
    const t = n % 1000;
    if (t > 0) {
      const slowa = g > 0 && t === 1 ? GRUPY[g][0] : [trojka(t), g > 0 ? odmiana(t, GRUPY[g]) : ''].filter(Boolean).join(' ');
      czesci.unshift(slowa);
    }
    n = Math.floor(n / 1000);
    g++;
  }
  return (liczba < 0 ? 'minus ' : '') + czesci.join(' ');
}

const WALUTY: Record<string, [string, string, string]> = {
  PLN: ['złoty', 'złote', 'złotych'],
  EUR: ['euro', 'euro', 'euro'],
  USD: ['dolar', 'dolary', 'dolarów'],
  GBP: ['funt', 'funty', 'funtów'],
  CHF: ['frank', 'franki', 'franków'],
};

/** „dwadzieścia cztery tysiące sześćset złotych 00/100” */
export function kwotaSlownie(kwota: number, waluta = 'PLN'): string {
  const grosze = Math.round(Math.abs(kwota) * 100);
  const calosc = Math.floor(grosze / 100);
  const reszta = grosze % 100;
  const formy = WALUTY[waluta.toUpperCase()] ?? [waluta, waluta, waluta];
  const znak = kwota < 0 ? 'minus ' : '';
  return `${znak}${liczbaSlownie(calosc)} ${odmiana(calosc, formy)} ${String(reszta).padStart(2, '0')}/100`;
}
