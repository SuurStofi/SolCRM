'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

/**
 * Portfolio composition as a horizontal stacked bar.
 *
 * Part-to-whole with a handful of named categories, so a stacked bar rather
 * than a pie: shares are read along one axis instead of by arc angle, and
 * horizontal gives long ticker names room.
 */

export interface Holding {
  label: string;
  /** Share weight. Must be in ONE unit across the whole chart. */
  value: number;
  /** Shown in the legend instead of the raw number. */
  display: string;
}

/**
 * Categorical slots 1-5 of the validated default theme, in fixed order, never
 * cycled. Each mode has its own steps -- dark is a selected set, not a flip.
 *
 * Validated with the dataviz validator in both modes: lightness band, chroma
 * floor, CVD separation and normal-vision floor all pass. Light carries a
 * documented contrast WARN on aqua, yellow and magenta, so every series is
 * labelled in the legend -- identity never rests on colour alone.
 */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as const;

/**
 * The folded tail is the de-emphasis gray, not a sixth hue: a generated hue
 * would be indistinguishable from an existing one under CVD.
 */
const OTHER_LIGHT = '#8d9099';
const OTHER_DARK = '#6b6e77';

const MAX_SLICES = SERIES_LIGHT.length;

/**
 * Tracks the rendered theme, since dark is its own validated step set rather
 * than a flip of the light one.
 *
 * The theme is external state (a media query plus an attribute on <html>), so
 * it is subscribed to rather than copied into state in an effect. The server
 * snapshot is `false`: there is no DOM to read during prerender, and light is
 * the default palette.
 */
function useIsDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', onChange);
      // An explicit choice is stamped on <html>, which no media query reports.
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      return () => {
        media.removeEventListener('change', onChange);
        observer.disconnect();
      };
    },
    () => {
      const attr = document.documentElement.dataset.theme;
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    () => false,
  );
}

export function HoldingsChart({
  title,
  holdings,
  note,
  empty,
  action,
}: {
  title: string;
  holdings: Holding[];
  note?: string;
  empty: ReactNode;
  action?: ReactNode;
}) {
  const isDark = useIsDark();
  const [hovered, setHovered] = useState<number | null>(null);

  const palette = isDark ? SERIES_DARK : SERIES_LIGHT;
  const other = isDark ? OTHER_DARK : OTHER_LIGHT;

  const positive = holdings.filter((h) => h.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((sum, h) => sum + h.value, 0);

  // Past the slot ceiling the tail folds into one gray "Other" rather than
  // generating more hues, which would fail every CVD check.
  const folded = positive.length > MAX_SLICES;
  const slices = folded
    ? [
        ...positive.slice(0, MAX_SLICES - 1),
        {
          label: 'Other',
          value: positive.slice(MAX_SLICES - 1).reduce((sum, h) => sum + h.value, 0),
          display: `${positive.length - (MAX_SLICES - 1)} coins`,
        },
      ]
    : positive;

  const colorAt = (index: number) =>
    folded && index === MAX_SLICES - 1 ? other : palette[index];

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {note && <p className="mt-0.5 text-[11px] leading-tight text-faint">{note}</p>}
        </div>
        {action}
      </header>

      {total <= 0 ? (
        <p className="py-8 text-sm text-faint">{empty}</p>
      ) : slices.length === 1 ? (
        /* One holding is not a part-to-whole story, and a single-segment
           stacked bar is a one-bar chart. The number is the chart. */
        <div className="py-2">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-[1.75rem] font-semibold leading-none tracking-tight">
              {slices[0].display}
            </span>
            <span className="text-sm font-medium text-muted">{slices[0].label}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            The only holding here, so it is all of it.
          </p>
        </div>
      ) : (
        <>
          {/* Segments are separated by a 2px gap in the surface colour rather
              than a stroke, so no segment gains a visual border. */}
          <div
            className="flex h-7 w-full gap-[2px]"
            role="img"
            aria-label={`${title}: ${slices
              .map((s) => `${s.label} ${((s.value / total) * 100).toFixed(1)} percent`)
              .join(', ')}`}
          >
            {slices.map((slice, index) => (
              <div
                key={slice.label}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                title={`${slice.label} · ${slice.display} · ${((slice.value / total) * 100).toFixed(1)}%`}
                style={{
                  width: `${(slice.value / total) * 100}%`,
                  background: colorAt(index),
                }}
                className={`h-full min-w-[3px] transition-opacity first:rounded-l last:rounded-r ${
                  hovered !== null && hovered !== index ? 'opacity-40' : ''
                }`}
              />
            ))}
          </div>

          {/* The legend is always present and labels every series, which is the
              relief the light-mode contrast WARN requires. */}
          <ul className="mt-3.5 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {slices.map((slice, index) => {
              const share = (slice.value / total) * 100;
              return (
                <li
                  key={slice.label}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  className={`flex items-baseline gap-2 text-xs transition-opacity ${
                    hovered !== null && hovered !== index ? 'opacity-50' : ''
                  }`}
                >
                  <span
                    aria-hidden="true"
                    style={{ background: colorAt(index) }}
                    className="relative top-[2px] h-2.5 w-2.5 shrink-0 rounded-sm"
                  />
                  {/* Text keeps its own ink tokens; the swatch carries identity. */}
                  <span className="min-w-0 flex-1 truncate font-medium">{slice.label}</span>
                  <span className="tabular shrink-0 text-muted">{slice.display}</span>
                  <span className="tabular w-11 shrink-0 text-right text-faint">
                    {share < 0.1 ? '<0.1%' : `${share.toFixed(1)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
