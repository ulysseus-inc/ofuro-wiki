# What is ofuro-wiki

ofuro-wiki is a wiki you deploy on your own server.
Write with a Notion-like block editor and share what your organization knows.
Everything is MIT licensed and free of charge.

## Features

| Feature | Details |
|---|---|
| **Write** | `/` commands, drag & drop, tables, code blocks, columns. Import from Markdown, HTML, and Notion; export to PDF, Markdown, and HTML |
| **Edit together** | Several people can edit the same page at once, and changes appear on everyone's screen right away |
| **Find** | Full-text search with strong Japanese support, backlinks, `@` mentions, tags and folders |
| **Workspaces** | A **private** workspace just for you (drafts, notes) and **shared** workspaces for invited people (company wiki, department wikis). System administrators create shared workspaces |
| **Permissions** | Workspace roles (workspace admin, member, viewer) and read/write permissions on each page |
| **Confidential pages** | A page shared with only some people never appears in anyone else's list or search results. Not even its title leaks (images, attachments, and comments on the page are not restricted) |
| **Nothing sent outside** | ofuro-wiki never sends data outside on its own (no telemetry, no usage statistics). It connects outside only when a user embeds something like YouTube, or when an administrator turns on link previews |
| **Audit log** | Records sign-ins, page creation and changes, permission changes, folder operations, and more. It can also record who opened which page (off by default) |
| **Operation** | Admin panel (users, workspaces, server settings, backup and restore) and automatic daily backups |
| **Single sign-on** | OIDC. Sign in with Google Workspace, Microsoft Entra ID, Keycloak, and others. Set up entirely in the admin panel |
| **Built-in guide** | This guide and the user guide ship with ofuro-wiki and can be read without an internet connection |
| **Works on phones** | Open it in a phone browser for a phone-friendly screen. No app to install |
| **AI agents** | Search, read, and edit pages from tools such as Claude Code |

## Try it

Try the demo without installing anything.

**[https://ofuro-wiki-demo.ulysseus.co.jp](https://ofuro-wiki-demo.ulysseus.co.jp)**

| Item | Value |
|---|---|
| Email | `demo@demo.com` |
| Password | `demodemo` |

::: warning
This demo is shared by everyone and is reset every night at 3:00 (JST). Do not enter confidential information.
:::

## What you need

- One server that runs **Docker**
  - For use in your organization we recommend Ubuntu Server (physical or virtual) ([Install on a server](./install-server))
  - If you cannot prepare Linux, a Windows 11 PC with 8 GB of memory or more also works ([Appendix](./install-windows))
- A browser on each user's PC or phone

No external services are required.

## How to use this guide

| Goal | Chapters |
|---|---|
| Try it on your own PC first | [Quick start](./quickstart) |
| Start using it as your organization's wiki | [Install on a server](./install-server) → [Initial setup](./initial-setup) → [Users and access](./users-and-access) |
| Keep it running | [Operation](./operation) (backups, upgrading) |
| Something does not work | [Troubleshooting](./troubleshooting) |
| Show users how to use it | [User guide](/en/user/) |
