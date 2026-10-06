import type { Metadata } from 'next';
// Self-hosted rather than next/font/google: fetching from fonts.googleapis.com
// at build time silently falls back to a system font on any network that
// cannot reach it, so the app renders differently depending on where it is
// built. The package ships the same faces and sets the same CSS variables.
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { SolanaProviders } from '@/components/WalletProvider';

export const metadata: Metadata = {
  title: 'SolCRM',
  description: 'Personal Solana wallet / Binance / P2P dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <SolanaProviders>{children}</SolanaProviders>
      </body>
    </html>
  );
}
