#!/bin/bash
# Quick sync and commit (no prompts, auto-push)
# Usage: ./quick-commit.sh "Your commit message"

set -e

REPO_DIR="/srv/repos/health-agents"
APP_SOURCE="/srv/apps/source/health-agents"
INFRA_SOURCE="/srv/docker/health-agents"

if [ -z "$1" ]; then
    echo "❌ Usage: $0 \"commit message\""
    exit 1
fi

cd "$REPO_DIR"

# Sync files
rsync -a --delete \
    --exclude='node_modules' --exclude='findings/*.json' --exclude='reports/*.pptx' \
    --exclude='reports/*.json' --exclude='test-results/*.json' --exclude='*.log' \
    --exclude='.env' --exclude='.env.*' --exclude='FILES_CREATED.txt' \
    "$APP_SOURCE/" "$REPO_DIR/app/" > /dev/null

rsync -a --delete --exclude='.env' --exclude='.env.local' \
    "$INFRA_SOURCE/" "$REPO_DIR/infrastructure/" > /dev/null

touch "$REPO_DIR/app/findings/.gitkeep"
touch "$REPO_DIR/app/reports/.gitkeep"
touch "$REPO_DIR/app/test-results/.gitkeep"

# Move docs
for doc in PUBLIC_API_GUIDE.md QUICK_START.md README_PHASE2.md SYSTEM_STATUS.md WATCH_UUIDS.md; do
    [ -f "$REPO_DIR/app/$doc" ] && mv "$REPO_DIR/app/$doc" "$REPO_DIR/docs/" 2>/dev/null || true
done

# Commit and push
git add .
git commit -m "$1"
git push

echo "✅ Synced, committed, and pushed: $1"
