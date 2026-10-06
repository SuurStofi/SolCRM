'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Whole seconds remaining until `deadline`, ticking down to zero. Passing null
 * parks it at zero and runs no timer.
 *
 * The timer only forces a re-render; the value is derived during render so it
 * can never lag a deadline that has just been replaced.
 */
export function useSecondsLeft(deadline: number | null): number {
  const [, tick] = useState(0);

  useEffect(() => {
    if (deadline === null) return;

    const timer = setInterval(() => {
      tick((n) => n + 1);
      if (secondsUntil(deadline) <= 0) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [deadline]);

  return secondsUntil(deadline);
}

function secondsUntil(deadline: number | null): number {
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

export function Panel({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rise flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-muted">{icon}</span>}
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="flex-1 px-5 py-4">{children}</div>
    </section>
  );
}

/** Label above a group of rows. */
export function SectionLabel({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
        {children}
      </span>
      {trailing}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5 text-sm last:border-0">
      {children}
    </div>
  );
}

export function ErrorNote({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-bad/30 bg-bad-bg px-3.5 py-3 text-sm text-bad">
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent ${className}`}
    />
  );
}

export function RefreshButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label="Refresh"
      className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
      >
        <path
          d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {loading ? 'Loading' : 'Refresh'}
    </button>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const tones = {
    neutral: 'bg-surface-subtle text-muted border-border',
    good: 'bg-good-bg text-good border-good/25',
    warn: 'bg-warn-bg text-warn border-warn/25',
    bad: 'bg-bad-bg text-bad border-bad/25',
    accent: 'bg-accent/10 text-accent border-accent/25',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-tight ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Placeholder line used while data loads, to avoid layout jumping. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-border/70 ${className}`} />
  );
}

/**
 * Expand/collapse control for a list that shows a preview by default.
 * Renders nothing when the preview already covers everything, so a short list
 * does not carry a control that would do nothing.
 */
export function ShowMore({
  expanded,
  total,
  previewCount,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  previewCount: number;
  onToggle: () => void;
}) {
  if (total <= previewCount) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2 text-[11px] font-medium text-muted underline-offset-2 transition hover:text-foreground hover:underline"
    >
      {expanded ? `Show fewer` : `Show all ${total}`}
    </button>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-faint">{children}</p>;
}

/** External link with a consistent affordance. */
export function ExtLink({
  href,
  children,
  mono = false,
}: {
  href: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`group inline-flex items-center gap-1 text-muted transition hover:text-foreground ${
        mono ? 'font-mono text-xs' : ''
      }`}
    >
      {children}
      <svg
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-100"
      >
        <path
          d="M4 2h6v6M10 2 2.5 9.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

/** Copy-to-clipboard affordance for addresses. */
export function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="rounded p-1 text-faint transition hover:bg-surface-subtle hover:text-foreground"
    >
      <svg viewBox="0 0 14 14" fill="none" aria-hidden="true" className="h-3 w-3">
        <rect
          x="4.5"
          y="4.5"
          width="8"
          height="8"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M9.5 4.5v-1a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3.5V8A1.5 1.5 0 0 0 3 9.5h1"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
