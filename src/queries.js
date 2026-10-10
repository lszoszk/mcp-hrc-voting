/**
 * Query layer: pure functions over the indexed dataset, returning plain objects.
 *
 * The defaults encode the dataset's safeguards (see docs/pitfalls.md): amendments are kept out of
 * resolution counts, an abstention is never a vote against, absence is not a position, and every
 * result carries the scope it was computed on so a number cannot be read out of context.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getData, trimTitle, DOCS } from './data.js';

export const SITE = 'https://lszoszk.github.io/hrc-voting';
const POS = { Y: 'Yes', N: 'No', A: 'Abstain' };
const BODY = { chr: 'Commission on Human Rights', hrc: 'Human Rights Council' };

export class UserError extends Error {}

export function slugify(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const share = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

function yearsOf(start, end) {
  if (start == null && end == null) return null;
  const lo = start ?? 0, hi = end ?? 9999;
  if (lo > hi) throw new UserError(`year_start (${lo}) is after year_end (${hi}).`);
  return [lo, hi];
}
const inYears = (y, years) => !years || (Number(y) >= years[0] && Number(y) <= years[1]);

function bodyLabel(body) {
  return { both: 'CHR + HRC', chr: 'CHR only', hrc: 'HRC only', ga: 'General Assembly plenary (Third Committee texts)' }[body];
}

function scopeLine(body, years, amendments) {
  const y = years ? `, ${years[0] === 0 ? 'to' : years[0] + '–'}${years[1] === 9999 ? '' : years[1]}` : '';
  return `${bodyLabel(body)}${y}; recorded votes only; ${amendments ? 'resolutions AND amendments' : 'amendments excluded'}.`;
}

function version(d) {
  return { dataset_version: d.meta.version || null, snapshot_date: d.meta.snapshot_date || null, doi: '10.5281/zenodo.21281232' };
}

const byDate = (a, b) => (a.date + a.symbol < b.date + b.symbol ? -1 : a.date + a.symbol > b.date + b.symbol ? 1 : 0);

/** Recorded CHR/HRC records with a per-country roll-call. */
function scopeResolutions(d, body = 'both', years = null, amendments = false) {
  const out = [];
  for (const [rid, r] of d.res) {
    if (!d.cast.has(rid) || (r.am && !amendments)) continue;
    if (BODY[body] && r.body !== BODY[body]) continue;
    if (!inYears(r.year, years)) continue;
    out.push(r);
  }
  return out.sort(byDate);
}

export function findCountry(d, q) {
  const q0 = String(q).trim();
  if (q0 === q0.toUpperCase() && d.countries.has(q0)) return q0;   // "GER" is a code (West Germany); "Ger" is a prefix
  const ql = q0.toLowerCase();
  const all = [...d.countries.values()];
  const exact = all.filter((c) => c.name.toLowerCase() === ql);
  if (exact.length) return exact[0].iso3;
  let hits = all.filter((c) => c.name.toLowerCase().startsWith(ql));
  if (!hits.length) hits = all.filter((c) => c.name.toLowerCase().includes(ql));
  if (hits.length === 1) return hits[0].iso3;
  throw new UserError(hits.length
    ? `Country '${q}' is ambiguous: ${hits.slice(0, 8).map((c) => `${c.name} (${c.iso3})`).join(', ')}. Use the ISO3 code, in capitals.`
    : `Country '${q}' not found. Use the English name or the ISO3 code (e.g. POL).`);
}
const cname = (d, iso) => d.countries.get(iso)?.name || d.names.get(iso) || iso;

// ------------------------------------------------------------------ info
export function info() {
  const d = getData();
  const rec = [...d.res.keys()].filter((id) => d.cast.has(id)).length;
  let cast = 0;
  for (const m of d.cast.values()) cast += m.size;
  let gaCast = 0;
  for (const m of d.gaCast.values()) gaCast += m.size;
  return {
    ...version(d),
    data_source: d.source,
    chr_hrc: {
      catalogue_records: d.res.size,
      amendments: [...d.res.values()].filter((r) => r.am).length,
      records_with_per_country_roll_call: rec,
      country_vote_rows: d.meta.country_votes ?? cast,
      yes_no_abstain_votes: cast,
    },
    general_assembly_plenary: { resolutions_adopted_by_recorded_vote: d.ga.size, state_votes_cast: gaCast },
    coverage: 'Commission on Human Rights 1946–2006 and Human Rights Council 2006– (OHCHR Library "Voting" collection); General Assembly Third Committee texts decided by recorded vote, plenary, 1970– (UN Dag Hammarskjöld Library, GA voting data v5).',
    not_included: 'General Assembly committee-stage votes and resolution texts (see the Hugging Face dataset lszoszk/hrc-voting).',
    independent_of_the_un: true,
    licence: 'PolyForm Noncommercial 1.0.0 (research, education and non-profit use free; commercial use needs a licence).',
    read_first: ['hrc_voting_known_gaps tool', 'resource hrcv://docs/pitfalls'],
  };
}

