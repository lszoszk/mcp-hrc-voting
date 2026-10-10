// End to end over the real MCP protocol: spawn the stdio server and talk to it with the SDK's client.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

async function connect() {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry] }));
  return client;
}

test('lists nine read-only tools, four resources and the instructions', async () => {
  const c = await connect();
  try {
    const tools = (await c.listTools()).tools;
    assert.equal(tools.length, 9);
    assert.ok(tools.every((t) => t.name.startsWith('hrc_voting_') && t.annotations?.readOnlyHint === true));
    assert.equal((await c.listResources()).resources.length, 4);
    assert.match(c.getInstructions(), /amendments to draft texts are NOT resolutions/);
  } finally { await c.close(); }
});

test('a tool call returns text and structured content', async () => {
  const c = await connect();
  try {
    const r = await c.callTool({ name: 'hrc_voting_get_resolution', arguments: { symbol: 'A/HRC/RES/48/1' } });
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.recorded_vote.yes, 28);
    assert.match(r.content[0].text, /"outcome": "adopted"/);
    const e = await c.callTool({ name: 'hrc_voting_country_record', arguments: { country: 'Ger' } });
    assert.equal(e.isError, true);
    assert.match(e.content[0].text, /ambiguous/);
    const doc = await c.readResource({ uri: 'hrcv://docs/pitfalls' });
    assert.match(doc.contents[0].text, /Amendments are not resolutions/);
  } finally { await c.close(); }
});
