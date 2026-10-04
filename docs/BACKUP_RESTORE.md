# Backup and restore

With `STORAGE_PROVIDER="local"` everything SOWEN holds is on the disk of the server:

| What | Where | Lost if not backed up |
|---|---|---|
| Database | Docker volume `sowen_sowen_postgres_data` | projects, observations, rules, accounts, history |
| Documents | Docker volume `sowen_sowen_uploads` (`/app/back/uploads` in the API container) | reports, evidence, plans |
| Settings | `deploy/.env`, `deploy/api/.env` | secrets; without `PORTAL_TOKEN_SECRET` every portal link sent stops working |

A copy that stays on the same server protects against nothing: a disk failure, a deleted volume or a compromised
server takes the copy with it. **The backup must be sent to another location**: an object storage bucket (OVH
Object Storage, …) or another machine. With `STORAGE_PROVIDER="s3"` the documents are in the bucket: enable
versioning there; the database still needs the backup below.

## 1. Set up

On the server, in `deploy/`:

```
cat > backup.env <<'EOF'
# rclone remote (bucket) ...
BACKUP_REMOTE="ovh:sowen-backups/prod"
# ... or another machine over SSH:
# BACKUP_REMOTE="backup@other-host:/srv/backups/sowen"
BACKUP_PASSPHRASE_FILE="/root/.sowen-backup-passphrase"
BACKUP_KEEP_DAYS="7"
EOF
chmod 600 backup.env
openssl rand -base64 48 > /root/.sowen-backup-passphrase && chmod 600 /root/.sowen-backup-passphrase
```

- `rclone config` creates the remote (use credentials that can only write to that bucket).
- The passphrase encrypts the archives before they leave the server. **Store a copy of it somewhere else** (a
  password manager): without it the backups cannot be read.
- Keep a copy of `deploy/.env` and `deploy/api/.env` in the same safe place. They are not included in the
  archives on purpose.

## 2. Run

```
cd deploy
./backup.sh
```

It dumps the database (`pg_dump`, custom format), archives the documents, encrypts both when a passphrase is set,
writes checksums, sends everything to `BACKUP_REMOTE/<date>` and removes local copies older than
`BACKUP_KEEP_DAYS`. It fails if `BACKUP_REMOTE` is not set.

Every night, as root (`crontab -e`):

```
15 2 * * * cd /opt/sowen/deploy && ./backup.sh >> /var/log/sowen-backup.log 2>&1
```

Set a retention rule on the remote side as well (for example 30 daily copies), and take a backup by hand before
every update and migration.

## 3. Restore

On a server where the stack is installed and configured (`deploy/.env`, `deploy/api/.env` with the **same**
`PORTAL_TOKEN_SECRET`):

```
cd deploy
C="docker compose -f docker-compose.prod.yml --env-file .env"

# 1. fetch one backup and check it
rclone copy ovh:sowen-backups/prod/<date> restore/
( cd restore && sha256sum -c SHA256SUMS )
# if encrypted:
gpg --batch --passphrase-file /root/.sowen-backup-passphrase -o restore/database.dump -d restore/database.dump.gpg
gpg --batch --passphrase-file /root/.sowen-backup-passphrase -o restore/uploads.tar.gz -d restore/uploads.tar.gz.gpg

# 2. stop the application, keep the database running
$C stop api web
$C up -d postgres

# 3. database: replaces the content of the database with the backup
$C exec -T postgres pg_restore -U sowen -d sowen --clean --if-exists --no-owner < restore/database.dump

# 4. documents
$C run --rm -T api tar -xzf - -C /app/back/uploads < restore/uploads.tar.gz

# 5. apply migrations newer than the backup, then start
$C run --rm api node ../node_modules/prisma/build/index.js migrate deploy
$C up -d
```

Step 3 overwrites the current database: on a server in use, take a backup first.

## 4. Restore test

A backup that was never restored is an assumption. Do this once before going live and then every few months, on
another machine or a temporary stack:

- [ ] the latest backup is present on the remote and its date is today or yesterday
- [ ] `sha256sum -c SHA256SUMS` succeeds
- [ ] the archives decrypt with the passphrase kept outside the server
- [ ] `pg_restore` finishes without error
- [ ] you can sign in, and the number of projects and observations matches
- [ ] a report PDF and a piece of evidence open (documents restored)
- [ ] a portal link sent before the backup still opens (same `PORTAL_TOKEN_SECRET`)
- [ ] the log of the nightly job has no error