// ------------------------------------------------------------------ search
export function searchResolutions({ query, body = 'both', year_start, year_end, mode = 'all', include_amendments = false, limit = 25, offset = 0 }) {
  const d = getData();
  const years = yearsOf(year_start, year_end);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const [rid, r] of d.res) {
    if (r.am && !include_amendments) continue;
    if (BODY[body] && r.body !== BODY[body]) continue;
    if (!inYears(r.year, years)) continue;
    if (mode === 'recorded' && !d.cast.has(rid)) continue;
    if (mode === 'consensus' && r.vote_type !== 'ADOPTED WITHOUT VOTE') continue;
    const hay = [r.symbol, r.title, r.agenda_subject, r.agenda_item_title].join(' ').toLowerCase();
    if (words.every((w) => hay.includes(w))) rows.push(r);
  }
  rows.sort(byDate);
  const page = rows.slice(offset, offset + limit).map((r) => {
    const votes = d.cast.get(r.record_id);
    const t = tally(votes);
    return {
      symbol: r.symbol, date: r.date, body: r.body, title: trimTitle(r.title), subject: r.agenda_subject.trim() || null,
      adoption: r.vote_type.toLowerCase(), is_amendment: r.am,
      recorded_tally: votes ? { yes: t.Y, no: t.N, abstain: t.A } : null,
    };
  });
  return {
    ...version(d), total_matches: rows.length, returned: page.length, offset,
    has_more: offset + page.length < rows.length, next_offset: offset + page.length < rows.length ? offset + page.length : null,
    scope: `${bodyLabel(body)}${years ? `, ${years[0]}–${years[1]}` : ''}; amendments ${include_amendments ? 'included' : 'excluded'}; mode ${mode}.`,
    results: page,
  };
}

function tally(votes) {
  const t = { Y: 0, N: 0, A: 0 };
  if (votes) for (const v of votes.values()) t[v]++;
  return t;
}

// ------------------------------------------------------------------ one resolution
export function getResolution({ symbol }) {
  const d = getData();
  const s = symbol.trim().toLowerCase();
  const pick = (map) => {
    const all = [...map.values()];
    const exact = all.filter((r) => r.symbol.toLowerCase() === s);
    return exact.length ? exact : all.filter((r) => r.symbol.toLowerCase().includes(s));
  };
  const hits = pick(d.res), ga = pick(d.ga);
  const all = [...hits.map((r) => ({ r, src: 'chrhrc' })), ...ga.map((r) => ({ r, src: 'ga' }))];
  if (!all.length) throw new UserError(`No record with a symbol containing '${symbol}'. Use hrc_voting_search_resolutions to find it.`);
  const exact = all.filter((x) => x.r.symbol.toLowerCase() === s);
  if (all.length > 1 && !exact.length) {
    return { ...version(d), ambiguous: true, message: 'Several records match; call again with one full symbol.', matches: all.slice(0, 15).map((x) => ({ symbol: x.r.symbol, title: trimTitle(x.r.title) })) };
  }
  const { r, src } = exact[0] || all[0];
  const isGa = src === 'ga';
  const rid = isGa ? r.undl_id : r.record_id;
  const cast = (isGa ? d.gaCast : d.cast).get(rid);
  const absent = (isGa ? d.gaAbsent : d.absent).get(rid) || [];
  const t = tally(cast);
  const list = (code) => [...(cast || [])].filter(([, v]) => v === code).map(([iso]) => ({ iso3: iso, country: cname(d, iso) })).sort((a, b) => a.country.localeCompare(b.country));
  const out = {
    ...version(d),
    symbol: r.symbol, title: trimTitle(r.title), date: r.date, body: r.body,
    kind: isGa ? 'General Assembly plenary resolution' : r.am ? 'AMENDMENT to a draft text (not a resolution; a Yes may oppose the parent text)' : 'resolution or decision',
    subject: (r.agenda_subject || '').trim() || null,
    agenda_item: (r.agenda_item_title || '').trim().replace(/[\s\-–—]+$/, '') || null,
    main_sponsors: (r.main_sponsors || '').replace(/^Main sponsors?:\s*/i, '').trim() || null,
    adoption: (r.vote_type || '').toLowerCase() || null,
    source_record: r.record_url || null,
  };
  if (cast) {
    const rejected = /reject/i.test(r.statement || '');
    out.recorded_vote = {
      yes: t.Y, no: t.N, abstain: t.A, absent_or_not_participating: absent.length,
      outcome: rejected ? 'rejected' : t.Y > t.N ? 'adopted' : t.N > t.Y ? 'not adopted' : 'tied',
    };
    out.votes = { yes: list('Y'), no: list('N'), abstain: list('A'), absent: absent.map((iso) => ({ iso3: iso, country: cname(d, iso) })).sort((a, b) => a.country.localeCompare(b.country)) };
  } else {
    out.recorded_vote = null;
    out.note = `No per-country roll-call in the dataset (adoption: ${out.adoption || 'n/a'}; official totals Yes ${r.yes || '–'}, No ${r.no || '–'}, Abstain ${r.abstain || '–'}).`;
  }
  if (!isGa && !r.am && cast) out.page = `${SITE}/resolution/${slugify(r.symbol)}/`;
  return out;
}

