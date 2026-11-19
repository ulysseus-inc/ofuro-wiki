# Quick start

Run ofuro-wiki on your own PC and try it in a browser. It takes about 10 minutes.

::: tip This chapter is for trying it out
It assumes you use it only from your own PC. To use it from other PCs in your organization, go to [Install on a server](./install-server).
:::

## What you need

- A PC that runs **Docker**
  - On Windows and Mac, install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- About 2 GB of free memory
- An internet connection (to download the images)

## 1. Create a folder and the settings files

Open a terminal and run the following. On Windows, use PowerShell.

Create a folder and download the compose file (`docker-compose.yml`).

::: code-group

```powershell [Windows (PowerShell)]
mkdir ofuro-wiki; cd ofuro-wiki
curl.exe -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

```bash [Mac / Linux]
mkdir ofuro-wiki && cd ofuro-wiki
curl -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

:::

Next, create the settings file (`.env`). Secrets such as passwords are generated randomly on the spot.

Replace `admin@example.com` with **your own email address** before running it. The person who signs in with this address becomes **root** (the first system administrator).

::: code-group

```powershell [Windows (PowerShell)]
function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
@"
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(New-Secret)
POSTGRES_PASSWORD=$(New-Secret)
BASE_URL=http://localhost:3010
ROOT_EMAIL=admin@example.com
"@ | Set-Content -Encoding ascii .env
```

```bash [Mac / Linux]
cat > .env <<EOF
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
BASE_URL=http://localhost:3010
ROOT_EMAIL=admin@example.com
EOF
```

:::

| Item | Meaning |
|---|---|
| `APP_IMAGE`, `POSTGRES_IMAGE` | The images to use. `latest` means the newest version. To pin a version, write it like `ofuro-wiki:0.3.0`; then it never changes on its own ([Pinning the version](#pinning-the-version)) |
| `JWT_SECRET` | Secret that protects sign-in sessions |
| `POSTGRES_PASSWORD` | Database password |
| `BASE_URL` | The URL you open in the browser |
| `ROOT_EMAIL` | Email address of root (the first system administrator). You can add more system administrators in the admin panel |

Open the generated `.env` and you will see letters and digits after `JWT_SECRET=`.
You may replace them with your own value by editing `.env` directly. Use 32 or more letters and digits.

::: warning
`.env` contains secrets. Do not give it to others or put it anywhere public.
:::

## 2. Start

```bash
docker compose pull
docker compose up -d --no-build
```

The first time, downloading the images takes a few minutes. Starting up then takes one to a few minutes.

Check that it has started. When the `app` line shows `(healthy)`, it is running.

```bash
docker compose ps
```

## 3. Open it in a browser

Open **[http://localhost:3010](http://localhost:3010)**.

1. Enter the email address you put in `ROOT_EMAIL` in `.env` and press **Continue**
2. Choose a password (8 characters or more) and press **Sign in**
3. A **Create account** screen appears. Press **Create account**

![The Create account screen](/images/en/quickstart/signin.png)

When you sign in with an address that has no account, this confirmation appears before the account is created. If you mistyped the address, go back with **Back to sign in**.

After signing in, your workspace is created with some sample pages.

![The first workspace](/images/en/quickstart/workspace.png)

Create a page with **New doc** and type `/` to see the blocks you can insert.

## Stop or remove

Stop (data is kept; `docker compose up -d --no-build` starts it again):

```bash
docker compose down
```

When you are done trying it, **remove everything including the data**:

```bash
docker compose down -v
```

## More settings

### Pinning the version

With `latest`, every `docker compose pull` switches to the newest version at that time.
To keep the version from changing on its own, replace `latest` with a version number.

```ini
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:0.3.0
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:0.3.0
```

Find versions in the [list of releases](https://github.com/ulysseus-inc/ofuro-wiki/releases) (write `0.3.0` for `v0.3.0`, without the `v`).
Use the same version for both.
