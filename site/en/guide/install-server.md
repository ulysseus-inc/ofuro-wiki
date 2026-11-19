# Install on a server

Install ofuro-wiki on one Ubuntu server and make it available to other PCs in your organization through a browser.

```
PCs in your organization (browser, trusting your CA)
   │
   │  https://192.168.1.50 (internal LAN)
   ▼
Ubuntu server
   └ Docker Engine
       ├ Caddy ……… HTTPS front end
       ├ ofuro-wiki
       └ PostgreSQL … data
```

Turn the server on and the wiki starts. Nobody needs to sign in to the server.

## What you need

| Item | Details |
|---|---|
| Server | A PC or virtual machine (64-bit) with **Ubuntu Server 24.04 LTS**. 4 GB of memory or more, 20 GB of free disk or more |
| Network | Connected to your internal LAN |
| Permissions | A user who can use `sudo` |
| Internet | Needed only during installation (to download software and images) |

To install Ubuntu itself, follow the [official Ubuntu Server instructions](https://ubuntu.com/tutorials/install-ubuntu-server).
Run every command below on the server (at its console or over SSH).

## 0. Set the server's time zone

Set the server to your local time zone. The [Operation](./operation.md) chapter uses it as the clock for copying backups at a fixed time.
The examples use Japan time (`Asia/Tokyo`); replace it with yours (`timedatectl list-timezones` lists them).

```bash
sudo timedatectl set-timezone Asia/Tokyo
timedatectl | grep "Time zone"
```

You are done when it shows your time zone, for example `Time zone: Asia/Tokyo (JST, +0900)`.

::: info ofuro-wiki's own clock is set separately
Docker containers do not inherit the server's time zone. ofuro-wiki's clock is set with `TZ` in the settings file in step 4.
:::

## 1. Fix the server's IP address

Other PCs open the wiki at the server's **IP address**. If the address changes, they can no longer connect.

※ This guide assumes the server already has a fixed IP address on your internal LAN. If it does not, fix it as follows.

1. Run `ip -4 addr` on the server and note its LAN IP address (for example `192.168.1.50`)
2. Make sure the address does not change. Ask your network administrator, or set up a "DHCP reservation (static assignment)" on your router

Below, **replace `192.168.1.50` with your own IP address**.

## 2. Install Docker Engine

Follow Docker's official instructions ([Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)).

```bash
# Register Docker's package source
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update

# Install Docker
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Start Docker when the server boots, and allow `docker` without `sudo`.

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Log out and log in again** (over SSH, `exit` and reconnect). Then check:

```bash
docker compose version
```

If it prints something like `Docker Compose version v2.…`, you are ready.

## 3. Create a certificate

Create a certificate for HTTPS connections from your PCs with [mkcert](https://github.com/FiloSottile/mkcert).
mkcert creates a small certificate authority (CA) just for this wiki and signs the certificate with it.

::: details Why HTTPS
Over plain HTTP, passwords cross your LAN unencrypted.
Browsers also disable some features on HTTP pages, so pasting from another tab and similar things do not work.
:::

```bash
sudo apt install -y mkcert
mkdir -p ~/ofuro-wiki/certs && cd ~/ofuro-wiki
mkcert -cert-file certs/cert.pem -key-file certs/key.pem 192.168.1.50 localhost
```

You are done when `cert.pem` and `key.pem` appear in the `certs` folder. The certificate is valid for 2 years and 3 months ([Renew the certificate](./operation.md#_4-renew-the-certificate)).
The first run also creates the CA (`~/.local/share/mkcert`).
You will see "the local CA is not installed in the system trust store"; you can ignore it. It is your PCs, not the server, that need to trust the CA (step 6).

## 4. Create the settings files

Continue in `~/ofuro-wiki`. You need four files.

Download the **compose file** (`docker-compose.yml`).

```bash
curl -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

Create the **settings** (`.env`). **Edit the first two lines** before running it.

```bash
IP=192.168.1.50            # ← the server IP address you noted in step 1
ROOT_EMAIL=admin@example.com  # ← your email address, for root (the first system administrator)
cat > .env <<EOF
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
BASE_URL=https://$IP
ALLOWED_ORIGINS=https://$IP
TRUST_PROXY=1
ROOT_EMAIL=$ROOT_EMAIL
EOF
chmod 600 .env
```

| Item | Meaning |
|---|---|
| `BASE_URL` | The URL your PCs open in the browser |
| `ALLOWED_ORIGINS` | Accepted origins. Same as `BASE_URL` |
| `TRUST_PROXY` | Needed when requests come through Caddy. Without it, the audit log records Caddy as the source of every request |

The other items are the same as in the [Quick start](./quickstart.md#_1-create-a-folder-and-the-settings-files).
`chmod 600` makes `.env` readable only by you.

Create the **HTTPS front end settings** (`Caddyfile`). Run it as is.

```bash
cat > Caddyfile <<'EOF'
:443 {
	tls /certs/cert.pem /certs/key.pem
	reverse_proxy app:3010
}

http:// {
	redir https://{host}{uri} permanent
}
EOF
```

Create the **compose additions** (`docker-compose.override.yml`). Replace `Asia/Tokyo` with your time zone.

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  app:
    environment:
      TZ: Asia/Tokyo
    ports: !override
      - "127.0.0.1:3010:3010"

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./certs:/certs:ro
      - caddydata:/data
    depends_on:
      - app

volumes:
  caddydata:
EOF
```

- Caddy receives HTTPS (443) and passes it to ofuro-wiki. Requests over HTTP (80) are redirected to HTTPS
- ofuro-wiki's port (3010) is opened only inside the server, so PCs cannot reach it unencrypted
- `TZ` sets ofuro-wiki's clock. Without it the clock is UTC, and the daily backup runs at 3:00 UTC instead of 3:00 local time

## 5. Start

```bash
docker compose pull
docker compose up -d --no-build
```

When `docker compose ps` shows `app` as `(healthy)`, it is running. The first start takes a few minutes.

```bash
curl -k https://localhost/api/health
```

If it prints `{"status":"ok",…}`, everything up to the HTTPS front end works.
While starting up it returns `502`; wait a little and try again.

Thanks to `restart: unless-stopped` in the compose file, the wiki starts automatically after the server reboots.

::: warning Before your organization starts using it
By default, new registration is enabled, and anyone who can open the wiki's URL can create their own account.
After root signs in for the first time, disable new registration if needed in [Initial setup](./initial-setup.md#_2-disable-new-registration).
:::

## 6. Open it from other PCs

Make each PC trust the CA you created in step 3. Do this **once per PC**.

### Distribute the CA file

Distribute **only** the server's `~/.local/share/mkcert/rootCA.pem`.
You can fetch it from a PC like this (on Windows, run it in PowerShell; `user` is the user name on the server).

```bash
scp user@192.168.1.50:.local/share/mkcert/rootCA.pem .
```

::: danger Do not distribute rootCA-key.pem
`rootCA-key.pem` in the same folder is the CA's key. With it, anyone can forge a certificate for any site.
Never take it off the server.
:::

### Trust it on the PC (Windows)

1. Rename `rootCA.pem` to `rootCA.crt`
2. Double-click it → **Install Certificate**
3. Choose **Local Machine**
4. Choose **Place all certificates in the following store** → **Trusted Root Certification Authorities**
5. When finished, reopen the browser

On a Mac, run this in Terminal:

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain rootCA.pem
```

### Open it

Open **https://192.168.1.50** in a browser on the PC. You are done if a lock icon appears and there is no warning.

Sign in for the first time with the `ROOT_EMAIL` address in `.env` (same as [Quick start step 3](./quickstart.md#_3-open-it-in-a-browser)).

::: details If you cannot connect
If the firewall (ufw) is enabled on the server, open ports 80 and 443.

```bash
sudo ufw allow 80,443/tcp
```

On a fresh Ubuntu Server, ufw is disabled (`sudo ufw status` shows `inactive`).
:::

## 7. Check that it works

1. Open the same page from two PCs
2. Type on one and check that it appears on the other right away
3. Reboot the server (`sudo reboot`) and wait a few minutes. Without touching anything, check that the PCs can open it again

That completes the installation. Next, go to [Initial setup](./initial-setup.md).
