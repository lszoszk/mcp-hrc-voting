/**
 * Dataset loader for mcp-hrc-voting.
 *
 * Reads the gzipped CSVs shipped in ./data (a snapshot of https://github.com/lszoszk/hrc-voting,
 * see scripts/sync-data.js) once, on first use, and indexes them in memory. No network.
 *
 * Env: MCP_HRC_VOTING_DATA  directory with the same files (plain .csv or .csv.gz) to use
 *                           instead of the bundled snapshot, e.g. a fresh checkout's data/csv.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLED = path.join(root, 'data');
export const DOCS = path.join(root, 'docs');

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, embedded commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readCsv(dir, name) {
  const plain = path.join(dir, name);
  const gz = plain + '.gz';
  let text;
  if (fs.existsSync(plain)) text = fs.readFileSync(plain, 'utf8');
  else if (fs.existsSync(gz)) text = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  else throw new Error(`Missing data file ${name}(.gz) in ${dir}`);
  const [head, ...body] = parseCsv(text.replace(/^﻿/, ''));
  return body.filter((r) => r.length === head.length).map((r) => {
    const o = {};
    for (let i = 0; i < head.length; i++) o[head[i]] = r[i];
    return o;
  });
}

/** Python's str.title(): a letter is capitalised after any non-letter. */
export function titleCase(s) {
  return s.toLowerCase().replace(/(^|[^a-zà-ÿ])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());
}

export function trimTitle(t) {
  return (t || '').trim().replace(/\s*:\s*(draft\s+)?(resolution|decision|amendment)s?\s*\/.*$/i, '').trim();
}

export function isAmendment(r) {
  return /:\s*amendment/i.test(r.title) || /^\s*amendment/i.test(r.draft || '');
}

let cache = null;

export function getData() {
  if (cache) return cache;
  const dir = process.env.MCP_HRC_VOTING_DATA ? path.resolve(process.env.MCP_HRC_VOTING_DATA) : BUNDLED;
  const metaPath = path.join(BUNDLED, 'meta.json');
  const d = {
    source: dir === BUNDLED ? 'bundled snapshot' : `directory ${dir}`,
    meta: fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {},
    res: new Map(), cast: new Map(), absent: new Map(), names: new Map(),
    ga: new Map(), gaCast: new Map(), gaAbsent: new Map(), countries: new Map(),
  };
  for (const r of readCsv(dir, 'resolutions.csv')) {
    r.am = isAmendment(r);
    d.res.set(r.record_id, r);
  }
  const put = (map, key, iso, code) => {
    let m = map.get(key);
    if (!m) map.set(key, (m = new Map()));
    m.set(iso, code);
  };
  const push = (map, key, iso) => {
    const a = map.get(key);
    if (a) a.push(iso); else map.set(key, [iso]);
  };
  for (const v of readCsv(dir, 'votes_long.csv')) {
    if (v.vote === 'Y' || v.vote === 'N' || v.vote === 'A') put(d.cast, v.record_id, v.iso3, v.vote);
    else if (v.vote === '.') push(d.absent, v.record_id, v.iso3);
    if (!d.names.has(v.iso3)) d.names.set(v.iso3, titleCase(v.country));
  }
  for (const r of readCsv(dir, 'ga_resolutions.csv')) d.ga.set(r.undl_id, r);
  for (const v of readCsv(dir, 'ga_votes_long.csv')) {
    if (v.vote === 'Y' || v.vote === 'N' || v.vote === 'A') put(d.gaCast, v.undl_id, v.iso3, v.vote);
    else if (v.vote === '.') push(d.gaAbsent, v.undl_id, v.iso3);
    if (!d.names.has(v.iso3)) d.names.set(v.iso3, titleCase(v.country));
  }
  const cp = path.join(BUNDLED, 'countries.csv');
  if (fs.existsSync(cp)) {
    for (const c of readCsv(BUNDLED, 'countries.csv')) d.countries.set(c.iso3, c);
  }
  for (const [iso, name] of d.names) {
    if (!d.countries.has(iso)) d.countries.set(iso, { iso3: iso, name, group: '', historical: '0' });
  }
  cache = d;
  return d;
}
