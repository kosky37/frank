import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { InvoiceStatus } from '../../src-shared/tax/types.js';
import type { Theme } from '../lib/theme.js';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
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
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export type BadgeTone = 'gray' | 'green' | 'amber' | 'red' | 'blue';

export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ReactNode }): JSX.Element {
  return <span className={`badge${tone === 'gray' ? '' : ` ${tone}`}`}>{children}</span>;
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}): JSX.Element {
  return (
    <label>
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
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty">
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
      grid: '#22304d',
      tick: '#8fa1bd',
      revenue: '#7ea4ff',
      cost: '#5b6b88',
      vatIn: '#7ea4ff',
      vatOut: '#f5a524',
      line: '#e8eef7',
      tip: { ...tipBase, backgroundColor: '#111a2e', border: '1px solid #22304d', color: '#e8eef7' },
    };
  return {
    grid: '#e3e8f0',
    tick: '#64748b',
    revenue: '#2563eb',
    cost: '#94a3b8',
    vatIn: '#60a5fa',
    vatOut: '#f59e0b',
    line: '#0f172a',
    tip: { ...tipBase, backgroundColor: '#ffffff', border: '1px solid #e3e8f0', color: '#0f172a' },
  };
}
