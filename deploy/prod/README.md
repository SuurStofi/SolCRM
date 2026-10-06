# Production deployment

SolCRM runs on the host at `169.58.10.252` as the `nekudev` user, behind the
nginx that already fronts the other sites on that box.

| | |
|---|---|
| App | `~/solcrm`, Next.js production build |
| Port | `127.0.0.1:8137` — loopback only, never bound to the public IP |
| Process manager | pm2 (user-local, `~/.npm-global`), app name `solcrm` |
| Public URL | https://solcrm.tech (nginx reverse proxy, Let's Encrypt) |
| Database | `prisma/prod.db` (SQLite) |

## Why the app binds to loopback

It holds the key that encrypts stored Binance credentials and the sessions that
can move money, so it is never reachable except through nginx. `next start`
ignores `HOSTNAME`, so the bind address is passed explicitly:

```bash
PORT=8137 pm2 start npm --name solcrm -- run start -- -H 127.0.0.1 -p 8137
```

Dropping `-H 127.0.0.1` makes Next listen on `*:8137`, which on this host means
the open internet. Verify after any restart:

```bash
ss -tlnH | grep 8137      # must print 127.0.0.1:8137, not *:8137
```

## Secrets

The server holds exactly two, both in `~/solcrm/.env.local` (mode 600):

- `APP_ENCRYPTION_KEY` — generated on the server, never transmitted. Losing or
  changing it makes every stored Binance credential undecryptable.
- `BESTCHANGE_API_KEY` — read-only market data for the Dealer and Compare tabs.

There are deliberately **no Binance API keys on the server**. They are per-user,
entered through the UI and stored encrypted in the database.

Back up `.env.local` together with `prisma/prod.db`: the database is unreadable
without the key.

## Deploying an update

Built from a `git archive` of the committed tree, so no local `.env.local`,
`node_modules` or `.next` cache can travel with it — the local build cache does
contain secrets, which is exactly why it is never copied.

```bash
# from the repo on the workstation
git archive --format=tar.gz -o /tmp/solcrm.tar.gz HEAD
scp -i private/id_ed25519 /tmp/solcrm.tar.gz nekudev@169.58.10.252:/tmp/

# on the server
cd ~/solcrm
tar xzf /tmp/solcrm.tar.gz          # .env.local and prisma/prod.db are not in the archive
npm ci
export DATABASE_URL='file:./prisma/prod.db'
npx prisma generate && npx prisma migrate deploy
npm run build
pm2 restart solcrm
```

`prisma migrate deploy` does not read `.env.local` (Prisma loads `.env`), so
`DATABASE_URL` must be exported or migrations silently land in `prisma/dev.db`
while the app uses `prod.db`.

## Reboot persistence

`pm2 startup systemd` generates a unit with `Type=forking` and a `PIDFile` of
`~/.pm2/pm2.pid`. pm2 7 never writes that file, so systemd reports a failure
even though the resurrect succeeded, and the restart limit then trips.

The unit is patched to match what `pm2 resurrect` actually is — a one-shot
command against an already-running daemon:

```ini
Type=oneshot
RemainAfterExit=yes
# PIDFile removed
```

Re-running `pm2 startup` regenerates the broken version, so re-apply this if
that ever happens. Verify with a real test rather than trusting the config:

```bash
pm2 kill
sudo systemctl start pm2-nekudev
systemctl is-active pm2-nekudev    # active
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8137/   # 200
```

## nginx

`nginx-host/solcrm.tech.conf`, installed by `install-nginx-site.sh`. Unlike the
neighbouring vhosts it has no `$is_cloudflare` gate — this origin is reachable
directly, by choice — so the client address comes from `$remote_addr` rather
than `CF-Connecting-IP`.

certbot manages the certificate and renews it on a timer. The vhost already
redirects HTTP to HTTPS, so pass `--no-redirect` to certbot and let it only
handle the certificate.
