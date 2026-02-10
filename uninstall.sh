#!/usr/bin/env bash
#
# Uninstall Cursor Browser Bridge
#
set -euo pipefail

# Remove extension from both possible locations
for DIR in "$HOME/.cursor-server/extensions" "$HOME/.cursor/extensions"; do
    for EXT in "$DIR"/local.cursor-browser-bridge-*; do
        if [ -d "$EXT" ]; then
            echo "==> Removing $EXT"
            rm -rf "$EXT"
        fi
    done
done

# Remove port file
rm -f /tmp/cursor-browser-bridge-port

# Remove MCP registration from Claude Code
if command -v claude &>/dev/null; then
    echo "==> Removing MCP bridge from Claude Code..."
    claude mcp remove cursor-browser 2>/dev/null || true
fi

echo "Done! Reload the Cursor window to complete uninstall."
