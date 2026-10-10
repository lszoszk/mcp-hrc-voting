#!/usr/bin/env node
/**
 * Copy the dataset snapshot (and the reasoning documents) from a checkout of
 * https://github.com/lszoszk/hrc-voting into this package.
 *
 *   node scripts/sync-data.js [path/to/hrc-voting]    (default: ../OHCHR_voting)
 *
 * The snapshot is built there by scripts/build_skill_snapshot.py (gzipped CSVs,
 * countries.csv, meta.json); the Claude skill reads the same files, so the skill and
 * this server answer from identical data. Run it, bump "version" in package.json to
 * the dataset version it prints, and re-run the tests (their golden values belong to v1.2.0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(process.argv[2] || path.join(root, '..', 'OHCHR_voting'));
const skill = path.join(repo, 'skills', 'hrc-voting');
if (!fs.existsSync(path.join(skill, 'assets', 'data', 'meta.json'))) {
  console.error(`No snapshot at ${skill}/assets/data — pass the path to a checkout of lszoszk/hrc-voting.`);
  process.exit(1);
}
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
for (const f of fs.readdirSync(path.join(skill, 'assets', 'data'))) {
  fs.copyFileSync(path.join(skill, 'assets', 'data', f), path.join(root, 'data', f));
}
for (const f of ['known-gaps.md', 'pitfalls.md', 'schema.md', 'verification.md']) {
  fs.copyFileSync(path.join(skill, 'references', f), path.join(root, 'docs', f));
}
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data', 'meta.json'), 'utf8'));
console.log(`synced dataset v${meta.version} (snapshot ${meta.snapshot_date}) from ${repo}`);
