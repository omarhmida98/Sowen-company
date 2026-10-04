#!/usr/bin/env bash
# Backup of a SOWEN production installation: the PostgreSQL database and the uploaded documents.
# See docs/BACKUP_RESTORE.md. Run from the deploy/ folder, as a user allowed to use Docker:
#
#   ./backup.sh
#
# Settings are read from deploy/backup.env (not in Git):
#   BACKUP_REMOTE     where the backup is sent. REQUIRED. Either an rclone remote ("ovh:sowen-backups/prod") or an
#                     SSH destination ("backup@other-host:/srv/backups/sowen").
#   BACKUP_METHOD     "rclone" or "rsync". Default: rclone when BACKUP_REMOTE has no "@", otherwise rsync.
#   BACKUP_PASSPHRASE_FILE  file holding a passphrase: the archives are then encrypted (gpg, AES-256) before they
#                     leave the server. Strongly recommended. Keep the passphrase somewhere else than this server.
#   BACKUP_KEEP_DAYS  how long local copies are kept in deploy/backups (default 7).
#
# A backup that stays on the disk of the server is not a backup: without BACKUP_REMOTE this script fails.
set -euo pipefail
umask 077
cd "$(dirname "$0")"

[ -f backup.env ] && . ./backup.env
[ -f .env ] && set -a && . ./.env && set +a

: "${BACKUP_REMOTE:?BACKUP_REMOTE is not set (deploy/backup.env): the backup must leave this server}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
METHOD="${BACKUP_METHOD:-}"
if [ -z "$METHOD" ]; then case "$BACKUP_REMOTE" in *@*) METHOD=rsync ;; *) METHOD=rclone ;; esac; fi
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="backups/$STAMP"
mkdir -p "$DIR"

echo "[1/4] database"
# Custom format: compressed, restorable with pg_restore, consistent (single transaction snapshot).
$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER:-sowen}" -d "${POSTGRES_DB:-sowen}" -Fc > "$DIR/database.dump"
[ -s "$DIR/database.dump" ] || { echo "The database dump is empty" >&2; exit 1; }

echo "[2/4] documents"
# With STORAGE_PROVIDER="s3" the documents are in the bucket (back it up there); the archive is then nearly empty.
$COMPOSE exec -T api tar -czf - -C /app/back/uploads . > "$DIR/uploads.tar.gz"

if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "      encrypting"
  for f in database.dump uploads.tar.gz; do
    gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$BACKUP_PASSPHRASE_FILE" -o "$DIR/$f.gpg" "$DIR/$f"
    rm -f "$DIR/$f"
  done
fi
( cd "$DIR" && sha256sum * > SHA256SUMS )

echo "[3/4] copy to $METHOD remote"
case "$METHOD" in
  rclone) rclone copy "$DIR" "$BACKUP_REMOTE/$STAMP" ;;
  rsync)  rsync -a -e ssh "$DIR/" "$BACKUP_REMOTE/$STAMP/" ;;
  *) echo "Unknown BACKUP_METHOD: $METHOD" >&2; exit 1 ;;
esac

echo "[4/4] local copies older than $KEEP_DAYS day(s) removed"
find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +

echo "Backup $STAMP done: $(du -sh "$DIR" | cut -f1), sent to $BACKUP_REMOTE/$STAMP"
