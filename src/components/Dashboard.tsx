'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { shortenAddress } from '@/lib/solana/read';
import { useAuth } from './AuthProvider';
import { AccountPanel } from './AccountPanel';
import { WalletPanel } from './WalletPanel';
import { BinancePanel } from './BinancePanel';
import { TransferPanel } from './TransferPanel';
import { BuyPanel } from './BuyPanel';
import { ConvertPanel } from './ConvertPanel';
import { HoldingsCharts } from './HoldingsCharts';
import { P2PAdsPanel } from './P2PAdsPanel';
import { P2POrdersPanel } from './P2POrdersPanel';
import { AutoTradePanel } from './AutoTradePanel';
import { ExchangePanel } from './ExchangePanel';
import { ComparePanel } from './ComparePanel';
import { RateLimitBanner } from './RateLimitBanner';
import { ErrorNote, Spinner } from './ui';

/**
 * Chooses between the sign-in screen and the dashboard. Every panel below the
 * account reads per-user data, so none of them mount until there is a session.
 */
export function Dashboard() {
  const { account, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }

  if (!account) return <SignIn />;

  return (
    <>
      <RateLimitBanner />
      <Tabs />
    </>
  );
}

const TABS = [
  { id: 'home', label: 'Home', hint: 'Your wallet & account' },
  { id: 'market', label: 'Market', hint: 'Exchange & transfer' },
  { id: 'p2p', label: 'P2P', hint: 'Trade with people & auto-sell' },
  { id: 'exchange', label: 'Dealer', hint: 'Buy & sell · BestChange' },
  { id: 'compare', label: 'Compare', hint: 'Sort by price' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** The hash is `#tab` or `#tab/section`; this reads the tab part. */
function tabFromHash(): TabId | null {
  const hash = window.location.hash.slice(1).split('/')[0];
  return TABS.find((tab) => tab.id === hash)?.id ?? null;
}

/**
 * The workspaces. The tab lives in the URL hash so a reload stays put.
 *
 * A tab mounts on first visit and then stays mounted, only hidden: Market
 * holds in-progress transfer and buy UI, and unmounting it on a tab switch
 * would drop that state.
 */
function Tabs() {
  const [active, setActive] = useState<TabId>('home');
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>(['home']));

  const open = useCallback((id: TabId) => {
    setActive(id);
    setVisited((seen) => (seen.has(id) ? seen : new Set(seen).add(id)));
  }, []);

  useEffect(() => {
    // Read after mount: the server render has no hash, so reading it during
    // render would mismatch on hydration.
    const sync = () => {
      const id = tabFromHash();
      if (id) open(id);
    };
    void Promise.resolve().then(sync);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [open]);

  function select(id: TabId) {
    history.replaceState(null, '', `#${id}`);
    open(id);
  }

  return (
    <>
      <nav
        role="tablist"
        aria-label="Workspaces"
        className="mb-5 flex gap-1 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-card)]"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => select(tab.id)}
            className={`flex flex-1 flex-col items-center rounded-lg px-3 py-2 transition sm:flex-row sm:justify-center sm:gap-2 ${
              active === tab.id
                ? 'bg-accent text-accent-fg'
                : 'text-muted hover:bg-surface-subtle hover:text-foreground'
            }`}
          >
            <span className="text-sm font-semibold">{tab.label}</span>
            <span
              className={`text-[11px] ${active === tab.id ? 'text-accent-fg/80' : 'text-faint'}`}
            >
              {tab.hint}
            </span>
          </button>
        ))}
      </nav>

      <div role="tabpanel" hidden={active !== 'home'}>
        <HomeTab />
      </div>
      {visited.has('market') && (
        <div role="tabpanel" hidden={active !== 'market'}>
          <MarketTab />
        </div>
      )}
      {visited.has('p2p') && (
        <div role="tabpanel" hidden={active !== 'p2p'}>
          <P2PTab />
        </div>
      )}
      {visited.has('exchange') && (
        <div role="tabpanel" hidden={active !== 'exchange'}>
          <ExchangePanel />
        </div>
      )}
      {visited.has('compare') && (
        <div role="tabpanel" hidden={active !== 'compare'}>
          <ComparePanel />
        </div>
      )}
    </>
  );
}

/**
 * One task at a time: each section says in plain words what it is for and
 * how it works, instead of every panel on one long page.
 */
