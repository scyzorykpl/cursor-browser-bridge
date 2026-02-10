#!/usr/bin/env node
/**
 * MCP stdio bridge for Cursor Browser Bridge.
 *
 * Speaks the MCP protocol (JSON-RPC 2.0) over stdin/stdout and proxies
 * tool calls to the Browser Bridge extension's HTTP server.
 *
 * Usage:
 *   claude mcp add cursor-browser -- node /path/to/mcp-bridge.js
 */
const http = require('http');
const fs = require('fs');
const readline = require('readline');

const PORT_FILE = '/tmp/cursor-browser-bridge-port';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Tool definitions (MCP schema)
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
    {
        name: 'browser_navigate',
        description: "Navigate to a URL in Cursor's embedded browser. Returns a page snapshot.",
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to navigate to' },
                viewId: { type: 'string', description: 'Target browser tab ID. Omit to use active tab.' },
                newTab: { type: 'boolean', description: 'Open in a new tab instead of reusing existing.' },
            },
            required: ['url'],
        },
    },
    {
        name: 'browser_snapshot',
        description: 'Capture accessibility snapshot of the current page. Returns a YAML tree of page elements with refs for interaction.',
        inputSchema: {
            type: 'object',
            properties: {
                viewId: { type: 'string', description: 'Target browser tab ID.' },
                interactive: { type: 'boolean', description: 'Only include interactive elements.' },
                maxDepth: { type: 'number', description: 'Max depth. Default 20.' },
                selector: { type: 'string', description: 'CSS selector to scope snapshot.' },
            },
        },
    },
    {
        name: 'browser_click',
        description: 'Click an element on the page by its ref from a snapshot.',
        inputSchema: {
            type: 'object',
            properties: {
                element: { type: 'string', description: 'Human-readable element description.' },
                ref: { type: 'string', description: 'Element ref from snapshot (e.g. "e5").' },
                viewId: { type: 'string' },
            },
            required: ['element', 'ref'],
        },
    },
    {
        name: 'browser_type',
        description: 'Type text into a focused or referenced input element (appends text).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: { type: 'string', description: 'Element ref.' },
                text: { type: 'string', description: 'Text to type.' },
                viewId: { type: 'string' },
            },
            required: ['ref', 'text'],
        },
    },
    {
        name: 'browser_fill',
        description: 'Clear and fill an input element with a value.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: { type: 'string', description: 'Element ref.' },
                value: { type: 'string', description: 'Value to fill.' },
                viewId: { type: 'string' },
            },
            required: ['ref', 'value'],
        },
    },
    {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current page.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_tabs',
        description: 'List all open browser tabs with their URLs and titles.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'browser_lock',
        description: 'Lock the browser to prevent user interaction while automating.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_unlock',
        description: 'Unlock the browser to allow user interaction.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_navigate_back',
        description: 'Go back in browser history.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_navigate_forward',
        description: 'Go forward in browser history.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_reload',
        description: 'Reload the current page.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_console_messages',
        description: 'Get console messages from the browser.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_network_requests',
        description: 'Get network requests from the browser.',
        inputSchema: { type: 'object', properties: { viewId: { type: 'string' } } },
    },
    {
        name: 'browser_press_key',
        description: 'Press a keyboard key.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to press (e.g. "Enter", "Tab", "Escape").' },
                viewId: { type: 'string' },
            },
            required: ['key'],
        },
    },
    {
        name: 'browser_hover',
        description: 'Hover over an element.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: { type: 'string', description: 'Element ref.' },
                viewId: { type: 'string' },
            },
            required: ['ref'],
        },
    },
    {
        name: 'browser_resize',
        description: 'Resize the browser viewport.',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number' },
                height: { type: 'number' },
                viewId: { type: 'string' },
            },
            required: ['width', 'height'],
        },
    },
    {
        name: 'browser_evaluate',
        description: 'Execute arbitrary JavaScript in the browser page and return the result.',
        inputSchema: {
            type: 'object',
            properties: {
                script: { type: 'string', description: 'JavaScript code to execute.' },
                viewId: { type: 'string' },
            },
            required: ['script'],
        },
    },
];

// ---------------------------------------------------------------------------
// HTTP client → extension server
// ---------------------------------------------------------------------------

let bridgePort = null;

async function waitForPort() {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
        try {
            const port = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
            if (port > 0) { bridgePort = port; return port; }
        } catch (_) {}
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`Browser Bridge extension not running (no port file at ${PORT_FILE} after ${POLL_TIMEOUT_MS}ms)`);
}

function callTool(name, args) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ name, args });
        const req = http.request({
            hostname: '127.0.0.1',
            port: bridgePort,
            path: '/tool',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 60000,
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString()));
                } catch (err) {
                    reject(new Error('Invalid JSON from bridge: ' + Buffer.concat(chunks).toString().slice(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Bridge request timed out')); });
        req.write(body);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// MCP protocol (JSON-RPC 2.0 over stdio)
// ---------------------------------------------------------------------------

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleMessage(msg) {
    const { id, method, params } = msg;

    switch (method) {
        case 'initialize':
            return { jsonrpc: '2.0', id, result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'cursor-browser-bridge', version: '0.2.0' },
                capabilities: { tools: {} },
            }};

        case 'notifications/initialized':
            return null; // no response for notifications

        case 'tools/list':
            return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFS } };

        case 'tools/call': {
            const { name, arguments: args } = params;
            try {
                const result = await callTool(name, args || {});
                const content = (result?.content || [])
                    .map(item => {
                        if (item.type === 'image') return { type: 'image', data: item.data, mimeType: item.mimeType };
                        if (item.type === 'text') return { type: 'text', text: item.text };
                        return null; // skip metadata
                    })
                    .filter(Boolean);

                if (!content.length) {
                    content.push({ type: 'text', text: result?.error || 'No result' });
                }

                return { jsonrpc: '2.0', id, result: { content, isError: false } };
            } catch (err) {
                return { jsonrpc: '2.0', id, result: {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true,
                }};
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', id, result: {} };

        default:
            if (id !== undefined) {
                return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
            }
            return null;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    try {
        await waitForPort();
    } catch (err) {
        process.stderr.write(`ERROR: ${err.message}\n`);
        process.exit(1);
    }

    process.stderr.write(`[mcp-bridge] Connected to Browser Bridge on port ${bridgePort}\n`);

    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', async (line) => {
        try {
            const msg = JSON.parse(line);
            const response = await handleMessage(msg);
            if (response) send(response);
        } catch (err) {
            process.stderr.write(`[mcp-bridge] Error: ${err.message}\n`);
        }
    });
    rl.on('close', () => process.exit(0));
}

main();
