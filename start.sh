#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
PORT="${PORT:-3000}"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 0 && PORT < 65536 )) || { echo "Invalid PORT: $PORT" >&2; exit 1; }
BUILD_DIR="$PROJECT_DIR/dist"

# Install only when this project actually declares dependencies.
if [[ -f "$PROJECT_DIR/package.json" ]]; then
  if [[ -f "$PROJECT_DIR/package-lock.json" ]]; then
    /usr/bin/time -p npm ci --no-audit --no-fund
  else
    /usr/bin/time -p npm install --no-audit --no-fund
  fi
  if node -e 'process.exit(require(process.argv[1]).scripts?.build ? 0 : 1)' "$PROJECT_DIR/package.json"; then
    /usr/bin/time -p npm run build
    if [[ ! -f "$BUILD_DIR/index.html" && -f "$PROJECT_DIR/build/index.html" ]]; then
      BUILD_DIR="$PROJECT_DIR/build"
    fi
    [[ -f "$BUILD_DIR/index.html" ]] || { echo 'Build completed without dist/index.html or build/index.html.' >&2; exit 1; }
  else
    /usr/bin/time -p mkdir -p "$BUILD_DIR"
    /usr/bin/time -p cp "$PROJECT_DIR/index.html" "$PROJECT_DIR/game.js" "$PROJECT_DIR/style.css" "$BUILD_DIR/"
  fi
else
  /usr/bin/time -p mkdir -p "$BUILD_DIR"
  /usr/bin/time -p cp "$PROJECT_DIR/index.html" "$PROJECT_DIR/game.js" "$PROJECT_DIR/style.css" "$BUILD_DIR/"
fi

[[ "$BUILD_DIR" == "$PROJECT_DIR"/* ]] || { echo 'Built directory must be inside PROJECT_DIR.' >&2; exit 1; }
[[ -f "$BUILD_DIR/index.html" ]] || { echo "Missing built entry point: $BUILD_DIR/index.html" >&2; exit 1; }

DEPLOYMENT_DIR="/home/runner/work/_temp/omgithub-web"
/usr/bin/time -p mkdir -p "$DEPLOYMENT_DIR"
PROJECT_DIR="$PROJECT_DIR" BUILD_DIR="$BUILD_DIR" /usr/bin/time -p python3 -c 'import json, os, pathlib, tempfile; target=pathlib.Path("/home/runner/work/_temp/omgithub-web/deployment-output.json"); data={"project":os.environ["PROJECT_DIR"],"directory":os.environ["BUILD_DIR"]}; tmp=target.with_suffix(".json.tmp"); tmp.write_text(json.dumps(data)+"\n"); tmp.replace(target)'

echo "Serving $BUILD_DIR on 0.0.0.0:$PORT"
/usr/bin/time -p python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$BUILD_DIR"
