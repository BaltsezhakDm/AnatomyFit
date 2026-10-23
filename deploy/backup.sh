#!/usr/bin/env bash
# Ежедневная копия базы AnatomyFit (SQLite) и загруженных файлов.
# Копия делается через API better-sqlite3 (.backup) внутри контейнера — это согласованный снимок даже при работающем сервере (WAL).
set -euo pipefail

CONTAINER="${CONTAINER:-anatomyfit_api}"
APP_DIR="${APP_DIR:-/opt/afit}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP="${KEEP:-14}" # сколько последних копий хранить

STAMP="$(date +%Y-%m-%d_%H%M%S)"
TMP_NAME=".backup-$STAMP.sqlite"
mkdir -p "$BACKUP_DIR"

# 1. Снимок + проверка целостности (integrity_check) до того, как копия попадёт в хранилище
docker exec "$CONTAINER" node -e '
const Database = require("better-sqlite3");
const [src, dst] = process.argv.slice(1);
const db = new Database(src, { readonly: true });
db.backup(dst).then(() => {
  const copy = new Database(dst);
  // Копия — самостоятельный файл без -wal/-shm рядом, иначе при переносе потеряются данные из журнала
  copy.pragma("journal_mode = delete");
  const check = copy.pragma("integrity_check", { simple: true });
  const users = copy.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  copy.close();
  if (check !== "ok") { console.error("integrity_check:", check); process.exit(1); }
  console.log("снимок ok, пользователей:", users);
}).catch(err => { console.error(err); process.exit(1); });
' /app/data/anatomyfit.sqlite "/app/data/$TMP_NAME"

# 2. Перенос из каталога данных в хранилище и сжатие
mv "$APP_DIR/server/data/$TMP_NAME" "$BACKUP_DIR/anatomyfit-$STAMP.sqlite"
gzip -f "$BACKUP_DIR/anatomyfit-$STAMP.sqlite"

# 3. Загруженные медиафайлы — только если они есть
if [ -n "$(find "$APP_DIR/server/uploads" -type f -print -quit 2>/dev/null)" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$APP_DIR/server" uploads
fi

# 4. Ротация: оставляем KEEP последних копий каждого вида
for pattern in 'anatomyfit-*.sqlite.gz' 'uploads-*.tar.gz'; do
  { ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null || true; } | tail -n +"$((KEEP + 1))" | xargs -r rm --
done

echo "$(date -Is) готово: $BACKUP_DIR/anatomyfit-$STAMP.sqlite.gz ($(du -h "$BACKUP_DIR/anatomyfit-$STAMP.sqlite.gz" | cut -f1))"
