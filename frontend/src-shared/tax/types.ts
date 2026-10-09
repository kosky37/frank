// Wspólne typy domenowe — JDG B2B programista, rok 2026
// Używane zarówno w main (SQLite) jak i w rendererze (React).

export type TaxForm = 'skala' | 'liniowy' | 'ryczalt';
export type VehicleUsage = 'prywatny' | 'mieszany' | 'wylacznie_firma';
export type VatRate = 0.23 | 0.08 | 0.05 | 0 | 'zw' | 'np' | 'oo';
export type InvoiceStatus = 'robocza' | 'wystawiona' | 'w_ksef' | 'oplacona';
/** Rodzaj dokumentu sprzedaży (proforma nie wchodzi do PIT/VAT). */
export type RodzajFaktury = 'sprzedazy' | 'korygujaca' | 'zaliczkowa' | 'proforma' | 'uproszczona';
/** Tryb nadania do KSeF (offline24/awaria: data faktury = data z dokumentu). */
export type TrybKsef = 'online' | 'offline24' | 'awaria';
export type CostCategory =
  | 'paliwo'
  | 'eksploatacja_pojazdu'
  | 'sprzet'
  | 'oprogramowanie'
  | 'uslugi'
  | 'biuro'
  | 'inne';

export interface Contractor {
  id: string;
  nazwa: string;
  nip: string;
  adres: string;
  email?: string;
}

export interface InvoiceItem {
  nazwa: string;
  ilosc: number;
  cenaNetto: number;
  stawkaVat: VatRate;
  /** stawka ryczałtu dla pozycji (tylko forma ryczałt); pusta = domyślna z ustawień */
  stawkaRyczaltu?: number;
}

export interface SalesInvoice {
  id: string;
  numer: string;
  kontrahent: Contractor;
  dataWystawienia: string; // ISO yyyy-mm-dd
  dataSprzedazy: string;
  terminPlatnosci: string;
  pozycje: InvoiceItem[];
  status: InvoiceStatus;
  ksefId?: string;
  zaplacona?: boolean;
  /** rodzaj dokumentu (domyślnie sprzedaż); proforma NIE wchodzi do PIT/VAT */
  rodzaj?: RodzajFaktury;
  /** numer faktury korygowanej (dla rodzaju korygująca) */
  korygujeNumer?: string;
  /** pozycja z zał. 15 ustawy o VAT (towary wrażliwe → MPP powyżej 15k) */
  zal15?: boolean;
  /** tryb nadania do KSeF (domyślnie online) */
  trybKsef?: TrybKsef;
  /** waluta faktury (domyślnie PLN); VAT zawsze w PLN po kursie NBP */
  waluta?: string;
  /** kurs NBP (średni z dnia roboczego przed sprzedażą) użyty do VAT w PLN */
  kursNbp?: number;
  /** mechanizm podzielonej płatności (MPP) — wymagany gdy zał. 15 i brutto >15k */
  mpp?: boolean;
  /** nr rachunku do zapłaty + czy zweryfikowany na Białej Liście (dowód: timestamp) */
  rachunekBankowy?: string;
  bialaListaSprawdzona?: string; // ISO timestamp sprawdzenia
}

export interface CostInvoice {
  id: string;
  numer: string;
  wystawca: string;
  nipWystawcy?: string;
  dataZakupu: string;
  dataKsiegowania: string;
  kategoria: CostCategory;
  /** true jeśli wydatek związany z pojazdem */
  pojazdowy: boolean;
  uzytkowaniePojazdu: VehicleUsage;
  netto: number;
  stawkaVat: VatRate;
  /** np. paliwo na paragonie bez NIP — brak odliczenia VAT */
  vatNaliczonyDowolny?: number;
  opis: string;
  /** numer KSeF faktury zakupowej (z odbioru KSeF → <NrKSeF> w JPK; brak = <BFK>) */
  ksefId?: string;
  /** koszt reprezentacji / mandat / wydatek prywatny (art. 23 PIT) — nigdy KUP */
  nieodliczalnyArt23?: boolean;
}

