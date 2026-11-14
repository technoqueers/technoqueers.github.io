#!/usr/bin/env node
// One-off/occasional backfill: pulls every sent EmailOctopus campaign and adds
// any not already in emails/data.json (matched by campaign id), each as its
// own HTML file, then re-sorts data.json newest-first by date.
// Requires EMAILOCTOPUS_API_KEY in the environment. With the R2_* variables
// (see lib/r2.mjs) set, it also backs the issue's images up to R2 and points
// the issue at the copies.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchAllSentCampaigns, buildArchiveItem, writeSearchIndex } from './lib/eo.mjs';
import { writeMemeIndex } from './lib/memes.mjs';
import { imageMirror } from './lib/r2.mjs';
import { loadManifest, saveManifest, mirrorIssueHtml } from './lib/images.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMAILS_DIR = path.join(ROOT, 'emails');
const DATA_JSON = path.join(EMAILS_DIR, 'data.json');

async function main() {
  const data = JSON.parse(await readFile(DATA_JSON, 'utf-8'));
  const knownIds = new Set(data.map((entry) => entry.id).filter(Boolean));

  const campaigns = await fetchAllSentCampaigns();
  console.log(`EmailOctopus reports ${campaigns.length} sent campaign(s) total.`);

  const missing = campaigns.filter((c) => !knownIds.has(c.id));

  if (missing.length === 0) {
    console.log('Nothing to backfill — every sent campaign is already archived.');
    return;
  }

  console.log(`Found ${missing.length} campaign(s) not yet in the archive.`);

  const r2 = imageMirror();
  const manifest = await loadManifest(EMAILS_DIR);

  const added = [];
  for (const summary of missing) {
    const { entry, file, html } = await buildArchiveItem(summary);
    await writeFile(path.join(EMAILS_DIR, file), await mirrorIssueHtml(html, { manifest, r2 }), 'utf-8');
    if (r2) await saveManifest(manifest, EMAILS_DIR);
    data.push(entry);
    added.push(entry);
    console.log(`  + ${entry.subject} (${entry.date}) -> emails/${file}`);
  }

  data.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  await writeFile(DATA_JSON, JSON.stringify(data), 'utf-8');
  await writeSearchIndex(data, EMAILS_DIR);
  await writeMemeIndex(data, EMAILS_DIR);

  console.log(`Backfilled ${added.length} newsletter issue(s).`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
