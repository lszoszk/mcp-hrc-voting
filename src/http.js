#!/usr/bin/env node
/**
 * mcp-hrc-voting — Streamable HTTP entry point (remote clients, self-hosting).
 *
 * Stateless: a fresh server + transport per POST, which is safe because the tools hold no session
 * state (the dataset is loaded once per process).
 *
 * Config (env):
 *   PORT            listen port        (default 8005)
 *   HOST            bind address       (default 127.0.0.1)
 *   MCP_AUTH_TOKEN  optional bearer token (Authorization: Bearer … or X-API-Key); leave unset when a proxy gates the route
 *   MCP_HRC_VOTING_DATA  optional data directory instead of the bundled snapshot
 */
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, VERSION } from './server.js';
import { getData } from './data.js';

const PORT = Number(process.env.PORT || 8005);
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';
const d = getData();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-hrc-voting', version: VERSION, dataset_version: d.meta.version, snapshot_date: d.meta.snapshot_date, transport: 'streamable-http' });
});

function authorized(req) {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.replace(/^Bearer\s+/i, '').trim() === AUTH_TOKEN) return true;
  return req.headers['x-api-key'] === AUTH_TOKEN;
}

const jsonRpcError = (res, status, code, message) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

app.post('/mcp', async (req, res) => {
  if (!authorized(req)) return jsonRpcError(res, 401, -32001, 'Unauthorized');
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp-http] request error:', err);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
  }
});

// Stateless mode has no stream to resume or terminate; a spec-compliant client expects 405 on GET/DELETE.
const methodNotAllowed = (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed (stateless server: use POST /mcp).');
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(PORT, HOST, () => {
  console.error(`mcp-hrc-voting ${VERSION} (http) listening on http://${HOST}:${PORT}/mcp · dataset v${d.meta.version} · auth ${AUTH_TOKEN ? 'token-gated' : 'open (gate at proxy)'}`);
});
