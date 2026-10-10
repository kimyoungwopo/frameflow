#!/bin/zsh
set -euo pipefail
cd "${FRAMEFLOW_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
if [[ -f .frameflow-server.env ]]; then
  set -a
  source .frameflow-server.env
  set +a
fi
exec /usr/bin/node server.js
