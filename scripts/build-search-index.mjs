#!/usr/bin/env node
// Rebuilds emails/search.json from the issues already in emails/. The sync and
// backfill scripts do this themselves; run it directly if an issue is edited by hand.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeSearchIndex } from './lib/eo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.resolve(__dirname, '..', 'emails');

async function main() {
  const data = JSON.parse(await readFile(path.join(EMAILS_DIR, 'data.json'), 'utf-8'));
  await writeSearchIndex(data, EMAILS_DIR);
  console.log(`Indexed ${data.length} issue(s) -> emails/search.json`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
