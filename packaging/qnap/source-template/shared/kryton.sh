#!/bin/sh
# Kryton service control script. Invoked by App Center via QPKG_SERVICE_PROGRAM.
# POSIX sh — QTS uses busybox ash, no bashisms.

set -e

QPKG_NAME="kryton"
QPKG_DIR="${QPKG_DIR:-$(/sbin/getcfg "${QPKG_NAME}" Install_Path -f /etc/config/qpkg.conf 2>/dev/null)}"
QPKG_DIR="${QPKG_DIR:-$(dirname "$(readlink -f "$0")")}"

COMPOSE_FILE="${QPKG_DIR}/docker-compose.yml"
ENV_FILE="${QPKG_DIR}/.env"
LOG_FILE="${QPKG_DIR}/logs/kryton.log"

# Container Station ships docker-compose in one of these paths across QTS versions.
# Order matters: prefer the modern v2 plugin form first.
find_docker(){
    for candidate in \
        /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker \
        /share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/docker \
        /share/ZFS530_DATA/.qpkg/container-station/bin/docker \
        /usr/local/bin/docker \
        /usr/bin/docker; do
        if [ -x "${candidate}" ]; then
            DOCKER_BIN="${candidate}"
            return 0
        fi
    done
    echo "Container Station docker binary not found" >&2
    return 1
}

find_compose_cmd(){
    find_docker || return 1
    # Prefer 'docker compose' (v2 plugin). Fall back to legacy docker-compose binary.
    if "${DOCKER_BIN}" compose version >/dev/null 2>&1; then
        COMPOSE_CMD="${DOCKER_BIN} compose"
        return 0
    fi
    for candidate in \
        /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose \
        /share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/docker-compose \
        /usr/local/bin/docker-compose; do
        if [ -x "${candidate}" ]; then
            COMPOSE_CMD="${candidate}"
            return 0
        fi
    done
    echo "docker compose (v1 or v2) not found in Container Station" >&2
    return 1
}

ensure_log_dir(){
    mkdir -p "$(dirname "${LOG_FILE}")"
}

run_compose(){
    ensure_log_dir
    cd "${QPKG_DIR}"
    # shellcheck disable=SC2086
    ${COMPOSE_CMD} --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@" >>"${LOG_FILE}" 2>&1
}

cmd_start(){
    find_compose_cmd || exit 1
    run_compose up -d
}

cmd_stop(){
    find_compose_cmd || exit 1
    run_compose down
}

cmd_restart(){
    cmd_stop || true
    cmd_start
}

cmd_status(){
    find_compose_cmd || exit 1
    ensure_log_dir
    cd "${QPKG_DIR}"
    # shellcheck disable=SC2086
    running=$(${COMPOSE_CMD} -f "${COMPOSE_FILE}" ps --services --filter "status=running" 2>/dev/null | wc -l)
    if [ "${running}" -gt 0 ]; then
        echo "running"
        return 0
    fi
    echo "stopped"
    return 1
}

cmd_log(){
    echo "${LOG_FILE}"
}

cmd_remove(){
    # App Center invokes "remove" — synonym for stop. Data preserved.
    cmd_stop
}

case "${1:-}" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    status)  cmd_status ;;
    log)     cmd_log ;;
    remove)  cmd_remove ;;
    *)
        echo "usage: $0 {start|stop|restart|status|log|remove}" >&2
        exit 2
        ;;
esac
