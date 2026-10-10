/**
 * mcp-hrc-voting shared server factory.
 *
 * Nine read-only tools over the HRC Voting dataset (how States voted at the Commission on Human
 * Rights, the Human Rights Council and, as plenary votes, the General Assembly's Third Committee)
 * and four resources with the reasoning behind the safeguards. Used by both entry points:
 *   - src/index.js  stdio  (Claude Desktop / Claude Code)
 *   - src/http.js   Streamable HTTP, stateless (remote clients, self-hosting)
 *
 * Everything is answered from the bundled snapshot: no network, no API key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as q from './queries.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

const INSTRUCTIONS = [
  'HRC Voting: how States voted on UN human-rights texts (Commission on Human Rights 1946-2006, Human Rights Council 2006-, General Assembly Third Committee plenary 1970-). Answers come from a bundled snapshot; every result states its scope and dataset version, so carry both into your reply.',
  'Safeguards, already the defaults: amendments to draft texts are NOT resolutions and are excluded unless include_amendments is true (a Yes on a hostile amendment often opposes the text); an abstention is not a vote against (the outcome is Yes vs No); absent or not-a-member is not a position; the General Assembly is a different body and is never added to CHR/HRC counts; "adopted without a vote" is not unanimity.',
  'The OHCHR catalogue omits two of the Council\'s three rejected draft texts and 21 amendments in 2020-2024: call hrc_voting_known_gaps before any claim about amendments, rejected texts or the 2020-2025 sessions. Agreement between States is descriptive (raw agreement is inflated by lopsided votes). Cite resolutions by UN symbol and the dataset by DOI 10.5281/zenodo.21281232.',
].join('\n\n');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const year = (label) => z.number().int().min(1946).max(2100).optional().describe(label);
const bodyCH = z.enum(['both', 'chr', 'hrc']).default('both').describe('chr = Commission on Human Rights (1946–2006), hrc = Human Rights Council (2006–), both = CHR + HRC.');

function ok(out) {
  return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out };
}

function run(fn) {
  return async (args) => {
    try {
      return ok(fn(args));
    } catch (e) {
      if (e instanceof q.UserError) return { isError: true, content: [{ type: 'text', text: e.message }] };
      console.error('[mcp-hrc-voting] tool error:', e);
      return { isError: true, content: [{ type: 'text', text: `Internal error: ${e.message}` }] };
    }
  };
}

export function buildServer() {
  const server = new McpServer({ name: 'mcp-hrc-voting', version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool('hrc_voting_info', {
    title: 'About the HRC Voting dataset',
    description: 'Dataset version, snapshot date, what is and is not covered (counts of catalogue records, roll-calls, votes, General Assembly resolutions) and the licence. Call it once to know the scope you are answering from.',
    inputSchema: {}, annotations: READ_ONLY,
  }, run(() => q.info()));

  server.registerTool('hrc_voting_search_resolutions', {
    title: 'Search resolutions and decisions',
    description: 'Find Commission on Human Rights / Human Rights Council resolutions and decisions by words in the symbol, title, subject or agenda item (e.g. "death penalty", "Afghanistan", "A/HRC/RES/48"). Amendments are excluded unless include_amendments is true. Each result shows its adoption mode and, for recorded votes, the Yes/No/Abstain tally. Page with offset/limit. For the General Assembly use hrc_voting_get_resolution with a symbol or hrc_voting_country_record with body "ga".',
    inputSchema: {
      query: z.string().min(1).describe('Words that must all appear, e.g. "freedom of religion" or "A/HRC/RES/48".'),
      body: bodyCH,
      year_start: year('First year, e.g. 2010.'), year_end: year('Last year, e.g. 2024.'),
      mode: z.enum(['all', 'recorded', 'consensus']).default('all').describe('recorded = decided by a roll-call (has per-State votes); consensus = adopted without a vote; all = both and the rest.'),
      include_amendments: z.boolean().default(false).describe('Include amendments to draft texts (they are not resolutions).'),
      limit: z.number().int().min(1).max(100).default(25).describe('Results per page (1–100).'),
      offset: z.number().int().min(0).default(0).describe('Offset into the sorted results (use next_offset from the previous page).'),
    }, annotations: READ_ONLY,
  }, run((a) => q.searchResolutions(a)));

  server.registerTool('hrc_voting_get_resolution', {
    title: 'One resolution: tally and every State\'s vote',
    description: 'Look up one text by its UN symbol (e.g. "A/HRC/RES/48/1", "E/CN.4/RES/2005/80", "A/RES/2647(XXV)", or an amendment "A/HRC/48/L.59"). Returns metadata, the recorded tally and outcome, who voted Yes / No / Abstain / was absent, the OHCHR source record URL and, for recorded CHR/HRC resolutions, the plain page on the HRC Voting site. A partial symbol returns candidates when it is ambiguous.',
    inputSchema: { symbol: z.string().min(2).describe('Full UN symbol, e.g. "A/HRC/RES/48/1".') }, annotations: READ_ONLY,
  }, run((a) => q.getResolution(a)));

  server.registerTool('hrc_voting_country_record', {
    title: 'A State\'s voting record',
    description: 'How one State voted: votes cast, Yes/No/Abstain counts and shares, roll-calls it was absent from, optionally year by year and its most recent votes. Resolutions only by default (amendments excluded). body "ga" gives the General Assembly plenary record (Third Committee texts), which is never combined with CHR/HRC. Only members vote, so a State has no record outside its terms. Accepts the English name or an ISO3 code in capitals.',
    inputSchema: {
      country: z.string().min(2).describe('English name ("Poland") or ISO3 code in capitals ("POL"). A name prefix like "Ger" is ambiguous; "GER" is West Germany.'),
      body: z.enum(['both', 'chr', 'hrc', 'ga']).default('both').describe('both = CHR + HRC; ga = General Assembly plenary (separate).'),
      year_start: year('First year.'), year_end: year('Last year.'),
      include_amendments: z.boolean().default(false).describe('Also count votes on amendments (CHR/HRC only); they are not resolutions.'),
      by_year: z.boolean().default(false).describe('Add a year-by-year table.'),
      recent: z.number().int().min(0).max(50).default(10).describe('How many of the latest votes to list (0 = none).'),
    }, annotations: READ_ONLY,
  }, run((a) => q.countryRecord(a)));

  server.registerTool('hrc_voting_voting_partners', {
    title: 'Closest and furthest voting partners',
    description: 'The States a given State voted with most and least often on shared recorded votes (resolutions only, CHR/HRC). Agreement is the share of shared votes with the same position; partners need min_shared shared votes. Raw agreement is inflated by lopsided votes and only comparable over similar overlap years: report shared-vote counts and describe, do not explain.',
    inputSchema: {
      country: z.string().min(2).describe('English name or ISO3 code in capitals.'),
      body: bodyCH, year_start: year('First year.'), year_end: year('Last year.'),
      min_shared: z.number().int().min(5).max(500).default(30).describe('Minimum shared votes for a State to count as a partner.'),
      top: z.number().int().min(1).max(30).default(8).describe('How many closest and furthest partners to return.'),
    }, annotations: READ_ONLY,
  }, run((a) => q.votingPartners(a)));

  server.registerTool('hrc_voting_compare_countries', {
    title: 'Two States head to head',
    description: 'Shared recorded votes of two States (resolutions only, CHR/HRC): how often they took the same position, how often one voted Yes and the other No, in which years they overlapped, and their most recent disagreements. Two such rates are comparable only when the overlap years are alike.',
    inputSchema: {
      country_a: z.string().min(2).describe('English name or ISO3 code.'), country_b: z.string().min(2).describe('English name or ISO3 code.'),
      body: bodyCH, year_start: year('First year.'), year_end: year('Last year.'),
      max_disagreements: z.number().int().min(0).max(50).default(10).describe('How many of the latest disagreements to list.'),
    }, annotations: READ_ONLY,
  }, run((a) => q.compareCountries(a)));

  server.registerTool('hrc_voting_adoption_modes', {
    title: 'Consensus versus recorded votes over time',
    description: 'Per year, the share of considered texts adopted without a vote versus by recorded vote (amendments and withdrawn / not-considered drafts excluded). Default body is the Human Rights Council. "Adopted without a vote" is not unanimity. The General Assembly is not covered (its source has no consensus texts).',
    inputSchema: { body: z.enum(['hrc', 'chr', 'both']).default('hrc'), year_start: year('First year.'), year_end: year('Last year.') }, annotations: READ_ONLY,
  }, run((a) => q.adoptionModes(a)));

  server.registerTool('hrc_voting_amendments', {
    title: 'Amendments to draft texts by outcome and year',
    description: 'Counts of amendments by outcome (rejected, adopted, withdrawn, not acted upon, no-action motion) per year, from the catalogue. The catalogue is missing 21 amendments in 2020–2024; the Council\'s session reports are the reference for those years (see hrc_voting_known_gaps). Use this, not the resolution tools, for anything about amendments.',
    inputSchema: { body: z.enum(['hrc', 'chr', 'both']).default('hrc'), year_start: year('First year.'), year_end: year('Last year.') }, annotations: READ_ONLY,
  }, run((a) => q.amendments(a)));

  server.registerTool('hrc_voting_known_gaps', {
    title: 'Known gaps in the OHCHR catalogue',
    description: 'What the source catalogue lacks (two of the Council\'s three rejected drafts and 21 amendments in 2020–2024, with their outcomes), votes that are not what they look like (no-action motions), timing lags, and totals verified against the Council\'s session reports. Read it before any claim about amendments, rejected texts or recent sessions.',
    inputSchema: {}, annotations: READ_ONLY,
  }, run(() => q.knownGaps()));

  const docs = [
    ['pitfalls', 'Pitfalls: what goes wrong with UN voting data', 'The reasoning behind the safeguards: amendments, abstentions, roll-call selection, consensus, absence, GA vs CHR/HRC, agreement.'],
    ['known-gaps', 'Known gaps in the OHCHR catalogue', 'Missing rejected drafts and amendments, no-action motions, verified totals.'],
    ['schema', 'Data schema', 'Columns and vote codes of the CSVs and what is not bundled.'],
    ['verification', 'Checking a published claim about HRC votes', 'How to verify a figure against the Council\'s session reports (A/HRC/<session>/2).'],
  ];
  for (const [name, title, description] of docs) {
    server.registerResource(name, `hrcv://docs/${name}`, { title, description, mimeType: 'text/markdown' }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: q.readDoc(`${name}.md`) }],
    }));
  }
  return server;
}