const HOME_SECTIONS = [
  {
    id: 'wallet',
    label: 'My wallet',
    title: 'What you have',
    about: 'Your Solana wallet and your Binance account, side by side. Nothing here moves money.',
    steps: [],
  },
  {
    id: 'account',
    label: 'My account',
    title: 'Account and Binance connection',
    about: 'Your wallets, your Binance API key and where bought SOL goes.',
    steps: [],
  },
] as const;

type HomeSectionId = (typeof HOME_SECTIONS)[number]['id'];

const MARKET_SECTIONS = [
  {
    id: 'swap',
    label: 'Exchange',
    title: 'Exchange one coin for another',
    about:
      'Swap between any two coins Binance supports, on your own Binance account. Nothing leaves Binance, and nothing moves on the blockchain.',
    steps: [],
  },
  {
    id: 'transfer',
    label: 'Transfer',
    title: 'Move coins between Binance and your wallet',
    about:
      'Everything that crosses between your Phantom wallet and Binance. Exchanging inside Binance is instant; moving on-chain takes a minute or two and costs a network fee.',
    steps: [],
  },
] as const;

type MarketSectionId = (typeof MARKET_SECTIONS)[number]['id'];

const P2P_SECTIONS = [
  {
    id: 'people',
    label: 'Trade with people',
    title: 'Trade with people (P2P)',
    about:
      'P2P means person to person: you sell or buy crypto directly with someone who pays by bank card or transfer. Binance holds the crypto until the payment arrives, so neither side can run off with it.',
    steps: [
      'Find a good offer below and open it on Binance.',
      'Make the deal in the Binance app — this app cannot do that part for you.',
      'Optionally, save the deal here to keep track of it.',
    ],
  },
  {
    id: 'auto',
    label: 'Auto-sell',
    title: 'Sell automatically at your price',
    about: 'Watches Binance P2P for you and acts when a buyer offers at least your price.',
    steps: [
      'Set the lowest price you accept and how much SOL to sell.',
      'Turn it on. The server checks prices every minute.',
      'When the price is reached, it exchanges your SOL to USDT and posts a sale ad on Binance, then turns itself off.',
    ],
  },
] as const;

type P2PSectionId = (typeof P2P_SECTIONS)[number]['id'];

/** The hash is `#tab/section`; this reads the section for one tab. */
function sectionFromHash<T extends string>(
  tabId: string,
  ids: readonly { id: T }[],
): T | null {
  const [tab, section] = window.location.hash.slice(1).split('/');
  if (tab !== tabId) return null;
  return ids.find((s) => s.id === section)?.id ?? null;
}

interface SectionMeta {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly about: string;
  readonly steps: readonly string[];
}

/**
 * The chips and the explanation block above a tab's panels. Shared so Home and
 * Market cannot drift apart visually.
 */
