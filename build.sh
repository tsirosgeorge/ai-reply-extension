#!/bin/sh
# Builds dist/ai-reply-extension-<version>.zip for upload to the Chrome Web Store
set -e
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
OUT="dist/ai-reply-extension-$VERSION.zip"
rm -f "$OUT"
zip -r -X "$OUT" manifest.json background.js content.js options.html options.js icons -x '*.DS_Store'
echo "Built $OUT"
