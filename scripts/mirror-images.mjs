#!/usr/bin/env node
// Backs up every image the archived issues reference to Cloudflare R2 and
// rewrites the issues to load the R2 copies. Safe to rerun: anything already
// in emails/images.json is skipped, and anything already in the bucket isn't
// re-uploaded. See scripts/lib/images.mjs for the details and scripts/lib/r2.mjs
// for the R2_* environment variables.
//
//   node scripts/mirror-images.mjs                 mirror what's missing, then rewrite issues
//   node scripts/mirror-images.mjs --dry-run       report what would be mirrored (no R2 needed)
//   node scripts/mirror-images.mjs --retry-failed  also retry images that failed before
//   node scripts/mirror-images.mjs --rewrite-only  only apply the manifest to the issues (no R2 needed)
//   node scripts/mirror-images.mjs --concurrency=8

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { r2ConfigFromEnv, createR2Client } from './lib/r2.mjs';
import { loadManifest, saveManifest, findImageSrcs, pendingSrcs, mirrorSrcs, rewriteHtml } from './lib/images.mjs';
import { writeMemeIndex } from './lib/memes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.resolve(__dirname, '..', 'emails');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const concurrency = Number((args.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1]) || 6;

async function main() {
  const manifest = await loadManifest(EMAILS_DIR);
  const files = (await readdir(EMAILS_DIR)).filter((f) => f.endsWith('.html')).sort();

  const issues = [];
  const allSrcs = new Set();
  for (const file of files) {
    const html = await readFile(path.join(EMAILS_DIR, file), 'utf-8');
    issues.push({ file, html });
    for (const src of findImageSrcs(html, manifest)) allSrcs.add(src);
  }

  const failedBefore = [...allSrcs].filter((s) => manifest[s] && !manifest[s].url).length;
  const pending = pendingSrcs([...allSrcs], manifest, { retryFailed: flag('retry-failed') });
  console.log(`${files.length} issue(s), ${allSrcs.size} unmirrored image URL(s) referenced; ` +
    `${pending.length} to mirror, ${failedBefore} failed before` +
    (flag('retry-failed') ? ' (retrying)' : ' (skipped; use --retry-failed)'));

  if (flag('dry-run')) {
    const byHost = {};
    for (const src of pending) {
      const host = new URL(src).host;
      byHost[host] = (byHost[host] || 0) + 1;
    }
    for (const [host, n] of Object.entries(byHost).sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${host}`);
    return;
  }

  if (!flag('rewrite-only') && pending.length) {
    const config = r2ConfigFromEnv();
    if (config.missing) throw new Error(`Missing environment: ${config.missing.join(', ')}`);
    const r2 = createR2Client(config);

    let counts;
    try {
      counts = await mirrorSrcs(pending, {
        manifest,
        r2,
        concurrency,
        onCheckpoint: () => saveManifest(manifest, EMAILS_DIR),
        onResult: (src, outcome, done, total) => {
          if (outcome === 'failed') console.log(`  ! ${src}: ${manifest[src].error}`);
          if (done % 100 === 0 || done === total) console.log(`  ${done}/${total}`);
        },
      });
    } finally {
      await saveManifest(manifest, EMAILS_DIR);
    }
    console.log(`Mirrored: ${counts.uploaded} uploaded, ${counts.existing} already in R2, ${counts.failed} failed.`);
  }

  let rewrittenFiles = 0;
  let rewrittenImgs = 0;
  for (const issue of issues) {
    const { html, count } = rewriteHtml(issue.html, manifest);
    if (count) {
      await writeFile(path.join(EMAILS_DIR, issue.file), html, 'utf-8');
      rewrittenFiles++;
      rewrittenImgs += count;
    }
  }
  console.log(`Rewrote ${rewrittenImgs} <img> src(s) in ${rewrittenFiles} issue(s).`);

  if (rewrittenFiles) {
    // memes.json stores image URLs, so it has to follow the rewrite.
    const data = JSON.parse(await readFile(path.join(EMAILS_DIR, 'data.json'), 'utf-8'));
    await writeMemeIndex(data, EMAILS_DIR);
    console.log('Rebuilt emails/memes.json.');
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
