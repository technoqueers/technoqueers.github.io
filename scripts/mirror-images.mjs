#!/usr/bin/env node
// Backs up every image the archived issues reference to Cloudflare R2 and
// rewrites the issues to load the R2 copies. Safe to rerun: anything already
// in emails/images.json is skipped, and anything already in the bucket isn't
// re-uploaded. See scripts/lib/images.mjs for the details and scripts/lib/r2.mjs
// for the R2_* environment variables.
//
//   node scripts/mirror-images.mjs                 mirror what's missing, then rewrite issues
//   node scripts/mirror-images.mjs --dry-run       report what would be mirrored (no R2 needed)
//   node scripts/mirror-images.mjs --retry-failed  also retry images that failed permanently (404s etc.)
//   node scripts/mirror-images.mjs --rewrite-only  only apply the manifest to the issues (no R2 needed)
//   node scripts/mirror-images.mjs --concurrency=8
//   node scripts/mirror-images.mjs --skip-if-unset  succeed with a warning if no R2_* var is set
//                                                   (the weekly workflow, before R2 is set up)
//
// Images that failed transiently (rate limits, 5xx, timeouts) are always retried.
// Changing R2_PUBLIC_BASE_URL and rerunning moves every issue to the new domain.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { r2ConfigFromEnv, createR2Client } from './lib/r2.mjs';
import { loadManifest, saveManifest, findImageSrcs, pendingSrcs, mirrorSrcs, rewriteHtml, rewriteHiddenMemes } from './lib/images.mjs';
import { writeMemeIndex } from './lib/memes.mjs';
import { warning, error } from './lib/annotate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.resolve(__dirname, '..', 'emails');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

function concurrencyArg() {
  const arg = args.find((a) => a.startsWith('--concurrency='));
  if (!arg) return 6;
  const n = Number(arg.split('=')[1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--concurrency must be a positive integer, got ${arg}`);
  return n;
}

async function main() {
  const concurrency = concurrencyArg();
  const manifest = await loadManifest(EMAILS_DIR);
  const files = (await readdir(EMAILS_DIR)).filter((f) => f.endsWith('.html')).sort();

  const issues = [];
  const allSrcs = new Set();
  for (const file of files) {
    const html = await readFile(path.join(EMAILS_DIR, file), 'utf-8');
    issues.push({ file, html });
    for (const src of findImageSrcs(html)) allSrcs.add(src);
  }

  const retryFailed = flag('retry-failed');
  const unmirrored = [...allSrcs].filter((s) => !manifest.images[s]?.key);
  const failedPermanently = unmirrored.filter((s) => manifest.images[s] && !manifest.images[s].transient).length;
  const pending = pendingSrcs(unmirrored, manifest, { retryFailed });
  console.log(`${files.length} issue(s), ${unmirrored.length} image URL(s) not yet backed up; ` +
    `${pending.length} to mirror, ${failedPermanently} failed permanently before` +
    (retryFailed ? ' (retrying)' : ' (skipped; use --retry-failed)'));

  if (flag('dry-run')) {
    const byHost = {};
    for (const src of pending) {
      const host = new URL(src).host;
      byHost[host] = (byHost[host] || 0) + 1;
    }
    for (const [host, n] of Object.entries(byHost).sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${host}`);
    return;
  }

  // An R2 error stops the uploads, but the issues are still pointed at every
  // copy made before it; the error is rethrown once that's done.
  let r2Error = null;

  if (!flag('rewrite-only')) {
    const config = r2ConfigFromEnv();
    if (config.problems && config.unset && flag('skip-if-unset')) {
      warning(`R2 isn't set up (no R2_* secrets), so ${pending.length} image(s) are not backed up. ` +
        'See scripts/lib/r2.mjs for the secrets to add.');
      return;
    }
    if (config.problems) throw new Error(`R2 settings: ${config.problems.join('; ')}`);
    const r2 = createR2Client(config);

    if (manifest.base && manifest.base !== r2.publicBaseUrl) {
      console.log(`Public base URL changed: ${manifest.base} -> ${r2.publicBaseUrl}; issues will be moved over.`);
    }
    manifest.base = r2.publicBaseUrl;

    let counts = { uploaded: 0, existing: 0, failed: 0 };
    try {
      if (pending.length) {
        counts = await mirrorSrcs(pending, {
          manifest,
          r2,
          concurrency,
          onCheckpoint: () => saveManifest(manifest, EMAILS_DIR),
          onResult: (src, outcome, done, total) => {
            if (outcome === 'failed') console.log(`  ! ${src}: ${manifest.images[src].error}`);
            if (done % 100 === 0 || done === total) console.log(`  ${done}/${total}`);
          },
        });
      }
    } catch (err) {
      r2Error = err;
    } finally {
      await saveManifest(manifest, EMAILS_DIR);
    }
    if (r2Error) console.log('Uploads stopped by an R2 error; pointing issues at the copies made so far.');
    else console.log(`Mirrored: ${counts.uploaded} uploaded, ${counts.existing} already in R2, ${counts.failed} failed.`);
    if (counts.failed) {
      warning(`${counts.failed} image(s) couldn't be downloaded and keep their original URLs; ` +
        'the log lists them. Temporary failures are retried on the next run.');
    }
  } else if (!manifest.base) {
    throw new Error('emails/images.json has no base URL yet; run without --rewrite-only first.');
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
  const movedHidden = await rewriteHiddenMemes(manifest, EMAILS_DIR);
  if (movedHidden) console.log(`Moved ${movedHidden} hidden meme(s) in emails/hidden-memes.json to their copies.`);

  if (r2Error) throw r2Error;
}

main().catch((err) => {
  error(`Image backup failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
