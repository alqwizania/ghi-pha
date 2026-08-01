#!/bin/bash
# Sync health-agents from Git repository to build source
# Location: /srv/repos/health-agents/sync-to-build.sh

set -e

SOURCE_DIR="/srv/repos/health-agents/app"
BUILD_DIR="/srv/apps/source/health-agents"

echo "🔄 Syncing health-agents to build source..."
echo "   Source: $SOURCE_DIR"
echo "   Target: $BUILD_DIR"
echo

# Check if source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory not found: $SOURCE_DIR"
    exit 1
fi

# Check if target exists
if [ ! -d "$BUILD_DIR" ]; then
    echo "⚠️  Warning: Build directory not found: $BUILD_DIR"
    echo "   Creating directory..."
    mkdir -p "$BUILD_DIR"
fi

# Sync files
rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='package-lock.json' \
  --exclude='.git' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  "$SOURCE_DIR/" \
  "$BUILD_DIR/"

echo
echo "✅ Sync complete"
echo
echo "Next steps:"
echo "  1. Review changes: cd $BUILD_DIR && git status"
echo "  2. Build image: docker build -t phn-agents:latest $BUILD_DIR"
echo "  3. Deploy: cd /srv/docker/health-agents && docker compose restart"
