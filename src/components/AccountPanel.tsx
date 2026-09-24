'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { explorerAddressUrl, shortenAddress } from '@/lib/solana/read';
import { useAuth } from './AuthProvider';
import { Panel, SectionLabel, Row, ErrorNote, Spinner, Chip, ExtLink, CopyButton } from './ui';

/**
 * Account settings: linked wallets and the user's own Binance API key.
 */
export function AccountPanel() {
  const { publicKey } = useWallet();
  const {
    account,
    connectedWalletLinked,
    linkConnectedWallet,
    unlinkWallet,
    signOut,
  } = useAuth();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) return null;

  const connected = publicKey?.toBase58() ?? null;

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Account"
      subtitle={`Since ${new Date(account.createdAt).toLocaleDateString()}`}
      icon={<PersonMark />}
      action={
        <button
          type="button"
          onClick={() => void run('signout', signOut)}
          disabled={busy !== null}
          className="inline-flex h-[34px] items-center rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
        >
          Sign out
        </button>
      }
    >
      <div className="space-y-6">
        {error && <ErrorNote>{error}</ErrorNote>}

        {/* Wallets */}
        <div>
          <SectionLabel trailing={<Chip>{account.wallets.length}</Chip>}>Linked wallets</SectionLabel>
          <div>
            {account.wallets.map((wallet) => (
              <Row key={wallet.address}>
                <span className="flex items-center gap-1.5">
                  <ExtLink href={explorerAddressUrl(wallet.address)} mono>
                    {shortenAddress(wallet.address, 6)}
                  </ExtLink>
                  <CopyButton value={wallet.address} />
                  {wallet.address === connected && <Chip tone="accent">connected</Chip>}
                </span>
                {account.wallets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void run(wallet.address, () => unlinkWallet(wallet.address))}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted transition hover:text-bad disabled:opacity-40"
                  >
                    {busy === wallet.address && <Spinner />}
                    <span>Unlink</span>
                  </button>
                )}
              </Row>
            ))}
          </div>

          {connected && !connectedWalletLinked && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2.5">
              <p className="text-xs text-muted">
                Connected wallet{' '}
                <span className="font-mono">{shortenAddress(connected, 4)}</span> is not linked.
              </p>
              <button
                type="button"
                onClick={() => void run('link', linkConnectedWallet)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
              >
                {busy === 'link' && <Spinner className="border-t-accent-fg" />}
                <span>Link this wallet</span>
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Any linked wallet can sign in. To add one, switch to it in your wallet extension and
            press Link — you sign a message to prove it is yours.
          </p>
        </div>

        <AutoWithdrawSection />

        <BinanceKeySection />
      </div>
    </Panel>
  );
}

function BinanceKeySection() {
  const { account, saveBinanceKey, removeBinanceKey } = useAuth();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!account) return null;
  const stored = account.binance;
  const showForm = editing || !stored;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveBinanceKey(apiKey, apiSecret);
      setApiKey('');
      setApiSecret('');
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the key.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeBinanceKey();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionLabel
        trailing={
          stored ? <Chip tone="good">linked</Chip> : <Chip tone="warn">not linked</Chip>
        }
      >
        Binance API key
      </SectionLabel>

      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {stored && !editing && (
        <Row>
          <span className="font-mono text-xs text-muted">••••{stored.apiKeyHint}</span>
          <span className="flex items-center gap-3">
            <Chip tone={stored.canTrade ? 'accent' : 'warn'}>
              {stored.canTrade ? 'convert ready' : 'convert off'}
            </Chip>
            <Chip tone={stored.canWithdraw ? 'warn' : 'good'}>
              {stored.canWithdraw ? 'withdraw on' : 'withdraw off'}
            </Chip>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="text-[11px] font-medium text-muted transition hover:text-foreground disabled:opacity-40"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted transition hover:text-bad disabled:opacity-40"
            >
              {busy && <Spinner />}
              <span>Remove</span>
            </button>
          </span>
        </Row>
      )}

      {showForm && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API key"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-xs outline-none transition focus:border-accent"
          />
          <input
            value={apiSecret}
            onChange={(event) => setApiSecret(event.target.value)}
            placeholder="Secret key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-xs outline-none transition focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !apiKey || !apiSecret}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy && <Spinner className="border-t-accent-fg" />}
              <span>Verify &amp; save</span>
            </button>
            {stored && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="text-xs font-medium text-muted transition hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-faint">
            Create it in Binance → API Management with <b>Enable Reading</b> and, for
            converting, <b>Enable Spot &amp; Margin Trading</b>.{' '}
            {account.autoWithdraw ? (
              <>
                Auto-withdraw is on, so also enable <b>Withdrawals</b> and restrict the key to this
                server&apos;s IP — keys that can withdraw without an IP restriction are refused.
              </>
            ) : (
              <>
                Keys with <b>Withdrawals</b> enabled are refused while auto-withdraw is off.
              </>
            )}{' '}
            The key is checked against Binance, then stored encrypted and never sent back to the
            browser.
          </p>
        </form>
      )}
    </div>
  );
}

/**
 * Where bought SOL ends up. Off: it stays on Binance and the key must not be
 * able to withdraw. On: it is withdrawn to a linked wallet, which needs a
 * withdrawal-enabled, IP-restricted key.
 */
function AutoWithdrawSection() {
  const { account, setAutoWithdraw } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;

  const on = account.autoWithdraw;
  const keyCannotWithdraw = on && account.binance !== null && !account.binance.canWithdraw;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await setAutoWithdraw(!on);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the setting.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionLabel>Bought SOL</SectionLabel>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Auto-withdraw to my wallet</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
            {on
              ? "After a buy, the SOL is withdrawn from Binance to the linked wallet you pick. Needs a Binance key with Withdrawals enabled and restricted to this server's IP."
              : 'Bought SOL stays on your Binance balance; withdraw it there yourself. The stored key is not allowed to withdraw.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Auto-withdraw bought SOL"
          onClick={() => void toggle()}
          disabled={busy}
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${
            on ? 'border-accent bg-accent' : 'border-border-strong bg-surface-subtle'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full shadow transition ${
              on ? 'translate-x-[18px] bg-accent-fg' : 'translate-x-[2px] bg-faint'
            }`}
          />
        </button>
      </div>
      {keyCannotWithdraw && (
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn">
          The stored key cannot withdraw. Replace it with a key that has Withdrawals enabled (and an
          IP restriction), or bought SOL will stay on Binance.
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  );
}

function PersonMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
