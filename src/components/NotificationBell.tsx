"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, onMount } from "./market-ui";
import { useAuth } from "./AuthProvider";

interface Note {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Feed {
  notifications: Note[];
  unread: number;
}

/** How often the bell looks for new notifications. */
const POLL_MS = 30_000;

function when(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The notification centre.
 *
 * Polls rather than holding a socket open: notifications are minutes-scale by
 * nature (the alert engine itself only runs once a minute), so a socket would
 * buy nothing for the complexity.
 */
export function NotificationBell() {
  const { account } = useAuth();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const signedIn = Boolean(account);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      setFeed(await fetchJson<Feed>("/api/notifications"));
    } catch {
      // A failed poll is not worth a visible error in the header; the next
      // one in thirty seconds will most likely succeed.
    }
  }, [signedIn]);

  useEffect(() => onMount(load), [load]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [signedIn, load]);

  // Click outside and Escape both close the panel, as with any menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!signedIn) return null;

  const unread = feed?.unread ?? 0;
  const notes = feed?.notifications ?? [];

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Opening the bell is what counts as reading them.
    if (next && unread > 0) {
      try {
        await fetchJson<{ unread: number }>("/api/notifications", {
          method: "POST",
        });
        setFeed((current) =>
          current
            ? {
                unread: 0,
                notifications: current.notifications.map((note) =>
                  note.readAt ? note : { ...note, readAt: new Date().toISOString() },
                ),
              }
            : current,
        );
      } catch {
        // Leaving the badge up is the harmless failure here.
      }
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        aria-expanded={open}
        className="relative inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-surface text-muted transition hover:border-border-strong hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
          <path
            d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10.5 19a2 2 0 0 0 3 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[17px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-[17px] text-accent-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted">
            Notifications
          </div>
          {notes.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs leading-relaxed text-muted">
              Nothing yet. Price alerts and Auto-sell will report here.
            </p>
          ) : (
            <ul className="max-h-[22rem] overflow-y-auto">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="border-b border-border/60 px-4 py-3 last:border-0"
                >
                  <p className="text-sm font-medium">{note.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {note.body}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-faint">
                    <span>{when(note.createdAt)}</span>
                    {note.link && (
                      <a
                        href={note.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        Open ↗
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
