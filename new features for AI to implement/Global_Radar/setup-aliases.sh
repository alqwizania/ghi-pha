#!/bin/bash
# Install convenient aliases for Health Agents git workflow
# Run this once: source /srv/repos/health-agents/setup-aliases.sh

echo "Setting up Health Agents git aliases..."

# Add to current shell
alias ha-commit='/srv/repos/health-agents/sync-and-commit.sh'
alias ha-quick='/srv/repos/health-agents/quick-commit.sh'
alias ha-status='cd /srv/repos/health-agents && git status'
alias ha-log='cd /srv/repos/health-agents && git log --oneline -10'
alias ha-pull='cd /srv/repos/health-agents && git pull'

# Add to .bashrc for persistence
BASHRC="$HOME/.bashrc"
if ! grep -q "Health Agents aliases" "$BASHRC" 2>/dev/null; then
    cat >> "$BASHRC" << 'EOF'

# Health Agents git aliases
alias ha-commit='/srv/repos/health-agents/sync-and-commit.sh'
alias ha-quick='/srv/repos/health-agents/quick-commit.sh'
alias ha-status='cd /srv/repos/health-agents && git status'
alias ha-log='cd /srv/repos/health-agents && git log --oneline -10'
alias ha-pull='cd /srv/repos/health-agents && git pull'
EOF
    echo "✅ Aliases added to $BASHRC"
else
    echo "ℹ️  Aliases already in $BASHRC"
fi

echo ""
echo "✅ Aliases installed! Available commands:"
echo ""
echo "  ha-commit     - Interactive sync, commit, and push"
echo "  ha-quick      - Quick commit: ha-quick \"message\""
echo "  ha-status     - Check git status"
echo "  ha-log        - View recent commits"
echo "  ha-pull       - Pull from GitHub"
echo ""
echo "To use now: source ~/.bashrc"