// ------------------------------------------------------------------ one country
function countryRows(d, iso, body, years, amendments) {
  const rows = [];
  if (body === 'ga') {
    for (const [rid, r] of d.ga) {
      const v = d.gaCast.get(rid)?.get(iso);
      if (v && inYears(r.year, years)) rows.push([r, v]);
    }
    return rows.sort((a, b) => byDate(a[0], b[0]));
  }
  for (const r of scopeResolutions(d, body, years, amendments)) {
    const v = d.cast.get(r.record_id).get(iso);
    if (v) rows.push([r, v]);
  }
  return rows;
}

export function countryRecord({ country, body = 'both', year_start, year_end, include_amendments = false, by_year = false, recent = 10 }) {
  const d = getData();
  const iso = findCountry(d, country);
  const c = d.countries.get(iso);
  const years = yearsOf(year_start, year_end);
  const rows = countryRows(d, iso, body, years, include_amendments);
  const out = {
    ...version(d), country: cname(d, iso), iso3: iso, un_regional_group: c.group || null, historical_state: c.historical === '1',
    scope: body === 'ga' ? `General Assembly plenary, resolutions adopted by recorded vote (Third Committee texts)${years ? `, ${years[0]}–${years[1]}` : ''}; NOT combined with CHR/HRC.` : scopeLine(body, years, include_amendments),
  };
  if (!rows.length) return { ...out, votes_cast: 0, note: 'No recorded votes in this scope (the State may not have been a member then).' };
  const t = { Y: 0, N: 0, A: 0 };
  for (const [, v] of rows) t[v]++;
  const n = rows.length;
  let absent = 0;
  if (body === 'ga') {
    for (const [rid, r] of d.ga) if ((d.gaAbsent.get(rid) || []).includes(iso) && inYears(r.year, years)) absent++;
  } else {
    for (const r of scopeResolutions(d, body, years, include_amendments)) if ((d.absent.get(r.record_id) || []).includes(iso)) absent++;
  }
  const yrs = rows.map(([r]) => Number(r.year));
  out.votes_cast = n;
  out.first_year = Math.min(...yrs);
  out.last_year = Math.max(...yrs);
  out.yes = { count: t.Y, percent: pct(t.Y, n) };
  out.no = { count: t.N, percent: pct(t.N, n) };
  out.abstain = { count: t.A, percent: pct(t.A, n) };
  out.absent_or_not_participating_roll_calls = absent;
  if (by_year) {
    const by = new Map();
    for (const [r, v] of rows) {
      const y = Number(r.year);
      if (!by.has(y)) by.set(y, { year: y, votes: 0, yes: 0, no: 0, abstain: 0 });
      const o = by.get(y); o.votes++; o[v === 'Y' ? 'yes' : v === 'N' ? 'no' : 'abstain']++;
    }
    out.by_year = [...by.values()].sort((a, b) => a.year - b.year);
  }
  if (recent > 0) {
    out.recent_votes = rows.slice(-recent).reverse().map(([r, v]) => ({ date: r.date, symbol: r.symbol, title: trimTitle(r.title), vote: POS[v] }));
  }
  if (body !== 'ga') {
    out.links = { dashboard: `${SITE}/#country=${iso}`, page: `${SITE}/country/${slugify(cname(d, iso))}/` };
  }
  return out;
}

