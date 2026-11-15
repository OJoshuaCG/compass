#!/bin/sh
# Arranque del contenedor de la API (ver docs/deployment.md §2.5).
#
# 0. Si la variable MIGRATION_DATABASE_URL está definida, aplica las migraciones pendientes
#    (main.migrate.js, rol iam_migrator, con bloqueo consultivo). La credencial se pasa solo a ese
#    comando y se borra del entorno de este proceso, así ni sync-system-roles ni la API la heredan:
#    si la API se viera comprometida, no tendría con qué alterar el esquema. Sin la variable se
#    omite y las migraciones siguen siendo manuales. Si falla, la API no arranca.
# 1. Alinea los roles de sistema con las plantillas de esta versión (sync-system-roles, idempotente,
#    rol iam_app). Reintenta unas pocas veces para tolerar un corte breve de la base; si sigue
#    fallando, sale con error y la API no arranca, para que el despliegue no quede a medias.
# 2. Reemplaza este proceso por la API (exec), que atiende SIGTERM y se apaga ordenadamente.
#
# Este script corre como proceso principal (PID 1): sin el trap, un SIGTERM recibido durante la
# sincronización o la espera entre intentos se ignoraría y el runtime tendría que matar el
# contenedor por la fuerza al agotar el plazo de apagado.
set -u

readonly SYNC_MAX_ATTEMPTS=3
readonly SYNC_RETRY_DELAY_SECONDS=5
# 128 + número de la señal: el código convencional de un proceso terminado por SIGTERM o SIGINT.
readonly EXIT_CODE_SIGTERM=143
readonly EXIT_CODE_SIGINT=130

child_pid=""

stop_child_and_exit() {
  exit_code="$1"
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null
    wait "$child_pid" 2>/dev/null
  fi
  exit "$exit_code"
}

trap 'stop_child_and_exit "$EXIT_CODE_SIGTERM"' TERM
trap 'stop_child_and_exit "$EXIT_CODE_SIGINT"' INT

# Corre un comando en segundo plano y lo espera, para que el trap pueda actuar mientras corre.
run_interruptible() {
  "$@" &
  child_pid=$!
  wait "$child_pid"
  command_status=$?
  child_pid=""
  return "$command_status"
}

if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  migration_database_url="$MIGRATION_DATABASE_URL"
  unset MIGRATION_DATABASE_URL
  echo "Aplicando migraciones pendientes." >&2
  if ! run_interruptible env MIGRATION_DATABASE_URL="$migration_database_url" node apps/api/dist/main.migrate.js; then
    echo "Las migraciones fallaron; la API no arranca." >&2
    exit 1
  fi
  migration_database_url=""
else
  echo "MIGRATION_DATABASE_URL no está definida; no se aplican migraciones al arrancar." >&2
fi

attempt=1
while ! run_interruptible node apps/api/dist/main.sync-system-roles.js; do
  if [ "$attempt" -ge "$SYNC_MAX_ATTEMPTS" ]; then
    echo "sync-system-roles falló tras $SYNC_MAX_ATTEMPTS intentos; la API no arranca." >&2
    exit 1
  fi
  echo "sync-system-roles falló (intento $attempt de $SYNC_MAX_ATTEMPTS); reintento en ${SYNC_RETRY_DELAY_SECONDS} s." >&2
  run_interruptible sleep "$SYNC_RETRY_DELAY_SECONDS"
  attempt=$((attempt + 1))
done

exec node apps/api/dist/main.http.js
