import { useEffect, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import type { InvoiceStatus } from '../../src-shared/tax/types.js';
import type { Theme } from '../lib/theme.js';

// ---------- ikony (zestaw w stylu lucide, rysowane kreską) ----------

const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  invoice: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  calculator: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8" /><path d="M16 14v4" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  send: <><path d="m22 2-11 11" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  copy: <><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  printer: <><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
  more: <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  trash: <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>,
  wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></>,
  trend: <><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  undo: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  building: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></>,
  repeat: <><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>,
  bank: <><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  minus: <path d="M5 12h14" />,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }): JSX.Element {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------- toasty ----------

export type ToastTone = 'ok' | 'err' | 'info';
interface ToastItem { id: number; tone: ToastTone; text: string }

let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = (): void => toastListeners.forEach((l) => l());

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

/** Krótki komunikat w rogu ekranu (zamiast inline'owych statusów). */
export function toast(text: string, tone: ToastTone = 'ok', ms = tone === 'err' ? 7000 : 3500): void {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-3), { id, tone, text }];
  emitToasts();
  setTimeout(() => dismissToast(id), ms);
}

export function Toaster(): JSX.Element {
  const list = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <Icon name={t.tone === 'ok' ? 'checkCircle' : t.tone === 'err' ? 'alert' : 'info'} size={17} />
          <div className="msg">{t.text}</div>
          <button onClick={() => dismissToast(t.id)} aria-label="Zamknij powiadomienie">
            <Icon name="x" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Kopiuje do schowka i potwierdza toastem. */
export function kopiuj(text: string, co = 'Skopiowano do schowka'): void {
  if (!navigator.clipboard) {
    toast('Schowek niedostępny w tej przeglądarce', 'err');
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => toast(co),
    () => toast('Nie udało się skopiować', 'err'),
  );
}

// ---------- okna ----------

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Modal({
  title,
  onClose,
  children,
  foot,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
}): JSX.Element {
  useEscape(onClose);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

/** Panel boczny (szczegóły dokumentu). */
export function Drawer({
  title,
  sub,
  onClose,
  children,
  foot,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
}): JSX.Element {
  useEscape(onClose);
  return (
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="title">
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij">
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </aside>
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  /** separator przed pozycją */
  sep?: boolean;
}

/** Rozwijane menu akcji („Więcej”). */
export function Menu({
  items,
  label = 'Więcej',
  icon = 'more',
  up,
  left,
  small = true,
}: {
  items: MenuItem[];
  label?: string;
  icon?: IconName;
  up?: boolean;
  left?: boolean;
  small?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={`btn secondary${small ? ' small' : ''}${label ? '' : ' icon-only'}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label || 'Więcej akcji'}
      >
        <Icon name={icon} size={16} />
        {label}
      </button>
      {open && (
        <div className={`menu${up ? ' up' : ''}${left ? ' left' : ''}`} role="menu">
          {items.map((it, i) => (
            <div key={i} style={{ display: 'contents' }}>
              {it.sep && <hr />}
              <button
                role="menuitem"
                className={it.danger ? 'danger' : undefined}
                disabled={it.disabled}
                title={it.title}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.icon && <Icon name={it.icon} size={16} />}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- zakładki ----------

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
}): JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`tab${value === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
}): JSX.Element {
  return (
    <div className="pills" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={`pill${value === o.id ? ' active' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- drobne ----------

export type BadgeTone = 'gray' | 'green' | 'amber' | 'red' | 'blue';

export function Badge({ tone = 'gray', children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }): JSX.Element {
  return <span className={`badge${tone === 'gray' ? '' : ` ${tone}`}`} title={title}>{children}</span>;
}

export function Field({
  label,
  children,
  hint,
  error,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}): JSX.Element {
  return (
    <label className={className}>
      {label}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Empty({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: IconName;
}): JSX.Element {
  return (
    <div className="empty">
      {icon && <Icon name={icon} size={34} />}
      <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>{title}</div>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/** Two-click delete: first click arms, second confirms. */
export function ConfirmButton({
  label = 'Usuń',
  confirmLabel = 'Na pewno?',
  onConfirm,
}: {
  label?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}): JSX.Element {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed)
    return (
      <button className="btn secondary small" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span className="muted">{confirmLabel}</span>
      <button className="btn danger small" onClick={onConfirm}>
        Tak
      </button>
      <button className="btn secondary small" onClick={() => setArmed(false)}>
        Nie
      </button>
    </span>
  );
}

const STATUS_META: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  robocza: { label: 'Robocza', tone: 'gray' },
  wystawiona: { label: 'Wystawiona', tone: 'blue' },
  w_ksef: { label: 'W KSeF', tone: 'green' },
  oplacona: { label: 'Opłacona', tone: 'green' },
};

export function StatusBadge({ status }: { status: InvoiceStatus }): JSX.Element {
  const m = STATUS_META[status] ?? { label: status, tone: 'gray' as BadgeTone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Progress({ value, tone }: { value: number; tone?: 'red' | 'amber' }): JSX.Element {
  return (
    <div className={`progress${tone ? ` ${tone}` : ''}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export interface ChartPalette {
  grid: string;
  tick: string;
  revenue: string;
  cost: string;
  vatIn: string;
  vatOut: string;
  line: string;
  tip: Record<string, string | number>;
}

export function chartPalette(theme: Theme): ChartPalette {
  const tipBase = { borderRadius: 10, fontSize: 13 };
  if (theme === 'dark')
    return {
      grid: '#262c38',
      tick: '#98a2b3',
      revenue: '#8b8cff',
      cost: '#475467',
      vatIn: '#8b8cff',
      vatOut: '#fdb022',
      line: '#f2f4f7',
      tip: { ...tipBase, backgroundColor: '#13161d', border: '1px solid #262c38', color: '#f2f4f7' },
    };
  return {
    grid: '#eaecf0',
    tick: '#667085',
    revenue: '#4f46e5',
    cost: '#c7cdd8',
    vatIn: '#818cf8',
    vatOut: '#f79009',
    line: '#101828',
    tip: { ...tipBase, backgroundColor: '#ffffff', border: '1px solid #e4e7ec', color: '#101828' },
  };
}
