#!/usr/bin/env node
// Fetches the latest sent EmailOctopus campaign and, if it's not already in
// emails/data.json, adds it to the static archive (new HTML file + JSON entry).
// Requires EMAILOCTOPUS_API_KEY in the environment.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchLatestSentCampaign, buildArchiveItem } from './lib/eo.mjs';

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

  await writeFile(path.join(EMAILS_DIR, file), html, 'utf-8');

  data.unshift(entry);
  await writeFile(DATA_JSON, JSON.stringify(data), 'utf-8');

  console.log(`Added newsletter: ${entry.subject} (${entry.date}) -> emails/${file}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