export interface TaxpayerSettings {
  formaOpodatkowania: TaxForm;
  /** stawka ryczałtu, domyślnie 12% dla IT (PKWiU 62.01) */
  stawkaRyczaltu: number;
  vatowiec: boolean;
  /** rozliczenie miesięczne / kwartalne */
  okresVat: 'miesieczny' | 'kwartalny';
  zaliczkaPit: 'miesieczna' | 'kwartalna';
  /** składki ZUS płacone miesięcznie (społeczne + zdrowotna + FP) */
  zusSpoleczneMies: number;
  zusZdrowotnaMies: number;
  zusFPMies: number;
  /**
   * Schemat ZUS: start (ulga 6m, tylko zdrowotna) | preferencyjny (24m) |
   * maly_plus (Mały ZUS Plus, 36m w oknie 60m) | duzy.
   * Legacy: 'ulgowy' = start, 'maly' = maly_plus (mapowane w api.ts).
   */
  zusSchemat: 'start' | 'preferencyjny' | 'maly_plus' | 'duzy' | 'ulgowy' | 'maly';
  /** kod tytułu ubezpieczenia do DRA: 05 40 (start) / 05 90 (mały) / 01 10 (duży) */
  zusKodTytulu?: string;
  /** data rozpoczęcia działalności (do liczenia ulg i pro-rata limitów) */
  dataRozpoczeciaDzialalnosci?: string;
  /** wakacje składkowe: miesiąc yyyy-mm zwolniony ze społecznych + FP (zdrowotna zostaje) */
  wakacjeSkladkoweMiesiac?: string;
  uzytkowaniePojazdu: VehicleUsage;
  /** zgłoszony VAT-26 (pojazd wyłącznie firmowy) */
  vat26Zgloszony: boolean;
  // Profil firmy (sprzedawca na fakturach)
  firmaNazwa?: string;
  firmaNip?: string;
  firmaRegon?: string;
  firmaAdres?: string;
  firmaEmail?: string;
  firmaTelefon?: string;
  /** Dane właściciela JDG do JPK (Podmiot1 OsobaFizyczna + dane autoryzujące). */
  wlascicielImie?: string;
  wlascicielNazwisko?: string;
  /** Data urodzenia właściciela RRRR-MM-DD (wymagana w JPK dla osoby fizycznej). */
  wlascicielDataUrodzenia?: string;
  /** domyślny rachunek do faktur (gdy faktura nie ma własnego) */
  firmaRachunek?: string;
  firmaBank?: string;
  /** domyślny termin płatności faktur w dniach */
  terminPlatnosciDni?: number;
  /** kody PKD firmy, np. ["62.01.Z"] */
  pkd?: string[];
  // --- Integracje (sekrety użytkownika; nigdy do repo) ---
  /** token KSeF 2.0 (do 31.12.2026; potem certyfikat) */
  ksefToken?: string;
  /** środowisko KSeF: test (api-test) | demo (api-demo, przedprod) | prod */
  ksefSrodowisko?: 'test' | 'demo' | 'prod';
  /** kod urzędu skarbowego do nagłówka JPK (4 cyfry) */
  kodUrzedu?: string;
  /** klucz API GUS BIR (REGON), NBP bez klucza */
  gusApiKey?: string;
  /** indywidualny rachunek ZUS do przelewów (NRS) */
  zusNrs?: string;
  /** e-Doręczenia: adres skrzynki (obowiązek CEIDG od 1.10.2026) */
  edoreczeniaAdres?: string;
}

export interface MonthlySums {
  miesiac: string; // yyyy-mm
  przychodNetto: number;
  kosztyNettoPit: number; // po korekcie 75%/100% dla pojazdu
  vatNalezny: number;
  vatNaliczony: number; // po korekcie 50% dla pojazdu mieszanego
  zusSpoleczne: number;
  zusZdrowotna: number;
  /** przychód w rozbiciu na stawki ryczałtu (tylko forma ryczałt) */
  ryczaltSplit: { stawka: number; przychod: number }[];
}
