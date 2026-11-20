#!/usr/bin/env node
// Fetches the latest sent EmailOctopus campaign and, if it's not already in
// emails/data.json, adds it to the static archive (new HTML file + JSON entry).
// Requires EMAILOCTOPUS_API_KEY in the environment. With the R2_* variables
// (see lib/r2.mjs) set, it also backs the issue's images up to R2; either way
// the issue is pointed at any R2 copies that already exist. R2 problems are
// only warned about, so they never stop an issue from being archived.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchLatestSentCampaign, buildArchiveItem, writeSearchIndex } from './lib/eo.mjs';
import { writeMemeIndex } from './lib/memes.mjs';
import { imageMirror } from './lib/r2.mjs';
import { loadManifest, mirrorIssueHtml } from './lib/images.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMAILS_DIR = path.join(ROOT, 'emails');
const DATA_JSON = path.join(EMAILS_DIR, 'data.json');

async function main() {
  const latest = await fetchLatestSentCampaign();
  if (!latest) {
    console.log('No sent campaigns found.');
    return;
  }

  const data = JSON.parse(await readFile(DATA_JSON, 'utf-8'));
  if (data.some((entry) => entry.id === latest.id)) {
    console.log(`Already synced: ${latest.subject} (${latest.id})`);
    return;
  }

  const { entry, file, html } = await buildArchiveItem(latest);

  const r2 = imageMirror();
  const manifest = await loadManifest(EMAILS_DIR);
  await writeFile(path.join(EMAILS_DIR, file), await mirrorIssueHtml(html, { manifest, r2, emailsDir: EMAILS_DIR }), 'utf-8');

  data.unshift(entry);
  await writeFile(DATA_JSON, JSON.stringify(data), 'utf-8');
  await writeSearchIndex(data, EMAILS_DIR);
  await writeMemeIndex(data, EMAILS_DIR);

  console.log(`Added newsletter: ${entry.subject} (${entry.date}) -> emails/${file}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