// ------------------------------------------------------------------ agreement
function agreement(d, i, j, scope) {
  let sh = 0, same = 0;
  for (const r of scope) {
    const c = d.cast.get(r.record_id);
    const a = c.get(i), b = c.get(j);
    if (a && b) { sh++; if (a === b) same++; }
  }
  return [same, sh];
}

export function votingPartners({ country, body = 'both', year_start, year_end, min_shared = 30, top = 8 }) {
  const d = getData();
  const iso = findCountry(d, country);
  const years = yearsOf(year_start, year_end);
  const scope = scopeResolutions(d, body, years, false);
  const mine = scope.filter((r) => d.cast.get(r.record_id).has(iso));
  const others = new Set();
  for (const r of mine) for (const j of d.cast.get(r.record_id).keys()) if (j !== iso) others.add(j);
  const sc = [];
  for (const j of others) {
    const [same, sh] = agreement(d, iso, j, mine);
    if (sh >= min_shared) sc.push({ iso3: j, country: cname(d, j), agreement_percent: Math.round((100 * same) / sh), same_position: same, shared_votes: sh, _s: same / sh });
  }
  sc.sort((a, b) => b._s - a._s || b.shared_votes - a.shared_votes);
  const strip = ({ _s, ...x }) => x;
  return {
    ...version(d), country: cname(d, iso), iso3: iso, scope: scopeLine(body, years, false),
    method: `Agreement = share of shared votes with the same position (Yes/No/Abstain); partners need at least ${min_shared} shared votes.`,
    votes_cast_by_country: mine.length,
    closest: sc.slice(0, top).map(strip),
    furthest: sc.slice().reverse().slice(0, top).map(strip),
    caution: 'Raw agreement is inflated when most votes are lopsided (chance agreement) and two rates are comparable only when the overlap years are alike. Describe, do not explain.',
  };
}

export function compareCountries({ country_a, country_b, body = 'both', year_start, year_end, max_disagreements = 10 }) {
  const d = getData();
  const i = findCountry(d, country_a), j = findCountry(d, country_b);
  const years = yearsOf(year_start, year_end);
  const scope = scopeResolutions(d, body, years, false).filter((r) => d.cast.get(r.record_id).has(i) && d.cast.get(r.record_id).has(j));
  const out = { ...version(d), country_a: cname(d, i), country_b: cname(d, j), scope: scopeLine(body, years, false), shared_votes: scope.length };
  if (!scope.length) return { ...out, note: 'No shared recorded votes (only members vote, so the two may never have sat together).' };
  let same = 0, opposed = 0;
  const diff = [], by = new Map();
  for (const r of scope) {
    const c = d.cast.get(r.record_id);
    const a = c.get(i), b = c.get(j);
    if (a === b) same++; else { diff.push(r); if ((a === 'Y' && b === 'N') || (a === 'N' && b === 'Y')) opposed++; }
    by.set(Number(r.year), (by.get(Number(r.year)) || 0) + 1);
  }
  out.same_position = same;
  out.same_position_percent = pct(same, scope.length);
  out.directly_opposed_yes_vs_no = opposed;
  out.shared_votes_by_year = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([year, n]) => ({ year, n }));
  out.disagreements = diff.slice(-max_disagreements).reverse().map((r) => {
    const c = d.cast.get(r.record_id);
    return { date: r.date, symbol: r.symbol, title: trimTitle(r.title), [cname(d, i)]: POS[c.get(i)], [cname(d, j)]: POS[c.get(j)] };
  });
  out.caution = 'Only members vote: compare two such rates only when the overlap years are alike (see shared_votes_by_year).';
  return out;
}

