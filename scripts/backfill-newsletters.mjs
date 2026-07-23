#!/usr/bin/env node
// One-off/occasional backfill: pulls every sent EmailOctopus campaign and adds
// any not already in emails/data.json (matched by campaign id), each as its
// own HTML file, then re-sorts data.json newest-first by date.
// Requires EMAILOCTOPUS_API_KEY in the environment.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchAllSentCampaigns, buildArchiveItem } from './lib/eo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMAILS_DIR = path.join(ROOT, 'emails');
const DATA_JSON = path.join(EMAILS_DIR, 'data.json');

async function main() {
  const data = JSON.parse(await readFile(DATA_JSON, 'utf-8'));
  const knownIds = new Set(data.map((entry) => entry.id).filter(Boolean));

  const campaigns = await fetchAllSentCampaigns();
  const missing = campaigns.filter((c) => !knownIds.has(c.id));

  if (missing.length === 0) {
    console.log('Nothing to backfill — every sent campaign is already archived.');
    return;
  }

  console.log(`Found ${missing.length} campaign(s) not yet in the archive.`);

  const added = [];
  for (const summary of missing) {
    const { entry, file, html } = await buildArchiveItem(summary);
    await writeFile(path.join(EMAILS_DIR, file), html, 'utf-8');
    data.push(entry);
    added.push(entry);
    console.log(`  + ${entry.subject} (${entry.date}) -> emails/${file}`);
  }

  data.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  await writeFile(DATA_JSON, JSON.stringify(data), 'utf-8');

  console.log(`Backfilled ${added.length} newsletter issue(s).`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
