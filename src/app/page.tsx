import { WalletPanel } from '@/components/WalletPanel';
import { BinancePanel } from '@/components/BinancePanel';
import { TransferPanel } from '@/components/TransferPanel';
import { P2PAdsPanel } from '@/components/P2PAdsPanel';
import { P2POrdersPanel } from '@/components/P2POrdersPanel';
import { RateLimitBanner } from '@/components/RateLimitBanner';

export default function DashboardPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface/60 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-accent-fg">
              S
            </span>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold tracking-tight">SolCRM</h1>
              <p className="text-[11px] text-faint">Wallet · Exchange · P2P</p>
            </div>
          </div>
          <span className="rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] font-medium text-muted">
            Phase 3 · P2P discovery
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
        <RateLimitBanner />

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <WalletPanel />
          <BinancePanel />
        </div>

        <div className="mt-5">
          <TransferPanel />
        </div>

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
          <P2PAdsPanel />
          <P2POrdersPanel />
        </div>

        <footer className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-[11px] text-faint">
          <span className="flex items-center gap-1.5">
            <Dot /> Private key never leaves your wallet
          </span>
          <span className="flex items-center gap-1.5">
            <Dot /> Binance credentials stay server-side
          </span>
          <span className="flex items-center gap-1.5">
            <Dot /> Secrets scrubbed from all logs
          </span>
        </footer>
      </main>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-good" aria-hidden="true" />;
}
