#!/usr/bin/env node
// Rebuilds emails/memes.json from the issues already in emails/. The sync
// script does this itself; run it directly if an issue is edited by hand.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeMemeIndex } from './lib/memes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.resolve(__dirname, '..', 'emails');

async function main() {
  const data = JSON.parse(await readFile(path.join(EMAILS_DIR, 'data.json'), 'utf-8'));
  const index = await writeMemeIndex(data, EMAILS_DIR);
  const count = index.reduce((n, issue) => n + issue.memes.length, 0);
  console.log(`Found ${count} meme(s) in ${index.length} issue(s) -> emails/memes.json`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