function SectionChrome({
  label,
  sections,
  active,
  onSelect,
}: {
  label: string;
  sections: readonly SectionMeta[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const section = sections.find((s) => s.id === active) ?? sections[0];

  return (
    <>
      {sections.length > 1 && (
        <nav aria-label={label} className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={active === s.id ? 'page' : undefined}
              onClick={() => onSelect(s.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                active === s.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      )}

      <div className="mb-5 rounded-xl border border-border bg-surface-subtle px-5 py-4">
        <h2 className="text-base font-semibold tracking-tight">{section.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{section.about}</p>
        {section.steps.length > 0 && (
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {section.steps.map((step, index) => (
              <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

/** Keeps the active section in the URL hash so a reload stays put. */
function useHashSection<T extends string>(
  tabId: string,
  sections: readonly { id: T }[],
  initial: T,
): [T, (id: T) => void] {
  const [active, setActive] = useState<T>(initial);

  useEffect(() => {
    // Read after mount: the server render has no hash, so reading it during
    // render would mismatch on hydration.
    const sync = () => {
      const id = sectionFromHash(tabId, sections);
      if (id) setActive(id);
    };
    void Promise.resolve().then(sync);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [tabId, sections]);

  const select = useCallback(
    (id: T) => {
      history.replaceState(null, '', `#${tabId}/${id}`);
      setActive(id);
    },
    [tabId],
  );

  return [active, select];
}

/** Wallet and account: what you have and how it is connected. */
function HomeTab() {
  const [active, select] = useHashSection('home', HOME_SECTIONS, 'wallet');

  return (
    <>
      <GettingStarted onOpenAccount={() => select('account')} />

      <SectionChrome
        label="Home sections"
        sections={HOME_SECTIONS}
        active={active}
        onSelect={(id) => select(id as HomeSectionId)}
      />

      <div hidden={active !== 'wallet'}>
        <HoldingsCharts />
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <WalletPanel />
          <BinancePanel />
        </div>
      </div>
      <div hidden={active !== 'account'} className="mx-auto max-w-2xl">
        <AccountPanel />
      </div>
    </>
  );
}

/** Exchanging inside Binance, and moving coins in or out of it. */
function MarketTab() {
  const [active, select] = useHashSection('market', MARKET_SECTIONS, 'swap');

  return (
    <>
      <SectionChrome
        label="Market sections"
        sections={MARKET_SECTIONS}
        active={active}
        onSelect={(id) => select(id as MarketSectionId)}
      />

      {/* Both sections stay mounted, only hidden: each holds a live quote that
          expires in seconds, and switching must not discard one. */}
      <div hidden={active !== 'swap'} className="mx-auto max-w-2xl">
        <ConvertPanel />
      </div>
      <div hidden={active !== 'transfer'}>
        <TransferSection onOpenExchange={() => select('swap')} />
      </div>
    </>
  );
}

/** Trading with people, and the robot that does it at a set price. */
function P2PTab() {
  const [active, select] = useHashSection('p2p', P2P_SECTIONS, 'people');

  return (
    <>
      <SectionChrome
        label="P2P sections"
        sections={P2P_SECTIONS}
        active={active}
        onSelect={(id) => select(id as P2PSectionId)}
      />

      <div hidden={active !== 'people'} className="grid items-start gap-5 lg:grid-cols-2">
        <P2PAdsPanel />
        <P2POrdersPanel />
      </div>
      <div hidden={active !== 'auto'} className="mx-auto max-w-3xl">
        <AutoTradePanel />
      </div>
    </>
  );
}

const MOVES = [
  {
    id: 'sell',
    label: 'Sell SOL',
    flow: 'Phantom → Binance → USDT',
    about: 'Send SOL from your wallet to Binance and turn it into USDT.',
  },
  {
    id: 'buy',
    label: 'Buy SOL',
    flow: 'USDT → Solana → Phantom',
    about: 'Spend USDT already on Binance to get SOL, optionally withdrawn to your wallet.',
  },
  {
    id: 'toSol',
    label: 'Any coin → SOL',
    flow: 'any coin → Solana → Phantom',
    about: 'Turn any coin you hold on Binance into SOL, then withdraw it to your wallet.',
  },
] as const;

type MoveId = (typeof MOVES)[number]['id'];

/**
 * The three ways coins cross between Binance and the wallet.
 *
 * All panels stay mounted: each holds a quote that expires in seconds, and
 * switching between moves must not discard one mid-decision.
 */
function TransferSection({ onOpenExchange }: { onOpenExchange: () => void }) {
  const [move, setMove] = useState<MoveId>('sell');
  const current = MOVES.find((m) => m.id === move) ?? MOVES[0];

  return (
    <div className="mx-auto max-w-2xl">
      <div
        role="tablist"
        aria-label="What to move"
        className="mb-3 flex gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {MOVES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={move === m.id}
            onClick={() => setMove(m.id)}
            className={`flex flex-1 flex-col items-center rounded-md px-2 py-2 text-center transition ${
              move === m.id
                ? 'bg-accent text-accent-fg'
                : 'text-muted hover:bg-surface-subtle hover:text-foreground'
            }`}
          >
            <span className="text-sm font-medium">{m.label}</span>
            <span
              className={`text-[10px] leading-tight ${move === m.id ? 'text-accent-fg/80' : 'text-faint'}`}
            >
              {m.flow}
            </span>
          </button>
        ))}
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted">{current.about}</p>

      <div hidden={move !== 'sell'}>
        <TransferPanel />
      </div>
      <div hidden={move !== 'buy'}>
        <BuyPanel />
      </div>
      <div hidden={move !== 'toSol'}>
        <AnyCoinToSol onOpenExchange={onOpenExchange} />
      </div>
    </div>
  );
}

/**
 * Any coin -> SOL -> Phantom.
 *
 * Presented as the two steps it actually is, rather than one button. The Buy
 * flow's withdrawal leg is tied to a BuyFlow record and keyed to USDT in both
 * its route and its schema, so no single backend call converts an arbitrary
 * coin and withdraws in one transaction. Rather than fake a pipeline the
 * server cannot run, this routes to the two steps that do work.
 *
 * It deliberately does not mount its own ConvertPanel: a second instance would
 * repeat the ~430-asset load and hold a separate quote.
 */
function AnyCoinToSol({ onOpenExchange }: { onOpenExchange: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface-subtle px-4 py-4">
      <ol className="grid gap-2.5">
        {[
          'In Exchange, pick the coin you hold and SOL as the target, check the price and confirm. The SOL lands on your Binance account.',
          'Come back here to Buy SOL and withdraw it to Phantom. With auto-withdraw on (Home → My account) that happens for you.',
        ].map((step, index) => (
          <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-muted">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onOpenExchange}
        className="mt-3.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
      >
        Open Exchange
      </button>
    </div>
  );
}

/**
 * The two things every action on this tab needs, as a checklist. It goes
 * away once both are done.
 */
function GettingStarted({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { connected } = useWallet();
  const { account, connectedWalletLinked, linkConnectedWallet } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!account) return null;
  const walletReady = connected && connectedWalletLinked;
  const keyReady = account.binance !== null;
  if (walletReady && keyReady) return null;

  async function link() {
    setBusy(true);
    setError(null);
    try {
      await linkConnectedWallet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not link the wallet.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 px-5 py-4">
      <h2 className="text-sm font-semibold">Before you start — 2 quick steps</h2>
      <p className="mt-0.5 text-xs text-muted">
        Selling SOL needs both. Buying needs only the Binance step.
      </p>

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <ol className="mt-3 space-y-2.5">
        <ChecklistItem
          done={walletReady}
          title="Connect your wallet"
          detail={
            !connected
              ? 'Open Phantom (or another Solana wallet) so the app can see your SOL.'
              : !connectedWalletLinked
                ? 'This wallet is connected but not added to your account yet.'
                : 'Connected.'
          }
          action={
            !connected ? (
              <WalletMultiButton />
            ) : !connectedWalletLinked ? (
              <button
                type="button"
                onClick={() => void link()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
              >
                {busy && <Spinner className="border-t-accent-fg" />}
                <span>Add this wallet</span>
              </button>
            ) : null
          }
        />
        <ChecklistItem
          done={keyReady}
          title="Connect your Binance account"
          detail="Paste an API key from Binance. It lets this app see your balance and exchange for you — it cannot take your money out unless you allow withdrawals."
          action={
            keyReady ? null : (
              <button
                type="button"
                onClick={onOpenAccount}
                className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110"
              >
                Add API key
              </button>
            )
          }
        />
      </ol>
    </div>
  );
}

function ChecklistItem({
  done,
  title,
  detail,
  action,
}: {
  done: boolean;
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            done ? 'bg-good text-white' : 'border border-border-strong text-faint'
          }`}
          aria-hidden="true"
        >
          {done ? '✓' : ''}
        </span>
        <div className="min-w-0">
          <p className={`text-sm font-medium ${done ? 'text-muted line-through' : ''}`}>{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{detail}</p>
        </div>
      </div>
      {!done && action}
    </li>
  );
}

/** Header badge: which account is signed in. */
export function AccountBadge() {
  const { account } = useAuth();
  if (!account) return null;
  const first = account.wallets[0]?.address;
  return (
    <span className="rounded-md border border-border bg-surface-subtle px-2 py-1 font-mono text-[11px] font-medium text-muted">
      {first ? shortenAddress(first, 4) : 'signed in'}
    </span>
  );
}

function SignIn() {
  const { connected, publicKey } = useWallet();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise mx-auto flex max-w-sm flex-col items-center gap-5 rounded-xl border border-border bg-surface px-6 py-10 text-center shadow-[var(--shadow-card)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-fg">
        S
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">Sign in with your wallet</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Your wallet is your account — no password. New wallets get an account automatically.
          You sign a message, not a transaction: nothing is sent and no fee is paid.
        </p>
      </div>

      {error && (
        <div className="w-full text-left">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {connected && publicKey ? (
        <div className="flex w-full flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Spinner className="border-t-accent-fg" />}
            <span>Sign in as {shortenAddress(publicKey.toBase58(), 4)}</span>
          </button>
          <WalletMultiButton />
        </div>
      ) : (
        <WalletMultiButton />
      )}
    </div>
  );
}
