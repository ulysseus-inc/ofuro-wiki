# Troubleshooting

Common symptoms and how to fix them. Run commands in `~/ofuro-wiki` on the server.

## Where to look first

```bash
docker compose ps                  # is it running?
docker compose logs app --tail 50  # ofuro-wiki's log (last 50 lines)
```

| `app` in `docker compose ps` | State |
|---|---|
| `Up … (healthy)` | Running |
| `Up … (health: starting)` | Still starting. Wait a few minutes |
| `Restarting` | Failing to start and retrying. Check the log ([Does not start](#does-not-start)) |

## Does not start

### The log says `JWT_SECRET must be at least 32 characters long`

`JWT_SECRET` in `.env` is too short. Make it 32 or more letters and digits, then restart with `docker compose up -d --no-build`.

::: warning Do not change `JWT_SECRET` of a running wiki
Changing it signs everyone out, and the SSO secret must be entered again ([Integrations](./integration.md#notes-on-sso)).
:::

### The log says `P1000: Authentication failed against database server`

`POSTGRES_PASSWORD` in `.env` differs from **the value used at the very first start**.
The database password is fixed at the first start; changing `.env` later does not change it.

Put the original value you kept back into `POSTGRES_PASSWORD` in `.env` and restart.

### It does not start, saying `address already in use`

Another program is using a port (80, 443, or 3010). Find out which:

```bash
sudo ss -ltnp | grep -E ':(80|443|3010) '
```

Stop that program, or install ofuro-wiki on another server.

### The browser shows `502`

ofuro-wiki is still starting. Wait until `docker compose ps` shows `app` as `(healthy)`.
If it stays at `502`, `app` failed to start. Check the log above.

## Cannot open it in a browser

### "Your connection is not private"

The code shown on the warning page tells you the cause.

| Code | Cause | Fix |
|---|---|---|
| `NET::ERR_CERT_AUTHORITY_INVALID` | That PC does not trust the CA | Make it trust the CA as in [Open it from other PCs](./install-server.md#_6-open-it-from-other-pcs), then reopen the browser |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | The address you opened is not in the certificate | See "The server's IP address changed" below |
| `NET::ERR_CERT_DATE_INVALID` | The certificate expired | [Renew the certificate](./operation.md#_4-renew-the-certificate) |

Do not click through the warning. You would not notice if your password were being intercepted.

### The server's IP address changed

The certificate and `.env` contain the old address. Recreate them with the new address (for example `192.168.1.60`).

```bash
cd ~/ofuro-wiki
mkcert -cert-file certs/cert.pem -key-file certs/key.pem 192.168.1.60 localhost
```

Change `BASE_URL` and `ALLOWED_ORIGINS` in `.env` to `https://192.168.1.60`, then restart.

```bash
docker compose up -d --no-build
docker compose restart caddy
```

- The CA is the same, so you do not need to redistribute it to your PCs
- If you use SSO, also fix the redirect URI on the IdP side
- Fix the IP address so it does not change again ([Fix the server's IP address](./install-server.md#_1-fix-the-server-s-ip-address))

### Nothing appears and it times out

- Is the server on, and does `docker compose ps` show it running?
- Are you opening the right IP address?
- Are ports 80 and 443 open in the server's firewall (ufw)? (See "If you cannot connect" in [Open it from other PCs](./install-server.md#_6-open-it-from-other-pcs))

## Cannot sign in

### "Invalid password"

One of the following. The screen does not tell you which (to give attackers no clue).

| Cause | Fix |
|---|---|
| Wrong password | A system admin issues a password URL ([Forgotten password](./users-and-access.md#_5-forgotten-password-or-lost-device)) |
| No account (new registration is disabled) | A system admin creates the account or invites the person to a workspace ([Add users](./users-and-access.md#_1-add-users)) |
| Locked after 10 failures in a row | Wait 15 minutes |

### root forgot the password, or every system admin forgot theirs

Other system admins cannot change root's password. Use `ROOT_EMAIL` to make another user root temporarily. One user who knows their password is enough.

1. Change `ROOT_EMAIL` in `.env` to that user's email address
2. Restart with `docker compose up -d --no-build`. That user becomes root (the previous root becomes a system admin)
3. Sign in as that user and reset the previous root's password in **Settings** → **User Management**
4. Change `ROOT_EMAIL` in `.env` back and restart again
5. The user you made root temporarily stays a system admin. If they should not be one, turn off their switch in **Settings** → **User Management**

Ownership of shared workspaces also moves to the current root each time; step 4 moves it back.

### SSO shows `redirect_uri_mismatch`

The redirect URI registered at the IdP differs from the value shown in the admin panel. Match `http` versus `https` and the trailing `/` exactly.
For other symptoms, see [SSO setup (details)](https://github.com/ulysseus-inc/ofuro-wiki/blob/main/docs/sso-setup.md).

## While using it

| Symptom | Cause | Fix |
|---|---|---|
| Pasting from another tab does not work | Opened with `http://` | Open with `https://` ([Install on a server](./install-server.md)) |
| Automatic backups run at the wrong hour | ofuro-wiki's clock is not in your time zone | Add `TZ` (for example `TZ: Asia/Tokyo`) to `docker-compose.override.yml` ([Create the settings files](./install-server.md#_4-create-the-settings-files)) and restart |
| The audit log shows the same source address for everyone | `TRUST_PROXY=1` is missing from `.env` | Add it and restart |
| The URL is right but the AI fails with "cannot connect to the server" | Node.js does not see your CA | Set `NODE_EXTRA_CA_CERTS` ([Integrations](./integration.md#ai-agents)) |
| Slow when many people sign in at once, such as at the start of the day | Password checking is deliberately expensive | See ["slow when many people sign in at once" in the deploy guide](https://github.com/ulysseus-inc/ofuro-wiki/blob/main/docs/deploy/README.md) (in Japanese) |

## If it still does not work

Contact the developers with these three things:

1. The version (**Settings** → **About ofuro-wiki**)
2. The output of `docker compose ps`
3. The output of `docker compose logs app --tail 200`

The log may contain email addresses and the like. Check it before sending.
