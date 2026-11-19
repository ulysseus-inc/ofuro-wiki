# Operation

After installation, there are two main ongoing tasks.

- **Backups**: keep copies so you never lose data
- **Upgrading**: when a new version comes out, upgrade ofuro-wiki

Also, renew the certificate about once every two years.

Run commands in `~/ofuro-wiki` on the server (the folder created in [Install on a server](./install-server)).

## 1. Backups

A backup contains **all workspaces, pages, images and attachments, and users**.
A single ZIP file can restore the whole system to that point in time.

### Automatic backups

Turn on **Settings** → **Backup** → automatic backups.

| Item | Choices |
|---|---|
| Schedule | Daily, weekly, monthly |
| Retention (days) | Backups older than this are deleted |

Automatic backups run at **3:00** in the time zone set with `TZ` ([Install on a server](./install-server)).
On a day when the backup fails, old backups are not deleted.

### Back up now

Press **Create Backup**. It is finished when the status changes from in progress to completed.

![Backup](/images/en/operation/backup.png)

**Download** saves the ZIP to your PC.

### Copy it somewhere else too

Backup ZIPs accumulate in `~/ofuro-wiki/backups` on the server.
**If the server's disk fails, you lose the backups too.** Copy them somewhere else as well, such as a NAS.

For example, if a NAS is mounted at `/mnt/nas`, add this line with `sudo crontab -e` to copy every day at 4:00:

```bash
0 4 * * * rsync -a /home/user/ofuro-wiki/backups/ /mnt/nas/ofuro-wiki-backups/
```

- Replace `/home/user` with your home folder
- Files in `backups` belong to the system's root user, so run it from root's crontab

### What backups do not include

These two are not in backups. **Keep copies of them somewhere safe separately.**

| Item | Location | What happens without it |
|---|---|---|
| `.env` | `~/ofuro-wiki/.env` | If recreated, everyone is signed out, and the database password is lost |
| The CA | `~/.local/share/mkcert` | If you recreate the certificate, you must redistribute the CA to every PC |

Both are secrets. Keep them where others cannot see them.

### Export or import a single workspace

Instead of the whole system, you can save **one workspace** as a ZIP (`.ofuro-backup.zip`). Use it to move a workspace to another ofuro-wiki, or to keep a copy of just one department's wiki.

| Action | How | Who can |
|---|---|---|
| Export | Open the workspace, then **Settings** → **Workspace** → **Storage** → **Export** under "Export Workspace" | Shared: system admins and workspace admins / Private: the owner |
| Import | **Settings** → **Administration** → **Workspaces** → **Import**, then choose the ZIP. It is created as a **new shared workspace** | System admins |

- An imported workspace's only member is root (system admins can manage it without an invitation). Invite the people who need it again
- Users and passwords are not included. To restore the whole system, use the backups above

## 2. Restore

Return the whole system to the time of a backup.

1. In **Settings** → **Restore**, choose the backup ZIP
2. Press **Restore**
3. Confirm with **Restore**

![Restore](/images/en/operation/restore.png)

::: danger All current data is replaced
Pages created and changes made after the backup are lost. This cannot be undone.
Users, passwords, and permissions also return to the time of the backup.
:::

- Real-time editing stops during the restore. The screen reloads when it finishes
- Tell your users beforehand. After the restore, ask them to reload their browser
- The list of backups is not restored (existing backups stay as they are)

## 3. Upgrade ofuro-wiki

### Check the current version

**Settings** → **About ofuro-wiki** shows the version.

![Version](/images/en/operation/about.png)

Find new versions in the [list of releases](https://github.com/ulysseus-inc/ofuro-wiki/releases).
**Read the notes for that version before upgrading.** Some versions need extra steps before or after.

### Upgrade

1. **Take a backup.** **Settings** → **Backup** → **Create Backup**. Download the ZIP just in case
2. Tell your users it will be unavailable for a few minutes
3. If you pinned the version, change it in `.env` (not needed with `latest`)

   ```ini
   APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:0.3.0
   POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:0.3.0
   ```

4. Pull the new images and restart

   ```bash
   docker compose pull
   docker compose up -d --no-build
   ```

5. Wait until `docker compose ps` shows `app` as `(healthy)`. It takes a few minutes
6. Open it in a browser and check the new version in **Settings** → **About ofuro-wiki**

The database is updated automatically on startup. There is nothing to do by hand.

### Go back to the previous version

Database updates cannot be undone into the previous version's format. To go back, you need **the backup taken before upgrading**.

1. Change the version in `.env` back to the previous one
2. Restart with `docker compose up -d --no-build`
3. In **Settings** → **Restore**, restore the backup taken before upgrading

After going back, pages and changes made after the upgrade are gone.

::: warning This procedure has not been tested in practice yet
We have not verified that the previous version starts after an upgrade that included database updates. If it does not start, contact the developers.
:::

## 4. Renew the certificate

The server certificate made with mkcert expires **2 years and 3 months after it was made**. After that, browsers show `NET::ERR_CERT_DATE_INVALID`.
The expiry date was shown as "It will expire on …" when you made it. To check later, run:

```bash
openssl x509 -enddate -noout -in certs/cert.pem
```

Before it expires, recreate it with the same command as before and restart Caddy.

```bash
mkcert -cert-file certs/cert.pem -key-file certs/key.pem 192.168.1.50 localhost
docker compose restart caddy
```

The CA (`rootCA.pem`) is valid for 10 years. Recreating the certificate does not require redistributing the CA to your PCs.
