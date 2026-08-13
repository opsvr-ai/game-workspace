#!/usr/bin/env bash
set -uo pipefail

PROJECT_DIR="/data/project/game-workspace"
export PATH="/data/node-v24.18.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
COMPOSE=(docker compose --env-file docker/.env -f docker/docker-compose.yaml)
LOCK_FILE="/tmp/chunlv-deploy.lock"
LOG_FILE="/var/log/chunlv-deploy.log"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }

cd "$PROJECT_DIR" || exit 1

exec 9>"$LOCK_FILE"
flock -n 9 || { log "deploy already running, skip"; exit 0; }

log "Checking for updates"
git fetch origin master --quiet || { log "git fetch failed"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Deploying $LOCAL -> $REMOTE"

if ! git pull --rebase --autostash origin master; then
  log "git pull failed, aborting deploy"
  exit 1
fi

if ! pnpm install --frozen-lockfile; then
  log "pnpm install failed, aborting deploy"
  exit 1
fi

if ! pnpm --filter @chunlv/server exec prisma generate; then
  log "prisma generate failed, aborting deploy"
  exit 1
fi

if ! pnpm --filter @chunlv/shared build; then
  log "shared build failed, aborting deploy"
  exit 1
fi

if ! pnpm --filter @chunlv/server build; then
  log "server build failed, aborting deploy"
  exit 1
fi

if ! pnpm --filter @chunlv/server exec prisma migrate deploy; then
  log "prisma migrate deploy failed, aborting deploy"
  exit 1
fi

if ! pnpm --filter @chunlv/web exec vite build; then
  log "web build failed, aborting deploy"
  exit 1
fi

if ! "${COMPOSE[@]}" build app; then
  log "docker build failed, aborting deploy"
  exit 1
fi

if ! "${COMPOSE[@]}" up -d --force-recreate --no-build app; then
  log "docker deploy failed, aborting deploy"
  exit 1
fi

for i in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' chunlv-app 2>/dev/null || true)
  if [ "$status" = "healthy" ]; then
    log "chunlv-app is healthy"
    exit 0
  fi
  sleep 2
done

log "WARNING: chunlv-app did not become healthy in 120s"
exit 1
