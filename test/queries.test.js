// Golden values for dataset v1.2.0. They were produced by the reference CLI of the Claude skill
// (hrc-voting/scripts/hrcv.py) on the same snapshot, so this file doubles as a parity test between
// the two implementations. A failure after `npm run sync-data` means the data changed: re-derive them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as q from '../src/queries.js';

test('info: counts match the published dataset', () => {
  const i = q.info();
  assert.equal(i.dataset_version, '1.2.0');
  assert.equal(i.chr_hrc.catalogue_records, 6392);
  assert.equal(i.chr_hrc.amendments, 749);
  assert.equal(i.chr_hrc.records_with_per_country_roll_call, 1716);
  assert.equal(i.chr_hrc.country_vote_rows, 80676);
  assert.equal(i.general_assembly_plenary.resolutions_adopted_by_recorded_vote, 708);
});

test('resolution A/HRC/RES/48/1: 28 Yes, 5 No, 14 abstentions', () => {
  const r = q.getResolution({ symbol: 'A/HRC/RES/48/1' });
  assert.deepEqual([r.recorded_vote.yes, r.recorded_vote.no, r.recorded_vote.abstain], [28, 5, 14]);
  assert.equal(r.recorded_vote.outcome, 'adopted');
  assert.equal(r.date, '2021-10-07');
  assert.match(r.source_record, /record\/30044$/);
  assert.equal(r.votes.no.map((v) => v.iso3).sort().join(), 'CHN,ERI,PAK,RUS,VEN');
  assert.equal(r.page, 'https://lszoszk.github.io/hrc-voting/resolution/a-hrc-res-48-1/');
});

test('an amendment is labelled as one', () => {
  const r = q.getResolution({ symbol: 'A/HRC/48/L.59' });
  assert.match(r.kind, /AMENDMENT/);
  assert.deepEqual([r.recorded_vote.yes, r.recorded_vote.no, r.recorded_vote.abstain], [16, 13, 16]);
  assert.equal(r.page, undefined);
});

test('country record: Poland', () => {
  const all = q.countryRecord({ country: 'Poland' });
  assert.equal(all.votes_cast, 560);
  const w = q.countryRecord({ country: 'Poland', year_start: 2020, year_end: 2022 });
  assert.deepEqual([w.votes_cast, w.yes.count, w.no.count, w.abstain.count], [107, 68, 33, 6]);
  assert.match(w.scope, /amendments excluded/);
  assert.equal(w.links.dashboard, 'https://lszoszk.github.io/hrc-voting/#country=POL');
});

test('country names: a prefix is not a code', () => {
  assert.throws(() => q.countryRecord({ country: 'Ger' }), /ambiguous/);
  assert.equal(q.countryRecord({ country: 'GER' }).country, 'Germany (FRG)');
  assert.equal(q.countryRecord({ country: 'germany' }).iso3, 'DEU');
  assert.throws(() => q.countryRecord({ country: 'Atlantis' }), /not found/);
});

test('General Assembly record is separate', () => {
  const g = q.countryRecord({ country: 'Germany', body: 'ga', year_start: 2020, year_end: 2025 });
  assert.deepEqual([g.votes_cast, g.yes.count], [122, 69]);
  assert.match(g.scope, /NOT combined/);
});

test('voting partners: Hungary 2006–2026', () => {
  const p = q.votingPartners({ country: 'Hungary', year_start: 2006, year_end: 2026, top: 4 });
  assert.deepEqual(p.closest.map((x) => [x.country, x.agreement_percent, x.shared_votes]), [['Poland', 100, 66], ['Romania', 100, 36], ['Latvia', 95, 37], ['France', 93, 46]]);
  assert.equal(p.votes_cast_by_country, 188);
});

test('compare: Poland and the Netherlands, with overlap years', () => {
  const c = q.compareCountries({ country_a: 'Poland', country_b: 'Netherlands', year_start: 2006, year_end: 2026 });
  assert.deepEqual([c.shared_votes, c.same_position], [125, 124]);
  assert.deepEqual(c.shared_votes_by_year.map((x) => x.year), [2006, 2007, 2020, 2021, 2022]);
  assert.equal(c.disagreements[0].symbol, 'A/HRC/RES/50/10');
  assert.equal(q.compareCountries({ country_a: 'Poland', country_b: 'Hungary', year_start: 2020, year_end: 2026 }).shared_votes, 0);
});

test('adoption modes: HRC 2018–2026', () => {
  const a = q.adoptionModes({ body: 'hrc', year_start: 2018, year_end: 2026 });
  assert.equal(a.total.texts, 1051);
  assert.equal(a.total.without_vote_percent, 73);
});

test('amendments 2020–2024: 340 in the catalogue, 5 adopted', () => {
  const a = q.amendments({ year_start: 2020, year_end: 2024 });
  assert.equal(a.total.amendments, 340);
  assert.deepEqual([a.total.rejected, a.total.adopted, a.total.withdrawn, a.total['not acted upon']], [198, 5, 115, 22]);
  assert.deepEqual(a.by_year.map((y) => y.total), [58, 94, 84, 69, 35]);
  assert.match(a.caution, /21 amendments/);
});

test('search: amendments excluded by default, pagination', () => {
  const s = q.searchResolutions({ query: 'death penalty', year_start: 2015, year_end: 2024, mode: 'recorded', limit: 2 });
  assert.equal(s.total_matches, 5);
  assert.equal(s.returned, 2);
  assert.equal(s.has_more, true);
  assert.deepEqual(s.results[0].recorded_tally, { yes: 26, no: 13, abstain: 8 });
  assert.equal(s.results[0].symbol, 'A/HRC/RES/30/5');
  const next = q.searchResolutions({ query: 'death penalty', year_start: 2015, year_end: 2024, mode: 'recorded', limit: 2, offset: s.next_offset });
  assert.notEqual(next.results[0].symbol, s.results[0].symbol);
  assert.ok(s.results.every((r) => !r.is_amendment));
});

test('known gaps are readable', () => {
  assert.match(q.knownGaps().text, /A\/HRC\/48\/L\.11/);
});
