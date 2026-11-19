# Use your own domain and CA

[Install on a server](./install-server) used an IP address and mkcert for HTTPS.
If your organization has DNS or a certificate authority (CA), you can do the following. Either one alone is fine.

| | What you get |
|---|---|
| [Open it with an internal domain name](#open-it-with-an-internal-domain-name) | Open it with a name like `https://wiki.corp.example.com`. If the server's IP address changes, you only fix DNS |
| [Use a certificate from your internal CA](#use-a-certificate-from-your-internal-ca) | If your PCs already trust that CA, you do not need to distribute `rootCA.pem` |

Below, **replace `wiki.corp.example.com` with your own internal domain name**.

## Open it with an internal domain name

### 1. Register it in DNS

Ask your network administrator to make `wiki.corp.example.com` point to the server's IP address (for example `192.168.1.50`).

Check from a PC:

```bash
nslookup wiki.corp.example.com
```

If it shows the server's IP address, it is registered.

::: tip Do not use `.local`
Names ending in `.local`, such as `wiki.local`, are resolved by a different mechanism (mDNS) and may not resolve on some PCs.
:::

### 2. Create a certificate with the name

With mkcert, recreate it with the name added.

```bash
cd ~/ofuro-wiki
mkcert -cert-file certs/cert.pem -key-file certs/key.pem wiki.corp.example.com 192.168.1.50 localhost
```

To use your internal CA, get a certificate for this name as described [below](#use-a-certificate-from-your-internal-ca).

### 3. Update `.env` and restart

Change `BASE_URL` and `ALLOWED_ORIGINS` in `.env` to the name.

```ini
BASE_URL=https://wiki.corp.example.com
ALLOWED_ORIGINS=https://wiki.corp.example.com
```

```bash
docker compose up -d --no-build
docker compose restart caddy
```

Open `https://wiki.corp.example.com` from a PC. You are done if no warning appears.

- Tell everyone the new URL. Ask them to recreate bookmarks that use the old URL (the IP address)
- If you use SSO, also fix the redirect URI on the IdP side ([Integrations](./integration#_1-note-the-redirect-uri))
- People who use the AI CLI run `login` again with the new URL

## Use a certificate from your internal CA

This is for organizations with an internal CA, such as Active Directory Certificate Services. If your PCs already trust that CA, you no longer need to distribute mkcert's `rootCA.pem`.

### 1. Have a certificate issued

Ask your CA administrator for a server certificate with these properties.

| Item | Details |
|---|---|
| Subject alternative names (SAN) | The name you open it with (`wiki.corp.example.com`). If you also open it by IP address, the IP address too |
| Format | PEM, with the certificate and private key in separate files |
| Private key | Without a passphrase (Caddy reads it at startup) |

If only `.pfx` is available, ask your CA administrator about converting it to PEM.

### 2. Replace the certificate

Replace the two files in `~/ofuro-wiki/certs`.

| File | Contents |
|---|---|
| `cert.pem` | The server certificate, followed by any intermediate certificates |
| `key.pem` | The private key |

```bash
chmod 600 ~/ofuro-wiki/certs/key.pem
docker compose restart caddy
```

Open it from a PC. You are done if no warning appears. You may remove mkcert's `rootCA.pem` from PCs where you had distributed it.

### 3. Renew it before it expires

Certificates from an internal CA expire (often after 1–2 years). Before then, have it reissued, replace it as in step 2, and run `docker compose restart caddy`.

::: warning The AI CLI does not look at your internal CA either
Node.js does not look at the CAs your PC trusts. Even with an internal CA, set `NODE_EXTRA_CA_CERTS` to the location of that CA's certificate (PEM) ([Integrations](./integration#ai-agents)).
:::
