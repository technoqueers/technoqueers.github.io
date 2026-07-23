#!/usr/bin/env node
// One-off/rerunnable: fills in the `image` field on every emails/data.json
// entry using the last content image found in its corresponding HTML file.
// Safe to rerun after new issues are synced.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractLastImage } from './extract-last-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMAILS_DIR = path.join(ROOT, 'emails');
const DATA_JSON = path.join(EMAILS_DIR, 'data.json');

async function main() {
  const data = JSON.parse(await readFile(DATA_JSON, 'utf-8'));

  let changed = 0;
  for (const entry of data) {
    const html = await readFile(path.join(EMAILS_DIR, entry.file), 'utf-8');
    const image = extractLastImage(html);
    if (entry.image !== image) {
      entry.image = image;
      changed++;
    }
  }

  await writeFile(DATA_JSON, JSON.stringify(data), 'utf-8');
  console.log(`Updated image field on ${changed} of ${data.length} entries.`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
