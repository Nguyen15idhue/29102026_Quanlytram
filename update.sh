#!/usr/bin/env bash
# Cập nhật toàn diện trên VPS: pull code, backup DB, build, migrate, restart, health check.
# Chạy trên VPS:  bash update.sh            (mặc định branch main)
#                BRANCH=main bash update.sh
#                BUILD_GUIDE=1 bash update.sh   (build lại trang /guide, cần mạng)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cors/app}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-/opt/cors/backup.sh}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
PUBLIC_URL="${PUBLIC_URL:-https://rtktk.online/}"
BUILD_GUIDE="${BUILD_GUIDE:-0}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%d %H:%M:%S UTC')" "$*"; }
die() { printf '\nLỖI: %s\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR/.git" ] || die "Không thấy repo tại $APP_DIR"
cd "$APP_DIR"

git_run() {
  if [ "$(id -u)" -eq 0 ] && id deploy >/dev/null 2>&1; then
    runuser -u deploy -- git -C "$APP_DIR" "$@"
  else
    git -C "$APP_DIR" "$@"
  fi
}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

command -v docker >/dev/null 2>&1 || die "Không có docker"
[ -f "$COMPOSE_FILE" ] || die "Thiếu $COMPOSE_FILE"
[ -f .env.production ] || die "Thiếu .env.production"
[ -x "$BACKUP_SCRIPT" ] || die "Không thấy backup script: $BACKUP_SCRIPT"

log "Kiểm tra repo ($BRANCH)..."
git_run fetch origin "$BRANCH"
git_run checkout "$BRANCH"
if ! git_run diff --quiet || ! git_run diff --cached --quiet; then
  die "Repo có thay đổi chưa commit. Xử lý hoặc stash trước khi update."
fi

OLD_COMMIT="$(git_run rev-parse --short HEAD)"
git_run pull --ff-only origin "$BRANCH"
NEW_COMMIT="$(git_run rev-parse --short HEAD)"
log "Commit: $OLD_COMMIT -> $NEW_COMMIT"

if [ "$BUILD_GUIDE" = "1" ]; then
  log "Build lại trang hướng dẫn (/guide)..."
  docker run --rm -v "$APP_DIR:/app" -w /app node:22-alpine \
    sh -c "cd docs-site && npm ci --no-audit --no-fund && cd .. && node scripts/build-guide.mjs"
  chown -R deploy:deploy "$APP_DIR/frontend/public/guide" 2>/dev/null || true
fi

log "Backup MySQL trước khi migrate..."
BACKUP_OUT="$(mktemp)"
"$BACKUP_SCRIPT" | tee "$BACKUP_OUT"
grep -q '^BACKUP_OK ' "$BACKUP_OUT" || die "Backup thất bại, dừng cập nhật."
rm -f "$BACKUP_OUT"

log "Build images..."
compose build --pull

log "Chạy migration..."
compose run --rm migrate

log "Khởi động/cập nhật services..."
compose up -d --remove-orphans

log "Chờ services healthy (tối đa ${HEALTH_TIMEOUT}s)..."
DEADLINE=$((SECONDS + HEALTH_TIMEOUT))
while :; do
  BAD=0
  for SERVICE in mysql server gnss web-prod; do
    CID="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
    if [ -z "$CID" ]; then BAD=1; continue; fi
    STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID" 2>/dev/null || echo unknown)"
    case "$STATUS" in
      healthy|running) ;;
      *) BAD=1 ;;
    esac
  done
  [ "$BAD" -eq 0 ] && break
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    compose ps
    die "Quá thời gian chờ health check."
  fi
  sleep 5
done

log "Smoke test..."
compose exec -T server node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
compose exec -T gnss wget -qO- http://127.0.0.1:7080/health >/dev/null
HTTP_CODE="$(curl -fsS --max-time 15 -o /dev/null -w '%{http_code}' "$PUBLIC_URL")"
[ "$HTTP_CODE" = "200" ] || die "Public URL trả $HTTP_CODE"

log "Cập nhật xong: $NEW_COMMIT"
compose ps
printf '\nRollback: git checkout %s && bash update.sh\n' "$OLD_COMMIT"
