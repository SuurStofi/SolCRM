'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

/**
 * Portfolio composition as a donut.
 *
 * Part-to-whole at a glance with at most six segments, which is the case a
 * donut is for. Close values are the thing an arc reads badly, so the legend
 * carries the exact percentage for every slice -- the ring gives the shape,
 * the legend gives the numbers.
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

// Geometry. The ring is thin by the same logic as every other mark here.
const SIZE = 132;
const RADIUS = 52;
const THICKNESS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Separation is a gap in the surface colour, not a stroke around each arc. */
const GAP = 2;

/**
 * Smallest arc a slice may render as. A holding worth 0.00001% would otherwise
 * round to nothing and read as absent rather than tiny.
 */
const MIN_ARC = 3;

/**
 * Tracks the rendered theme, since dark is its own validated step set rather
 * than a flip of the light one.
 *
 * The theme is external state (a media query plus an attribute on <html>), so
 * it is subscribed to rather than copied into state in an effect. The server
 * snapshot is `true`: there is no DOM to read during prerender, and dark is
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
    () => true,
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

  // Arc lengths in circumference units, so the gap is in the same units. The
  // offset is the running sum of the slices before this one.
  const arcs = slices.map((slice, index) => {
    const share = slice.value / total;
    const offset =
      slices.slice(0, index).reduce((sum, s) => sum + s.value, 0) / total * CIRCUMFERENCE;
    return {
      dash: Math.max(MIN_ARC, share * CIRCUMFERENCE - GAP),
      offset,
      share: share * 100,
    };
  });

  const leader = slices.length > 0 ? arcs[hovered ?? 0] : null;
  const leaderSlice = slices.length > 0 ? slices[hovered ?? 0] : null;

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
        /* One holding is not a part-to-whole story. The number is the chart. */
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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="relative shrink-0">
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label={`${title}: ${slices
                .map((s, i) => `${s.label} ${arcs[i].share.toFixed(1)} percent`)
                .join(', ')}`}
            >
              {/* Rotated so the first slice starts at twelve o'clock, which is
                  where a reader looks first. */}
              <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
                {arcs.map((arc, index) => (
                  <circle
                    key={slices[index].label}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={colorAt(index)}
                    strokeWidth={THICKNESS}
                    // Arc length then the rest of the ring as empty space; the
                    // offset walks each slice around the circle.
                    strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                    strokeDashoffset={-arc.offset}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                    className={`cursor-default transition-opacity ${
                      hovered !== null && hovered !== index ? 'opacity-40' : ''
                    }`}
                  >
                    <title>{`${slices[index].label} · ${slices[index].display} · ${arc.share.toFixed(1)}%`}</title>
                  </circle>
                ))}
              </g>
            </svg>

            {/* The hole carries the hovered slice, so the ring is readable
                without a floating tooltip. Defaults to the largest holding. */}
            {leader && leaderSlice && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="tabular text-base font-semibold leading-none">
                  {leader.share < 0.1 ? '<0.1' : leader.share.toFixed(1)}%
                </span>
                <span className="mt-0.5 max-w-[72px] truncate text-[10px] leading-tight text-muted">
                  {leaderSlice.label}
                </span>
              </div>
            )}
          </div>

          {/* The legend is always present and labels every series, which is the
              relief the light-mode contrast WARN requires -- and it carries the
              exact percentages an arc cannot convey for close values. */}
          <ul className="min-w-[160px] flex-1 grid gap-1.5">
            {slices.map((slice, index) => (
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
                  {arcs[index].share < 0.1 ? '<0.1%' : `${arcs[index].share.toFixed(1)}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