// ------------------------------------------------------------------ adoption modes
export function adoptionModes({ body = 'hrc', year_start, year_end }) {
  const d = getData();
  const years = yearsOf(year_start, year_end);
  const by = new Map();
  for (const [rid, r] of d.res) {
    if (r.am || r.vote_type === 'WITHDRAWN' || r.vote_type === 'NOT CONSIDERED') continue;
    if (BODY[body] && r.body !== BODY[body]) continue;
    if (!inYears(r.year, years)) continue;
    const y = Number(r.year);
    if (!by.has(y)) by.set(y, { year: y, texts: 0, without_vote: 0, recorded_vote: 0, other: 0 });
    const o = by.get(y);
    o.texts++;
    if (r.vote_type === 'ADOPTED WITHOUT VOTE') o.without_vote++;
    else if (d.cast.has(rid) || r.vote_type.startsWith('RECORDED')) o.recorded_vote++;
    else o.other++;
  }
  const rows = [...by.values()].sort((a, b) => a.year - b.year).map((o) => ({ ...o, without_vote_percent: pct(o.without_vote, o.texts), recorded_vote_percent: pct(o.recorded_vote, o.texts) }));
  const tot = rows.reduce((a, o) => ({ texts: a.texts + o.texts, free: a.free + o.without_vote, voted: a.voted + o.recorded_vote }), { texts: 0, free: 0, voted: 0 });
  return {
    ...version(d),
    scope: `${bodyLabel(body)}${years ? `, ${years[0]}–${years[1]}` : ''}; considered texts only (amendments and withdrawn / not-considered drafts excluded).`,
    by_year: rows,
    total: { texts: tot.texts, without_vote_percent: pct(tot.free, tot.texts), recorded_vote_percent: pct(tot.voted, tot.texts) },
    caution: "'Adopted without a vote' is not unanimity (delegations can dissociate). 'other' = non-recorded votes, mostly Commission-era.",
  };
}

// ------------------------------------------------------------------ amendments
export function amendmentOutcome(r, hasRollcall) {
  const t = (r.draft || '').toLowerCase();
  if (r.vote_type === 'WITHDRAWN' || t.includes('withdrawn')) return 'withdrawn';
  if (r.vote_type === 'NOT CONSIDERED' || t.includes('not considered')) return 'not acted upon';
  if (t.includes('no action')) return 'no-action motion';
  if (t.includes('rejected')) return 'rejected';
  if (t.includes('adopted')) return 'adopted';
  if (hasRollcall) {
    const y = parseInt(r.yes, 10), n = parseInt(r.no, 10);
    if (!Number.isNaN(y) && !Number.isNaN(n)) return y > n ? 'adopted' : 'rejected';
  }
  return 'unclassified';
}

export function amendments({ body = 'hrc', year_start, year_end }) {
  const d = getData();
  const years = yearsOf(year_start, year_end);
  const kinds = ['rejected', 'adopted', 'withdrawn', 'not acted upon', 'no-action motion', 'unclassified'];
  const by = new Map(), tot = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const [rid, r] of d.res) {
    if (!r.am || !inYears(r.year, years) || (BODY[body] && r.body !== BODY[body])) continue;
    const k = amendmentOutcome(r, d.cast.has(rid));
    const y = Number(r.year);
    if (!by.has(y)) by.set(y, { year: y, total: 0, ...Object.fromEntries(kinds.map((x) => [x, 0])) });
    const o = by.get(y); o.total++; o[k]++; tot[k]++;
  }
  const rows = [...by.values()].sort((a, b) => a.year - b.year);
  return {
    ...version(d), scope: `${bodyLabel(body)}${years ? `, ${years[0]}–${years[1]}` : ''}; amendments to draft texts, catalogue-based.`,
    by_year: rows, total: { amendments: rows.reduce((a, o) => a + o.total, 0), ...tot },
    caution: 'The catalogue omits 21 amendments in 2020–2024 (A/HRC/48/L.49–57, 49/L.43, eleven from session 56) and two of the Council\'s three rejected drafts; the Council\'s session reports (A/HRC/<session>/2) are the reference for those years. See hrc_voting_known_gaps.',
  };
}

// ------------------------------------------------------------------ gaps and documents
export function readDoc(name) {
  const p = path.join(DOCS, name);
  if (!fs.existsSync(p)) throw new UserError(`Document ${name} is missing from this installation.`);
  return fs.readFileSync(p, 'utf8');
}

export function knownGaps() {
  const d = getData();
  return { ...version(d), format: 'markdown', text: readDoc('known-gaps.md') };
}
