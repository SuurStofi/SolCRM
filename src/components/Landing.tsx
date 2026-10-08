"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Arrow, BrandMark } from "./Brand";
import { Aurora } from "./Aurora";

const features = [
  {
    number: "01",
    symbol: "◎",
    title: "Your balances. Together.",
    text: "See your Solana wallet and Binance holdings side by side. Know what you have before your next move.",
    tag: "Wallet & portfolio",
    href: "/app#home/wallet",
  },
  {
    number: "02",
    symbol: "⇄",
    title: "Less friction. More flow.",
    text: "Exchange on Binance, buy SOL, or move it between Binance and your wallet. Follow each step in one workspace.",
    tag: "Exchange & transfer",
    href: "/app#market",
  },
  {
    number: "03",
    symbol: "↗",
    title: "Find your next offer.",
    text: "Browse Binance P2P and BestChange dealer offers. Compare prices and payment methods before you choose.",
    tag: "P2P & comparison",
    href: "/app#compare",
  },
];
export function Landing() {
  const router = useRouter();
  useEffect(() => {
    // Keep previously shared workspace bookmarks working after adding the landing.
    const hash = window.location.hash;
    if (/^#(home|market|p2p|exchange|compare)(\/|$)/.test(hash))
      router.replace(`/app${hash}`);
  }, [router]);
  return (
    <main id="main-content" className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <Aurora />
        <div className="hero-content">
          <span className="eyebrow">
            <i /> YOUR SOLANA WORKSPACE
          </span>
          <h1 id="hero-title">
            All your moves.
            <br />
            <span>One calm place.</span>
          </h1>
          <p>
            Your wallet, your exchange, your next trade.
            <br className="desktop-break" /> Bring your Solana workflow together
            with SolCRM.
          </p>
          <div className="hero-actions">
            <Link href="/app" className="button">
              Enter your workspace <Arrow />
            </Link>
            <a href="#how-it-works" className="text-link">
              See how it works <span>↘</span>
            </a>
          </div>
          <div className="hero-note">
            <span>◇</span> Sign in with your wallet. No password needed.
          </div>
        </div>
        <WorkspacePreview />
        <div className="ecosystem-strip">
          <span>ONE WORKSPACE. CONNECTED TO YOUR TOOLS.</span>
          <div>
            <b>◎ Solana</b>
            <b>◕ Phantom</b>
            <b>▧ Binance</b>
            <b>⇄ BestChange</b>
          </div>
        </div>
      </section>
      <section id="features" className="landing-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LESS NOISE, MORE CONTROL</span>
            <h2>
              Everything you need.
              <br />
              <span>Room to breathe.</span>
            </h2>
          </div>
          <p>
            No maze of tabs. Just a clear place to check your balances, move
            your assets, and explore your options.
          </p>
        </div>
        <div className="feature-grid">
          {features.map((f) => (
            <Link className="feature-card" href={f.href} key={f.number}>
              <div className="feature-top">
                <span className="feature-symbol">{f.symbol}</span>
                <span>{f.number}</span>
              </div>
              <span className="feature-tag">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <span className="feature-link">
                Explore workspace <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section id="how-it-works" className="landing-section how-section">
        <div>
          <span className="eyebrow">A FAMILIAR WAY IN</span>
          <h2>
            Your wallet is
            <br />
            <span>your starting point.</span>
          </h2>
          <p className="section-copy">
            Start with Phantom or another compatible Solana wallet. Connect
            Binance when you’re ready to use exchange tools.
          </p>
          <Link href="/app" className="text-link">
            Let’s get you set up <Arrow />
          </Link>
        </div>
        <ol className="steps">
          {[
            [
              "Connect your wallet",
              "Choose your Solana wallet in the app. You stay in control of your private key.",
            ],
            [
              "Sign a message",
              "Confirm your sign-in in your wallet. This is a message, not a transaction, so there’s no network fee.",
            ],
            [
              "Make yourself at home",
              "Check your wallet, link your own Binance account, and choose the tools you need.",
            ],
          ].map(([title, text], i) => (
            <li key={title}>
              <span>0{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section id="faq" className="landing-section faq-section">
        <div>
          <span className="eyebrow">GOOD TO KNOW</span>
          <h2>
            A little clarity
            <br />
            <span>before you connect.</span>
          </h2>
        </div>
        <div className="faq-list">
          {[
            [
              "What is SolCRM?",
              "A personal workspace for your Solana wallets, Binance account, and trading tools. View balances, exchange assets, move SOL, and compare P2P and dealer offers in one place.",
            ],
            [
              "Does signing in move any funds?",
              "No. Signing in asks your wallet to sign a one-time message to prove ownership. It does not send a transaction or charge a network fee.",
            ],
            [
              "Do I need a Binance account?",
              "You can start with your Solana wallet. Binance balances and exchange tools require your own Binance account and an API key, added in account settings.",
            ],
            [
              "Where do P2P trades happen?",
              "Browse offers here, then complete the P2P deal on Binance. SolCRM also lets you save deals in a local order archive. Dealer offers open with the selected provider.",
            ],
            [
              "Which wallets can I use?",
              "Phantom and other compatible Wallet Standard Solana wallets appear in the wallet selector. On mobile, open SolCRM in your wallet’s in-app browser if your wallet is not detected.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span>+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="closing-cta">
        <div className="closing-glow" aria-hidden="true" />
        <BrandMark className="closing-mark" />
        <h2>Your next move starts here.</h2>
        <p>A clearer workspace for the way you use Solana.</p>
        <Link href="/app" className="button">
          Open SolCRM <Arrow />
        </Link>
      </section>
    </main>
  );
}
function WorkspacePreview() {
  return (
    <div className="preview-wrap">
      <div className="preview-caption">
        <span>
          <i /> A LOOK INSIDE
        </span>
        <span>Illustrative preview · not live balances</span>
      </div>
      <div className="workspace-preview">
        <aside>
          <div className="preview-brand">
            <BrandMark /> solcrm.
          </div>
          <div className="preview-menu">
            <span className="selected">▦ &nbsp; Overview</span>
            <span>⇄ &nbsp; Exchange</span>
            <span>♧ &nbsp; P2P trading</span>
            <span>↗ &nbsp; Compare offers</span>
          </div>
          <div className="preview-wallet">
            <i /> Wallet connected
          </div>
        </aside>
        <div className="preview-main">
          <div className="preview-heading">
            <div>
              <span>YOUR WORKSPACE</span>
              <h3>A clearer view of your assets.</h3>
            </div>
            <span className="preview-avatar">S</span>
          </div>
          <div className="preview-cards">
            <div className="balance-preview">
              <span>Total portfolio</span>
              <strong>
                $8,240<span>.50</span>
              </strong>
              <small>Solana wallet + Binance</small>
              <svg
                viewBox="0 0 400 80"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M0 68 25 60 50 64 75 42 100 50 125 35 150 42 175 20 200 30 225 14 250 28 275 15 300 22 325 8 350 16 375 5 400 10"
                  fill="none"
                  stroke="#c4a7ff"
                  strokeWidth="3"
                />
              </svg>
            </div>
            <div className="assets-preview">
              <span>Your assets</span>
              <div>
                <b className="coin sol">◎</b>
                <p>
                  Solana<small>SOL</small>
                </p>
                <strong>
                  24.80<small>In your wallet</small>
                </strong>
              </div>
              <div>
                <b className="coin usdt">₮</b>
                <p>
                  Tether<small>USDT</small>
                </p>
                <strong>
                  4,200.00<small>On Binance</small>
                </strong>
              </div>
            </div>
          </div>
          <div className="preview-bottom">
            <div>
              <span className="preview-transfer-icon">⇄</span>
              <p>
                Make your next move
                <small>Exchange, transfer, or compare offers.</small>
              </p>
            </div>
            <Link href="/app" aria-label="Try the SolCRM workspace">
              Open app <Arrow />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
