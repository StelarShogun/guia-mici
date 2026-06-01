#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x ".venv/bin/uvicorn" ]; then
  python -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

.venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000
