#!/bin/bash
# Build Next.js static export for Tauri
# Temporarily hides API routes (which are handled by the Rust backend)
# and middleware (not supported in static export)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_DIR/src/app/api"
API_BACKUP="$PROJECT_DIR/src/app/_api_backup"
MIDDLEWARE="$PROJECT_DIR/middleware.ts"
MIDDLEWARE_BACKUP="$PROJECT_DIR/_middleware_backup.ts"

cleanup() {
  # Restore API routes
  if [ -d "$API_BACKUP" ]; then
    rm -rf "$API_DIR"
    mv "$API_BACKUP" "$API_DIR"
  fi
  # Restore middleware
  if [ -f "$MIDDLEWARE_BACKUP" ]; then
    mv "$MIDDLEWARE_BACKUP" "$MIDDLEWARE"
  fi
}

# Always restore on exit
trap cleanup EXIT

# Move API routes and middleware out of the way
mv "$API_DIR" "$API_BACKUP"
mv "$MIDDLEWARE" "$MIDDLEWARE_BACKUP"

# Run Next.js build with static export enabled
STATIC_EXPORT=1 npx next build

echo "Static export completed successfully. Output in out/"
