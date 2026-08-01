#!/bin/bash
# Health Agents - Sync & Commit Script
# Syncs working directories to git repo and commits changes

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Paths
REPO_DIR="/srv/repos/health-agents"
APP_SOURCE="/srv/apps/source/health-agents"
INFRA_SOURCE="/srv/docker/health-agents"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Health Agents - Sync & Commit to Git                       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if repo exists
if [ ! -d "$REPO_DIR/.git" ]; then
    echo -e "${RED}❌ Git repository not found at $REPO_DIR${NC}"
    exit 1
fi

# Navigate to repo
cd "$REPO_DIR"

echo -e "${YELLOW}📂 Syncing files from working directories...${NC}"
echo ""

# Sync application code
echo "  → Syncing app/ from $APP_SOURCE"
rsync -av --delete \
    --exclude='node_modules' \
    --exclude='findings/*.json' \
    --exclude='reports/*.pptx' \
    --exclude='reports/*.json' \
    --exclude='test-results/*.json' \
    --exclude='*.log' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.test.backup' \
    --exclude='FILES_CREATED.txt' \
    --exclude='PHASE2_FILES.txt' \
    --exclude='PROJECT_STRUCTURE.txt' \
    "$APP_SOURCE/" "$REPO_DIR/app/" > /dev/null

# Keep .gitkeep files
touch "$REPO_DIR/app/findings/.gitkeep"
touch "$REPO_DIR/app/reports/.gitkeep"
touch "$REPO_DIR/app/test-results/.gitkeep"

# Sync infrastructure
echo "  → Syncing infrastructure/ from $INFRA_SOURCE"
rsync -av --delete \
    --exclude='.env' \
    --exclude='.env.local' \
    "$INFRA_SOURCE/" "$REPO_DIR/infrastructure/" > /dev/null

# Move docs to docs/ directory if they're in app/
for doc in PUBLIC_API_GUIDE.md QUICK_START.md README_PHASE2.md SYSTEM_STATUS.md WATCH_UUIDS.md; do
    if [ -f "$REPO_DIR/app/$doc" ]; then
        mv "$REPO_DIR/app/$doc" "$REPO_DIR/docs/" 2>/dev/null || true
    fi
done

echo -e "${GREEN}✅ Files synced${NC}"
echo ""

# Check for changes
if git diff --quiet && git diff --cached --quiet; then
    echo -e "${YELLOW}ℹ️  No changes to commit${NC}"
    exit 0
fi

# Show what changed
echo -e "${BLUE}📊 Changes detected:${NC}"
git status --short
echo ""

# Ask for commit message
echo -e "${YELLOW}📝 Enter commit message (or press Ctrl+C to cancel):${NC}"
read -p "> " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    echo -e "${RED}❌ Commit message cannot be empty${NC}"
    exit 1
fi

# Stage all changes
git add .

# Show what will be committed
echo ""
echo -e "${BLUE}📦 Files to be committed:${NC}"
git status --short
echo ""

# Confirm
read -p "Commit these changes? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  Commit cancelled${NC}"
    git reset
    exit 0
fi

# Commit
git commit -m "$COMMIT_MSG"
echo -e "${GREEN}✅ Changes committed${NC}"
echo ""

# Ask to push
read -p "Push to GitHub? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}🚀 Pushing to GitHub...${NC}"
    git push
    echo -e "${GREEN}✅ Pushed to GitHub${NC}"
else
    echo -e "${YELLOW}ℹ️  Changes committed locally. Push later with: cd $REPO_DIR && git push${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Done!                                                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
