// The ten answers in evaluation.xml, re-derived from the data with the same query layer the tools use.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as q from '../src/queries.js';
import { getData } from '../src/data.js';

const xml = fs.readFileSync(new URL('../evaluation.xml', import.meta.url), 'utf8');
const answers = [...xml.matchAll(/<answer>(.*?)<\/answer>/g)].map((m) => m[1]);

test('evaluation.xml answers still hold', () => {
  const d = getData();
  assert.equal(answers.length, 10);
  const adopted = [];
  for (const [rid, r] of d.res) {
    if (r.am && r.year >= '2020' && r.year <= '2024' && q.amendmentOutcome(r, d.cast.has(rid)) === 'adopted') {
      const t = [...d.cast.get(rid).values()];
      adopted.push([r.symbol, t.filter((x) => x === 'Y').length - t.filter((x) => x === 'N').length]);
    }
  }
  assert.equal(adopted.length, 5);
  assert.equal(adopted.sort((a, b) => b[1] - a[1])[0][0], answers[0]);
  assert.equal(String(q.countryRecord({ country: 'Poland', year_start: 2020, year_end: 2022 }).yes.percent), answers[1]);
  assert.equal(q.votingPartners({ country: 'Hungary', year_start: 2006, year_end: 2026, min_shared: 60 }).closest[0].country, answers[2]);
  const modes = q.adoptionModes({ body: 'hrc', year_start: 2018, year_end: 2026 }).by_year;
  assert.equal(String(modes.sort((a, b) => a.without_vote_percent - b.without_vote_percent)[0].year), answers[3]);
  const r = q.getResolution({ symbol: 'A/HRC/RES/50/10' });
  assert.equal(r.date, '2022-07-07');
  assert.equal(`${r.recorded_vote.yes}-${r.recorded_vote.no}-${r.recorded_vote.abstain}`, answers[4]);
  assert.equal(String(q.amendments({ year_start: 2022, year_end: 2022 }).total.withdrawn), answers[5]);
  const dp = q.searchResolutions({ query: 'death penalty', year_start: 2015, year_end: 2024, mode: 'recorded', limit: 100 }).results;
  assert.equal(dp.length, 5);
  const top = dp.map((x) => [x.symbol, x.recorded_tally.no]).sort((a, b) => b[1] - a[1])[0];
  assert.equal(`${top[0]}, ${top[1]}`, answers[6]);
  const no = (s) => q.getResolution({ symbol: s }).votes.no.map((x) => x.country);
  const b = no('A/HRC/RES/48/9');
  assert.equal(no('A/HRC/RES/30/5').filter((x) => b.includes(x)).sort().join(', '), answers[7]);
  assert.equal(String(q.compareCountries({ country_a: 'Cuba', country_b: 'United States', year_start: 2006, year_end: 2026 }).directly_opposed_yes_vs_no), answers[8]);
  assert.equal(q.getResolution({ symbol: 'A/HRC/RES/48/1' }).source_record.split('/').pop(), answers[9]);
});
