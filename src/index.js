#!/usr/bin/env node
/**
 * mcp-hrc-voting — stdio entry point (Claude Desktop / Claude Code).
 * Diagnostics go to stderr so they cannot corrupt the stdio JSON-RPC stream.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, VERSION } from './server.js';
import { getData } from './data.js';

const d = getData();   // load now so a broken data directory fails at startup, not on the first question
const server = buildServer();
await server.connect(new StdioServerTransport());
console.error(`mcp-hrc-voting ${VERSION} (stdio) ready · dataset v${d.meta.version} (${d.meta.snapshot_date}) · ${d.source}`);
