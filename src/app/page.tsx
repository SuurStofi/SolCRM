import { WalletPanel } from '@/components/WalletPanel';
import { BinancePanel } from '@/components/BinancePanel';

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SolCRM</h1>
          <p className="text-sm text-neutral-500">
            Wallet, exchange, and P2P in one place
          </p>
        </div>
        <span className="text-xs text-neutral-400">Phase 1 - read only</span>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <WalletPanel />
        <BinancePanel />
      </div>

      <footer className="mt-8 text-xs leading-relaxed text-neutral-400">
        Non-custodial: your Solana private key stays in your wallet. Binance
        credentials are read server-side only and never sent to the browser.
      </footer>
    </main>
  );
}
