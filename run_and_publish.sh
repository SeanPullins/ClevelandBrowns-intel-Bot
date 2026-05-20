#!/bin/bash

cd "$HOME/ClevenadBrowns-intel-Bot" || exit 1

source .venv/bin/activate

echo "===== Browns Intel run started: $(date) ====="

python browns_intel_bot.py --hours 72

git add public docs src/App.tsx browns_intel_bot.py config.yaml requirements.txt .gitignore

git commit -m "Update Browns intelligence report $(date '+%Y-%m-%d %H:%M')" || true

git push origin main

echo "===== Browns Intel run finished: $(date) ====="
