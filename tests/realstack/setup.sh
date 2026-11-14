#!/bin/bash
# Starts a throwaway Postgres + PostgREST that stand in for Supabase, with the repo's SQL applied.
# Usage: tests/realstack/setup.sh start | stop
# Needs: Homebrew postgresql@16 (initdb, pg_ctl, psql). PostgREST is downloaded into tests/.tmp.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
TMP="$REPO/tests/.tmp"; PGDATA="$TMP/pgdata"; PGPORT=54329; API_PORT=3300
PGBIN="$(brew --prefix postgresql@16 2>/dev/null)/bin"; export PATH="$PGBIN:$PATH"
PGRST_VER="v16.5"; PGRST="$TMP/postgrest"
SECRET="local-test-secret-local-test-secret-0123456789"   # test-only; signs local tokens, nothing else

case "${1:-start}" in
start)
  "$0" stop >/dev/null
  mkdir -p "$TMP"
  if [ ! -x "$PGRST" ]; then
    arch=$([ "$(uname -m)" = arm64 ] && echo aarch64 || echo x86-64)
    curl -sL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VER/postgrest-$PGRST_VER-macos-$arch.tar.xz" | tar xJ -C "$TMP"
  fi
  rm -rf "$PGDATA"; initdb -D "$PGDATA" -U postgres -A trust >/dev/null
  pg_ctl -D "$PGDATA" -o "-p $PGPORT -k \"$PGDATA\"" -l "$TMP/pg.log" start -w >/dev/null
  P="psql -h localhost -p $PGPORT -U postgres -X -q -v ON_ERROR_STOP=1"
  $P -c "create database ct" >/dev/null
  $P -d ct -f "$HERE/schema.sql" >/dev/null
  for f in "$REPO"/sql/[0-9][0-9][0-9]-*.sql; do
    case "$f" in *-rollback.sql) ;; *) $P -d ct -f "$f" >/dev/null ;; esac
  done
  cat > "$TMP/pgrst.conf" <<EOF
db-uri = "postgres://authenticator@localhost:$PGPORT/ct"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = $API_PORT
db-max-rows = 1000
EOF
  # launched directly: macOS strips DYLD_* variables when going through system binaries like nohup
  DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix postgresql@16)/lib" "$PGRST" "$TMP/pgrst.conf" >"$TMP/pgrst.log" 2>&1 &
  echo $! > "$TMP/pgrst.pid"; disown
  for i in $(seq 1 50); do curl -s -o /dev/null "http://localhost:$API_PORT/" && break; sleep 0.2; done
  curl -s -o /dev/null "http://localhost:$API_PORT/" || { echo "PostgREST failed to start:"; cat "$TMP/pgrst.log"; exit 1; }
  echo "realstack up: Postgres :$PGPORT, PostgREST :$API_PORT"
  ;;
stop)
  [ -f "$TMP/pgrst.pid" ] && kill "$(cat "$TMP/pgrst.pid")" 2>/dev/null || true; rm -f "$TMP/pgrst.pid"
  [ -d "$PGDATA" ] && pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  echo "realstack down"
  ;;
esac
