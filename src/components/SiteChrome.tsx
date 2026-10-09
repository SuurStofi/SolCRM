"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand, Arrow } from "./Brand";
import { useAuth } from "./AuthProvider";
import { NotificationBell } from "./NotificationBell";
import { shortenAddress } from "@/lib/solana/read";

export function SiteHeader() {
  const workspace = usePathname() === "/app";
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav
          className={`site-nav ${open ? "is-open" : ""}`}
          aria-label="Main navigation"
        >
          <Link href="/#features" onClick={() => setOpen(false)}>
            Features
          </Link>
          <Link href="/#how-it-works" onClick={() => setOpen(false)}>
            How it works
          </Link>
          <Link href="/#faq" onClick={() => setOpen(false)}>
            FAQ
          </Link>
        </nav>
        <div className="header-actions">
          {workspace ? (
            <>
              <NotificationBell />
              <AccountBadge />
            </>
          ) : (
            <Link href="/app" className="button button-small">
              Open app <Arrow />
            </Link>
          )}
          <button
            type="button"
            className="menu-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div>
          <Brand />
          <p>
            A little more clarity.
            <br />A lot less switching tabs.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/#features">Features</Link>
          <Link href="/#how-it-works">Getting started</Link>
          <Link href="/#faq">Questions & answers</Link>
          <Link href="/app">Open workspace ↗</Link>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} SolCRM</span>
        <span>Built for your Solana workflow.</span>
        <span className="network-label">
          <i /> Solana mainnet
        </span>
      </div>
    </footer>
  );
}

function AccountBadge() {
  const { account } = useAuth();
  if (!account)
    return <span className="text-xs text-muted">Wallet sign-in</span>;
  const address = account.wallets[0]?.address;
  return (
    <Link
      href="/app#home/account"
      className="rounded-full border border-border bg-surface px-3 py-2 font-mono text-xs text-muted"
      aria-label="Open account settings"
    >
      {address ? shortenAddress(address, 4) : "My account"}
    </Link>
  );
}
