# Cursor Browser Bridge

Control Cursor IDE's embedded browser from Claude Code (or any MCP client).

## What this does

Cursor has a built-in browser (Simple Browser) that its own AI agent can use. This project bridges that browser to Claude Code via the [Model Context Protocol](https://modelcontextprotocol.io/), giving Claude Code the same browser automation capabilities.

**Architecture:**

```
Claude Code ←stdio/MCP→ mcp-bridge.js ←HTTP→ VS Code extension ←commands→ cursor.browserView.* → Cursor's browser
```

## Available tools (18)

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL, returns page snapshot |
| `browser_snapshot` | Accessibility tree of the page with element refs |
| `browser_click` | Click an element by ref |
| `browser_type` | Type text into an element (appends) |
| `browser_fill` | Clear and fill an element's value |
| `browser_screenshot` | Take a screenshot |
| `browser_tabs` | List open browser tabs |
| `browser_evaluate` | Execute arbitrary JavaScript |
| `browser_console_messages` | Get console log output |
| `browser_network_requests` | Get network request log |
| `browser_press_key` | Press a keyboard key |
| `browser_hover` | Hover over an element |
| `browser_resize` | Resize the browser viewport |
| `browser_lock` / `browser_unlock` | Lock/unlock browser for automation |
| `browser_navigate_back` / `browser_navigate_forward` | History navigation |
| `browser_reload` | Reload the current page |

## Install

```bash
git clone https://github.com/VectorlyApp/cursor-browser-bridge.git
cd cursor-browser-bridge
chmod +x install.sh uninstall.sh
./install.sh
```

Then:
1. **Reload Cursor window** — `Ctrl+Shift+P` → "Developer: Reload Window"
2. **Verify extension** — Check Output panel (`Ctrl+Shift+U`) → select "Browser Bridge" from the dropdown
3. **Restart Claude Code** — so it picks up the new MCP server

> **Tip:** You'll need to reload the Cursor window (`Ctrl+Shift+P` → "Developer: Reload Window") any time the extension files are updated.

## Uninstall

```bash
./uninstall.sh
```

Then reload the Cursor window (`Ctrl+Shift+P` → "Developer: Reload Window").

## How it works

The project has two components:

### 1. VS Code Extension (`extension/`)

A workspace extension that starts an HTTP server on a random local port. It wraps `cursor.browserView.*` commands (Cursor's internal API for controlling the embedded browser) as HTTP endpoints.

The extension runs on the workspace host (which can be a remote SSH server). VS Code/Cursor transparently proxies the `cursor.browserView.*` commands to the UI host where the actual browser lives. This is the key insight that makes the whole thing work.

The port is written to `/tmp/cursor-browser-bridge-port` so the MCP bridge can find it.

### 2. MCP Bridge (`mcp-bridge.js`)

A Node.js script that speaks MCP (JSON-RPC 2.0 over stdio) and translates tool calls into HTTP requests to the extension's server. Claude Code launches this as a subprocess.

## Requirements

- **Cursor IDE** (the extension uses Cursor-specific `cursor.browserView.*` commands)
- **Node.js** (for the MCP bridge)
- **Claude Code** (or any MCP-compatible client)

## Troubleshooting

**Extension not activating:**
- Check the Output panel → "Browser Bridge" channel for errors
- Make sure you reloaded the Cursor window after installing
- Verify the extension exists: `ls ~/.cursor-server/extensions/local.cursor-browser-bridge-*`

**MCP bridge can't connect:**
- Check that `/tmp/cursor-browser-bridge-port` exists and contains a port number
- Try `curl http://127.0.0.1:$(cat /tmp/cursor-browser-bridge-port)/health` — should return `{"ok":true}`

**Tools not showing in Claude Code:**
- Restart Claude Code after running `install.sh`
- Check `claude mcp list` to verify the server is registered

**`browser_fill` or `browser_click` not working:**
- Take a fresh snapshot first — element refs go stale when the page changes
- Use `browser_evaluate` with custom JS as a reliable fallback for complex interactions
