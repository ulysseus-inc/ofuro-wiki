# Appendix: Install on a Windows PC

Steps to turn one Windows PC into your wiki server when you cannot prepare a Linux server.

::: tip Use Ubuntu if you can
On Windows, keeping Docker Desktop running needs workarounds such as automatic sign-in.
If you can prepare a server, we recommend [Install on a server](./install-server) (Ubuntu).
:::

```
PCs in your organization (browser, trusting your CA)
   │
   │  https://192.168.1.50 (internal LAN)
   ▼
Windows PC for the wiki
   └ Docker Desktop
       ├ Caddy ……… HTTPS front end
       ├ ofuro-wiki
       └ PostgreSQL … data
```

::: danger The wiki does not run unless Docker Desktop is running
Docker Desktop is an app that starts when someone signs in to Windows.
After Windows Update, a power cut, or a restart, **the wiki stays down until someone signs in**.
[7. Prepare for restarts](#_7-prepare-for-restarts) sets up automatic sign-in.
:::

## What you need

| Item | Details |
|---|---|
| PC | Windows 11 (64-bit). 8 GB of memory or more |
| Network | A wired connection to your internal LAN is recommended |
| Administrator rights | Able to install software on that PC |
| Internet | Needed only during installation (to download software and images) |

We recommend dedicating this PC to the wiki. A PC in daily use gets turned off or restarted, and the wiki stops.

## 1. Fix the IP address

Other PCs open the wiki at this PC's **IP address**. If it changes, they can no longer connect.

1. Run `ipconfig` in PowerShell and note the LAN "IPv4 Address" (for example `192.168.1.50`)
   - The `vEthernet (WSL)` entry is used by Docker. Ignore it
2. Make sure the address does not change. Ask your network administrator, or set up a "DHCP reservation (static assignment)" on your router

Below, **replace `192.168.1.50` with your own IP address**.

## 2. Install Docker Desktop

1. Download the Windows installer from [Docker Desktop](https://www.docker.com/products/docker-desktop/) and run it
2. Keep "Use WSL 2 instead of Hyper-V" checked
3. When it finishes, restart Windows
4. Start Docker Desktop and accept the terms. You do not need to sign in with a Docker account (you can skip it)
5. Open a new PowerShell and check that it works:

```powershell
docker compose version
```

If it prints something like `Docker Compose version v2.…`, you are ready.

::: tip
Docker Desktop licensing: [see here](https://docs.docker.com/subscription/desktop-license/)
:::

## 3. Create a certificate

Create a certificate for HTTPS connections from your PCs with [mkcert](https://github.com/FiloSottile/mkcert).
mkcert creates a small certificate authority (CA) just for this wiki and signs the certificate with it.

::: details Why HTTPS
Over plain HTTP, passwords cross your LAN unencrypted.
Browsers also disable some features on HTTP pages, so pasting from another tab and similar things do not work.
:::

Install mkcert in PowerShell.

```powershell
winget install FiloSottile.mkcert
```

Then **open a new PowerShell**, create a folder for the wiki, and create the certificate.

```powershell
mkdir C:\ofuro-wiki; cd C:\ofuro-wiki
mkcert -install
mkdir certs
mkcert -cert-file certs\cert.pem -key-file certs\key.pem 192.168.1.50 localhost
```

- When `mkcert -install` asks whether to install the certificate, choose **Yes**
- You are done when `cert.pem` and `key.pem` appear in the `certs` folder

## 4. Create the settings files

Continue in `C:\ofuro-wiki`. You need four files.

Download the **compose file** (`docker-compose.yml`).

```powershell
curl.exe -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

Create the **settings** (`.env`). **Edit the first two lines** before running it.

```powershell
$ip = '192.168.1.50'                # ← this PC's IP address from step 1
$rootEmail = 'admin@example.com'    # ← your email address, for root (the first system administrator)
function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
@"
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(New-Secret)
POSTGRES_PASSWORD=$(New-Secret)
BASE_URL=https://$ip
ALLOWED_ORIGINS=https://$ip
TRUST_PROXY=1
ROOT_EMAIL=$rootEmail
"@ | Set-Content -Encoding ascii .env
```

| Item | Meaning |
|---|---|
| `BASE_URL` | The URL your PCs open in the browser |
| `ALLOWED_ORIGINS` | Accepted origins. Same as `BASE_URL` |
| `TRUST_PROXY` | Needed when requests come through Caddy. Without it, the audit log records Caddy as the source of every request |

The other items are the same as in the [Quick start](./quickstart#_1-create-a-folder-and-the-settings-files).

Create the **HTTPS front end settings** (`Caddyfile`). Run it as is.

```powershell
@'
:443 {
	tls /certs/cert.pem /certs/key.pem
	reverse_proxy app:3010
}

http:// {
	redir https://{host}{uri} permanent
}
'@ | Set-Content -Encoding ascii Caddyfile
```

Create the **compose additions** (`docker-compose.override.yml`). Replace `Asia/Tokyo` with your time zone.

```powershell
@'
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
'@ | Set-Content -Encoding ascii docker-compose.override.yml
```

- Caddy receives HTTPS (443) and passes it to ofuro-wiki. Requests over HTTP (80) are redirected to HTTPS
- ofuro-wiki's port (3010) is opened only inside this PC, so other PCs cannot reach it unencrypted
- `TZ` sets ofuro-wiki's clock. Without it the clock is UTC, and the daily backup runs at 3:00 UTC instead of 3:00 local time

## 5. Start

```powershell
docker compose pull
docker compose up -d --no-build
```

When `docker compose ps` shows `app` as `(healthy)`, it is running. The first start takes a few minutes.

Open **https://192.168.1.50** in this PC's browser and check that the sign-in screen appears.
While starting up it shows `502`; wait a little and reload.

Sign in for the first time with the `ROOT_EMAIL` address in `.env` (same as [Quick start step 3](./quickstart#_3-open-it-in-a-browser)).

::: warning Before your organization starts using it
By default, new registration is enabled, and anyone who can open the wiki's URL can create their own account.
After root signs in for the first time, disable new registration if needed in [Initial setup](./initial-setup#_2-disable-new-registration).
:::

## 6. Open it from other PCs

Make each PC trust the CA you created in step 3. Do this **once per PC**.

### Distribute the CA file

On the wiki PC, run this to show the CA folder:

```powershell
mkcert -CAROOT
```

Distribute **only `rootCA.pem`** from that folder to your PCs, via a shared folder or a USB stick.

::: danger Do not distribute rootCA-key.pem
`rootCA-key.pem` in the same folder is the CA's key. With it, anyone can forge a certificate for any site.
Never take it off the wiki PC.
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

If you cannot connect, check on the wiki PC:

- If a "Windows Security Alert" appeared, allow access on private networks
- In **Settings** → **Network & internet** → your connection, the **Network profile type** is **Private**

## 7. Prepare for restarts

Make the wiki come back without anyone's help when the wiki PC restarts.

### Start Docker Desktop at sign-in

In Docker Desktop **Settings** → **General**, check **Start Docker Desktop when you sign in to your computer**.

The ofuro-wiki containers start automatically once Docker is up.

### Sign in to Windows automatically

Use Microsoft's [Autologon](https://learn.microsoft.com/en-us/sysinternals/downloads/autologon).

1. Download Autologon and run `Autologon64.exe`
2. Enter the account that signs in to this PC in Username, Domain, and Password
3. Press **Enable**

The password is stored encrypted inside Windows.

::: warning
With automatic sign-in, anyone sitting at the PC can use it.
Keep the PC in a locked room. After it starts, you may lock it with `Windows key + L` (the wiki keeps running while locked).
:::

### Do not let it sleep

In **Settings** → **System** → **Power** → **Screen and sleep**, set sleep when plugged in to **Never**.
The wiki stops while the PC sleeps.

### Schedule update restarts outside working hours

In **Settings** → **Windows Update** → **Advanced options**, set **Active hours** to your working hours.
Update restarts do not happen during those hours.

## 8. Check that it works

1. Open the same page from two PCs
2. Type on one and check that it appears on the other right away
3. Restart the wiki PC and wait a few minutes. Without touching anything, check that the PCs can open it again

That completes the installation. Next, go to [Initial setup](./initial-setup).
