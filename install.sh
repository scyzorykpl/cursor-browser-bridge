#!/usr/bin/env bash
#
# Install Cursor Browser Bridge
#
# This script:
#   1. Copies the VS Code extension to the Cursor extensions directory
#   2. Registers the MCP bridge with Claude Code (if installed)
#
# After running, reload the Cursor window (Ctrl+Shift+P → "Developer: Reload Window")
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_NAME="local.cursor-browser-bridge-0.2.0"

# Detect Cursor extensions directory
if [ -d "$HOME/.cursor-server/extensions" ]; then
    # Remote SSH environment
    EXT_DIR="$HOME/.cursor-server/extensions/$EXT_NAME"
elif [ -d "$HOME/.cursor/extensions" ]; then
    # Local environment
    EXT_DIR="$HOME/.cursor/extensions/$EXT_NAME"
else
    echo "ERROR: Could not find Cursor extensions directory."
    echo "Looked in: ~/.cursor-server/extensions/ and ~/.cursor/extensions/"
    exit 1
fi

echo "==> Installing extension to $EXT_DIR"
mkdir -p "$EXT_DIR"
cp "$SCRIPT_DIR/extension/package.json" "$EXT_DIR/"
cp "$SCRIPT_DIR/extension/extension.js"  "$EXT_DIR/"
cp "$SCRIPT_DIR/extension/snapshot.js"   "$EXT_DIR/"

echo "==> Extension installed."

# Register MCP bridge with Claude Code (if available)
if command -v claude &>/dev/null; then
    echo "==> Registering MCP bridge with Claude Code..."
    claude mcp add cursor-browser -- node "$SCRIPT_DIR/mcp-bridge.js"
    echo "==> MCP bridge registered."
else
    echo ""
    echo "NOTE: Claude Code CLI not found. To register manually, run:"
    echo "  claude mcp add cursor-browser -- node $SCRIPT_DIR/mcp-bridge.js"
fi

echo ""
echo "Done! Next steps:"
echo "  1. Reload Cursor window (Ctrl+Shift+P → Developer: Reload Window)"
echo "  2. Check Output panel for 'Browser Bridge' channel to verify it's running"
echo "  3. Restart Claude Code to pick up the new MCP server"
