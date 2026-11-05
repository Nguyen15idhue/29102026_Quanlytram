#!/usr/bin/env bash
# Cập nhật nhanh trên VPS: pull code và chỉ build/restart service bị ảnh hưởng.
# Không backup, không chạy migration. Nếu có migration, dùng update.sh.
# Chạy:  bash hot_update.sh              (tự phát hiện service)
#        bash hot_update.sh web
#        bash hot_update.sh server
#        bash hot_update.sh gnss
#        bash hot_update.sh stack         (compose/Caddyfile)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cors/app}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
PUBLIC_URL="${PUBLIC_URL:-https://rtktk.online/}"
BUILD_GUIDE="${BUILD_GUIDE:-0}"
SCOPE="${1:-auto}"

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

case "$SCOPE" in
  auto|web|server|gnss|stack) ;;
  *) die "Tham số không hợp lệ: $SCOPE (auto|web|server|gnss|stack)" ;;
esac

log "Kiểm tra repo ($BRANCH)..."
git_run fetch origin "$BRANCH"
git_run checkout "$BRANCH"
if ! git_run diff --quiet || ! git_run diff --cached --quiet; then
  die "Repo có thay đổi chưa commit. Xử lý hoặc stash trước khi update."
fi

OLD_COMMIT="$(git_run rev-parse --short HEAD)"
git_run pull --ff-only origin "$BRANCH"
NEW_COMMIT="$(git_run rev-parse --short HEAD)"

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  log "Không có commit mới ($NEW_COMMIT). Không cần deploy."
  exit 0
fi

CHANGED="$(git_run diff --name-only "$OLD_COMMIT" "$NEW_COMMIT")"
log "Commit: $OLD_COMMIT -> $NEW_COMMIT"
printf '%s\n' "$CHANGED" | sed 's/^/  - /'

if printf '%s\n' "$CHANGED" | grep -q '^db/migrations/'; then
  die "Có thay đổi migration. Dùng 'bash update.sh' để backup và migrate."
fi

SERVICES=""
ADD_GUIDE=0
add_service() {
  case " $SERVICES " in
    *" $1 "*) ;;
    *) SERVICES="${SERVICES:+$SERVICES }$1" ;;
  esac
}

if [ "$SCOPE" = "auto" ]; then
  while IFS= read -r FILE; do
    case "$FILE" in
      frontend/*) add_service web-prod ;;
      server/*) add_service server ;;
      gnss/*) add_service gnss ;;
      docs-site/*|scripts/build-guide.mjs) add_service web-prod; ADD_GUIDE=1 ;;
      docker-compose.prod.yml|Caddyfile|Caddyfile.staging) add_service stack ;;
    esac
  done <<< "$CHANGED"
else
  case "$SCOPE" in
    web) add_service web-prod ;;
    server) add_service server ;;
    gnss) add_service gnss ;;
    stack) add_service stack ;;
  esac
fi

if [ "$ADD_GUIDE" = "1" ]; then
  if [ "$BUILD_GUIDE" = "1" ]; then
    log "Build lại trang hướng dẫn (/guide)..."
    docker run --rm -v "$APP_DIR:/app" -w /app node:22-alpine \
      sh -c "cd docs-site && npm ci --no-audit --no-fund && cd .. && node scripts/build-guide.mjs"
    chown -R deploy:deploy "$APP_DIR/frontend/public/guide" 2>/dev/null || true
  else
    log "CẢNH BÁO: docs-site thay đổi nhưng BUILD_GUIDE!=1; /guide giữ bản cũ."
  fi
fi

STACK=0
case " $SERVICES " in *" stack "*) STACK=1 ;; esac
BUILD_SERVICES="$(printf '%s\n' $SERVICES | grep -v '^stack$' || true)"

if [ "$STACK" = "1" ]; then
  log "Áp dụng cấu hình compose/Caddyfile..."
  compose up -d --remove-orphans
  compose restart caddy
fi

if [ -n "$BUILD_SERVICES" ]; then
  log "Build: $BUILD_SERVICES"
  # shellcheck disable=SC2086
  compose build $BUILD_SERVICES
  log "Restart: $BUILD_SERVICES"
  # shellcheck disable=SC2086
  compose up -d --no-deps $BUILD_SERVICES
fi

if [ -z "$SERVICES" ]; then
  log "Chỉ có thay đổi tài liệu/không thuộc service nào. Đã pull code, không restart."
  exit 0
fi

log "Chờ services healthy (tối đa ${HEALTH_TIMEOUT}s)..."
TARGETS="$(printf '%s\n' $SERVICES | grep -v '^stack$' || true)"
if [ -n "$TARGETS" ]; then
  DEADLINE=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    BAD=0
    for SERVICE in $TARGETS; do
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
    sleep 3
  done
fi

log "Smoke test..."
if [ -n "$TARGETS" ]; then
  for SERVICE in $TARGETS; do
    case "$SERVICE" in
      server)
        compose exec -T server node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" ;;
      gnss)
        compose exec -T gnss wget -qO- http://127.0.0.1:7080/health >/dev/null ;;
      web-prod)
        compose exec -T web-prod wget -qO- http://127.0.0.1:8080/ >/dev/null ;;
    esac
  done
fi
HTTP_CODE="$(curl -fsS --max-time 15 -o /dev/null -w '%{http_code}' "$PUBLIC_URL")"
[ "$HTTP_CODE" = "200" ] || die "Public URL trả $HTTP_CODE"

log "Hot update xong: $NEW_COMMIT"
compose ps
