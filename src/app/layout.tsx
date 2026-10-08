import type { Metadata } from "next";
// Self-hosted rather than next/font/google: fetching from fonts.googleapis.com
// at build time silently falls back to a system font on any network that
// cannot reach it, so the app renders differently depending on where it is
// built. The package ships the same faces and sets the same CSS variables.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { SolanaProviders } from "@/components/WalletProvider";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "SolCRM",
  description:
    "Your Solana wallet, Binance account, and trading tools in one clear workspace. Connect your wallet, view your assets, and make your next move.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SolanaProviders>
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <SiteHeader />
          {children}
          <SiteFooter />
        </SolanaProviders>
      </body>
    </html>
  );
}
