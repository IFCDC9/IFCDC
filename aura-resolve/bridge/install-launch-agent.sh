#!/bin/zsh
# Install the user LaunchAgent for the AURA Resolve production node.
# Starts at login; KeepAlive recovers crashes. Does not require sudo.
set -euo pipefail

LABEL="com.ifcdc.aura-resolve-production-node"
SRC="$(cd "$(dirname "$0")" && pwd)/${LABEL}.plist"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/IFCDC"
SUPPORT_DIR="${HOME}/Library/Application Support/IFCDC/aura-resolve"

mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}" "${SUPPORT_DIR}"
cp "${SRC}" "${DEST}"

# Prefer production link file; never overwrite an existing hq-production.json.
if [[ ! -f "${SUPPORT_DIR}/hq-production.json" ]]; then
  echo "Missing ${SUPPORT_DIR}/hq-production.json — enroll against production HQ first." >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${DEST}"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed and started ${LABEL}"
launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -n 40 || launchctl list | grep "${LABEL}" || true
