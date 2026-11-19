# Initial setup

After installation, and before others start using it, root (the first administrator) does these three things.

1. Sign in as root
2. Disable new registration (if needed)
3. Create a shared workspace for your wiki

If needed, also set up link previews (step 4).

## 1. Sign in as root

Sign in first with the email address you put in `ROOT_EMAIL` in `.env`.
Choose a password and press **Sign in**; a **Create account** screen appears, so create the account. With the password you chose, you become **root** (the first system administrator).

To check that you are a system administrator, open **Settings** on the left. If you see an **Administration** section (User Management, Workspaces, Server Settings, Audit log, Backup, Restore), you are one.

| Role | Who | What they can do |
|---|---|---|
| **root** | The `ROOT_EMAIL` user in `.env` (one person) | Everything a system administrator can do. Cannot be deleted or demoted by anyone. Owner of every shared workspace |
| **System admin** | root and anyone made an administrator | Manage users, create and delete shared workspaces, server settings, audit log, backups |
| Regular user | Everyone else | Use the workspaces they are invited to |

::: tip Keep separate accounts for administration and daily use
root and system administrators can open every shared workspace. We recommend doing your everyday reading and writing with a separate regular account.
Add more system administrators in **Settings** → **User Management** ([Users and access](./users-and-access#_7-add-system-administrators)).
:::

## 2. Disable new registration

By default, new registration is enabled, and anyone who can open the wiki's URL can create their own account (a confirmation screen appears first).
If you want system administrators to decide who can use it, disable it.

Turn off **Settings** → **Server Settings** → **Allow New Registration**.

![Server settings](/images/en/setup/server-settings.png)

After that, signing in with an unregistered address shows "Invalid password" and no account is created.
Accounts are created by a system administrator, or by people themselves from a workspace invitation email or link ([Users and access](./users-and-access)).

::: info Accounts that can still be created
The `ROOT_EMAIL` address, and people who received an invitation email or link, can create accounts even when new registration is disabled.
:::

## 3. Create a shared workspace for your wiki

### Two kinds of workspace

| Kind | Created by | Used by | For |
|---|---|---|---|
| **Shared** | A system administrator | Invited people | **Your organization's wiki**, department wikis. Owned by root |
| **Private** | Automatically (one per person on first sign-in) | Only that person | Drafts and personal notes. No one else can be invited, and system administrators cannot open it |

The workspace created when root first signs in is root's **private** workspace. Do not use it for the wiki; create a shared workspace instead.

### Create it

1. Press **Settings** → **Administration** → **Workspaces** → **Create**.
2. Enter a name (for example `Company Wiki`) and create it.
3. Press **Open** in the list to move to that workspace.

To split by department, create more shared workspaces the same way. People who are not invited cannot see a workspace at all.

### Rename it

Rename the open workspace in **Settings** → **Workspace** → **Preference** → **Workspace name**.
The change is shown to everyone who was invited.

![Workspace name](/images/en/setup/workspace-name.png)

### Sample pages

A new workspace contains sample pages such as "Getting started". Read them, then feel free to delete them.

## 4. Use link previews (optional)

This setting improves how pasted URLs look. It is off by default.

| | Off (default) | On |
|---|---|---|
| When you paste a URL | Shown as plain link text | Can be shown as a card with the page title and thumbnail |
| Connections from the server to the outside | **None** | **Yes** (to the site of the pasted URL) |

When on, the ofuro-wiki server connects to the site of a pasted URL to fetch its title and thumbnail.
No wiki content is sent, but the site learns **which URL was pasted**.
On a server without internet access, nothing can be fetched even when it is on.

Turn on **Settings** → **Server Settings** → **Link Previews & Rich Embeds**.

::: warning Embeds such as YouTube work regardless of this setting
Pages with YouTube, Figma, and similar embeds from the `/` menu show the video and so on even when this is off.
In that case **the browser of the person viewing the page** connects to YouTube (including its ad servers) and the like.
If you do not want connections outside your organization, agree not to use embeds.
:::

## Next steps

- Create accounts and invite people to the shared workspace ([Users and access](./users-and-access))
- Point users to the [User guide](/en/user/). It can also be opened from **User guide** on the left side of the ofuro-wiki screen
- Set up backups ([Operation](./operation))
