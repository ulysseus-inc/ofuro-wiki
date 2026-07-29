# ofuro-wiki

<p align="center">
  <img src="images/ofuro-wiki_800x800.png" width="120" alt="ofuro-wiki logo" />
</p>

<p align="center">
  <b>A self-hosted, privacy-first Notion alternative.</b><br>
  <b>Zero external data transmission by design — MIT licensed.</b><br>
  A secure wiki platform where ideas flow naturally, named after the Japanese bath
  (<i>ofuro</i>) — a place where ideas come to you.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://github.com/ulysseus-inc/ofuro-wiki/releases"><img alt="Release" src="https://img.shields.io/github/v/release/ulysseus-inc/ofuro-wiki"></a>
  <a href="https://github.com/ulysseus-inc/ofuro-wiki/pkgs/container/ofuro-wiki"><img alt="Docker: GHCR" src="https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white"></a>
</p>

<p align="center">
  <a href="README.md">日本語</a> | <b>English</b>
</p>

<p align="center">
  <img src="images/screenshot-editor.png" width="49%" alt="The ofuro-wiki editor">
  <img src="images/screenshot-slash-menu.png" width="49%" alt="Inserting blocks with slash commands">
</p>

---

## Live demo

Try it right now — no installation required.

**▶ [https://ofuro-wiki-demo.ulysseus.co.jp](https://ofuro-wiki-demo.ulysseus.co.jp)**

| Sign in | |
|---|---|
| Email | `demo@demo.com` |
| Password | `demodemo` |

> This is a shared demo environment. It resets to its initial state every night at
> 3:00 AM (JST). Please do not enter confidential information.

---

## Features

- **Notion-like block editor** — `/` commands and drag & drop, powered by BlockSuite
- **Real-time collaboration** — simultaneous editing via Yjs + Socket.IO
- **Full-text search** — fast, Japanese-aware search powered by PGroonga
- **Single sign-on (SSO)** — OIDC support: sign in with Google, Keycloak, and other providers ([setup guide](docs/sso-setup.md))
- **Fully self-hosted** — start with a single Docker command, no external service dependencies
- **Privacy-first** — telemetry and outbound data transmission are disabled by design

## Tech stack

| Area | Technology |
|------|------------|
| Frontend | AFFiNE (MIT) + BlockSuite (MPL-2.0) |
| Backend | NestJS + GraphQL + Socket.IO (※ built in-house) |
| Database | PostgreSQL + PGroonga (full-text search) |
| Auth | JWT |
| Infra | Docker / Docker Compose |

> ※ AFFiNE's backend is commercially licensed (EE), so it is not used. ofuro-wiki
> implements its own backend, which is what makes it possible to offer the whole
> project under the MIT License.

## Quick start

All you need is **Docker**. Prebuilt public images are used, so there is no
need to clone the repository or build anything (**proven on a free-tier GCE
e2-micro with 1GB RAM + 2GB swap**).

### 1. Fetch the files

```bash
mkdir ofuro-wiki && cd ofuro-wiki
curl -O https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
curl --create-dirs -o backend/.env.example https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/backend/.env.example
```

### 2. Configure environment variables

```bash
cp backend/.env.example .env
```

Open `.env` and set at least the following:

```bash
JWT_SECRET=<generate with: openssl rand -base64 48>
POSTGRES_PASSWORD=<generate with: openssl rand -base64 24>
BASE_URL=https://wiki.example.com
ADMIN_EMAIL=admin@example.com
```

Then append the prebuilt image references:

```bash
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
```

### 3. Start

```bash
docker compose pull app postgres
docker compose up -d --no-build
```

> The database schema is set up automatically on first start (no manual
> migration needed).

> **Want to build from source?** Clone the repository and run
> `docker compose build` (4GB+ RAM recommended). See the
> [deploy guide](docs/deploy/README.md) for details.

### 4. Verify

```bash
curl http://localhost:3010/api/health
```

Open `BASE_URL` in your browser (locally, `http://localhost:3010`) and sign up with
the `ADMIN_EMAIL` address to finish setup.

## Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Server settings and management of all users |
| **Owner** | User management within a workspace, member invitations, settings |
| **Member** | Read/write documents |
| **Reader** | Read-only |

Admin is granted to the address specified by the `ADMIN_EMAIL` environment variable
when it signs up for the first time.

## Deployment

For production deployment details (Nginx / Caddy configuration, swap setup,
backups, etc.), see [docs/deploy/README.md](docs/deploy/README.md).

### Clipboard behavior: HTTP vs HTTPS

Due to browser security policies, the `navigator.clipboard` API is available **only
over HTTPS (or on localhost)**. ofuro-wiki supports clipboard use over HTTP as well,
but the behavior differs:

| Operation | HTTPS / localhost | HTTP (IP address, etc.) |
|-----------|:-----------------:|:-----------------------:|
| Copy & paste within the editor | ✅ Full | ✅ Works |
| Paste into other apps (text editors, etc.) | ✅ Full | ✅ Works as plain text |
| Paste from other apps into the editor | ✅ Full | ✅ Works |
| Copy & paste across tabs/windows | ✅ Full | ❌ Not supported |

> **HTTPS is strongly recommended for production / organizational use.**
> If you must run over HTTP only, see [Pattern C](docs/deploy/pattern-C.md).

## Security & privacy

ofuro-wiki **does not send any data to external services**. Telemetry and tracking
are eliminated by design so that confidential information can be managed safely.

| Measure | Details |
|---------|---------|
| **Telemetry fully removed** | All telemetry code from upstream AFFiNE (Mixpanel, Sentry, etc.) is replaced with no-op stubs. Tracking functions do nothing when called |
| **No external endpoints** | No telemetry URLs, API keys, or DSNs are stored |
| **Sentry disabled** | Error reporting to external services is fully disabled; `sentry.init()` is never called |
| **No localStorage pollution** | No telemetry client/session IDs are stored in the browser |
| **Air-gap ready** | Runs in fully offline, closed networks |

> Upstream AFFiNE's frontend has tracking calls in 100+ files, but all of them are
> replaced with no-ops; no events are emitted on any code path. App-initiated external
> loads — the code-preview external sandbox (affine.run) and external web fonts
> (cdn.affine.pro / Google Fonts) — have also been removed.

> **Note (user-initiated external loads):** "Zero outbound transmission" refers to
> eliminating telemetry / phone-home that occurs without the user's intent. If a user
> embeds external content in a document (e.g. a YouTube video or an external image URL),
> that content is loaded from its origin when displayed. For strictly closed-network
> operation, additionally restrict outbound destinations with a reverse proxy or CSP
> (`connect-src` / `frame-src`, etc.).

## Development

For local development setup (dependency installation, database, migrations, dev servers,
and E2E tests), see [docs/development.md](docs/development.md).

## Contributing

**Bug reports and feature requests are welcome via [Issues](../../issues).**
However, to keep things stable in the early stage, **external Pull Requests are not
being accepted at this time** (code changes are made by the maintainers only; this
policy may change in the future).

- Details & policy: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Reporting security vulnerabilities (**do not open a public issue**): [SECURITY.md](SECURITY.md)

## License

ofuro-wiki: **MIT License** — see [LICENSE](LICENSE).

This project is derived from [AFFiNE](https://github.com/toeverything/AFFiNE) (frontend:
MIT). Files originating from the [BlockSuite](https://github.com/toeverything/blocksuite)
editor are licensed under **MPL-2.0** (per file). It also includes components such as
libvips (LGPL-3.0).

- Third-party dependency license audit: [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)
- Component attributions: [NOTICE](NOTICE)
