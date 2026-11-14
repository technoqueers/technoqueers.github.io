// Mirrors the images newsletter issues reference into R2 and points the issues
// at the copies, so the archive doesn't depend on Mailchimp/EmailOctopus
// keeping old uploads around.
//
// emails/images.json is the manifest, keyed by original URL:
//   { "<original src>": { "url", "key", "type", "bytes" } }   mirrored
//   { "<original src>": { "error", "checkedAt" } }             couldn't be fetched
// Originals stay in the manifest, so every rewrite can be traced back (and undone).
//
// Each R2 key is derived from the original URL alone, so:
//  - reruns are idempotent: a URL in the manifest is skipped, and a URL whose
//    key is already in the bucket (e.g. after a lost manifest) is not re-uploaded;
//  - the mapping stays one-to-one, so lib/memes.mjs's "same src in 2+ issues
//    means template" rule gives the same answer before and after rewriting.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEY_PREFIX = 'newsletter';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const EXT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /(\bsrc=")([^"]+)(")/i;

export function manifestPath(emailsDir) {
  return path.join(emailsDir, 'images.json');
}

export async function loadManifest(emailsDir) {
  try {
    return JSON.parse(await readFile(manifestPath(emailsDir), 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveManifest(manifest, emailsDir) {
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  await writeFile(manifestPath(emailsDir), JSON.stringify(sorted, null, 1) + '\n', 'utf-8');
}

// The set of URLs that are already mirror copies, so they're never mirrored again.
function mirroredUrls(manifest) {
  return new Set(Object.values(manifest).map((m) => m.url).filter(Boolean));
}

// Every remote <img src> in an issue that still points at its original host.
export function findImageSrcs(html, manifest = {}) {
  const mirrored = mirroredUrls(manifest);
  const srcs = new Set();
  for (const tag of html.match(IMG_TAG) || []) {
    const m = tag.match(SRC_ATTR);
    if (m && /^https?:\/\//i.test(m[2]) && !mirrored.has(m[2])) srcs.add(m[2]);
  }
  return [...srcs];
}

// Swaps every mirrored <img src> for its R2 copy. Returns { html, count }.
export function rewriteHtml(html, manifest) {
  let count = 0;
  const out = html.replace(IMG_TAG, (tag) => tag.replace(SRC_ATTR, (m, pre, src, post) => {
    const url = manifest[src]?.url;
    if (!url) return m;
    count++;
    return pre + url + post;
  }));
  return { html: out, count };
}

function urlExt(src) {
  try {
    const last = decodeURIComponent(new URL(src).pathname).split('/').pop();
    const ext = path.extname(last).toLowerCase();
    return IMAGE_EXTS.has(ext) ? ext : '';
  } catch {
    return '';
  }
}

export function keyFor(src) {
  return `${KEY_PREFIX}/${createHash('sha256').update(src).digest('hex').slice(0, 32)}${urlExt(src)}`;
}

async function download(src, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(src, {
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
        headers: { 'user-agent': 'technoqueers-archive-image-mirror' },
      });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) {
        const ext = urlExt(src);
        // Some CDNs serve images as octet-stream; trust the extension then.
        if (ext && (!type || type === 'application/octet-stream' || type === 'binary/octet-stream')) {
          type = EXT_TYPES[ext];
        } else {
          throw new Error(`not an image (${type || 'no content-type'})`);
        }
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (!body.length) throw new Error('empty response');
      return { body, type };
    } catch (err) {
      const retryable = err.retry || err.name === 'TimeoutError' || err.name === 'TypeError';
      if (!retryable || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

// Mirrors one URL into R2 and records the result in the manifest.
async function mirrorOne(src, { manifest, r2 }) {
  const key = keyFor(src);
  const existing = await r2.head(key);
  if (existing) {
    manifest[src] = { url: r2.publicUrl(key), key, type: existing.contentType, bytes: existing.bytes };
    return 'existing';
  }
  try {
    const { body, type } = await download(src);
    await r2.put(key, body, type);
    manifest[src] = { url: r2.publicUrl(key), key, type, bytes: body.length };
    return 'uploaded';
  } catch (err) {
    // R2 failures abort the run; a dead source image is just recorded.
    if (/^R2 /.test(err.message)) throw err;
    manifest[src] = { error: err.message, checkedAt: new Date().toISOString() };
    return 'failed';
  }
}

// Works out which of `srcs` still need mirroring: anything not in the manifest,
// plus previously failed ones when retryFailed is set.
export function pendingSrcs(srcs, manifest, { retryFailed = false } = {}) {
  return srcs.filter((src) => {
    const m = manifest[src];
    if (!m) return true;
    return !m.url && retryFailed;
  });
}

// Mirrors `srcs` with limited concurrency. `onResult(src, outcome, done, total)`
// is called after each; `onCheckpoint()` every `checkpointEvery` results, so a
// long run can persist the manifest as it goes.
export async function mirrorSrcs(srcs, { manifest, r2, concurrency = 6, onResult, onCheckpoint, checkpointEvery = 50 }) {
  const counts = { uploaded: 0, existing: 0, failed: 0 };
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < srcs.length) {
      const src = srcs[next++];
      const outcome = await mirrorOne(src, { manifest, r2 });
      counts[outcome]++;
      done++;
      onResult?.(src, outcome, done, srcs.length);
      if (onCheckpoint && done % checkpointEvery === 0) await onCheckpoint();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, srcs.length) }, worker));
  return counts;
}

// For the sync/backfill scripts: mirrors a freshly fetched issue's images and
// returns its HTML pointing at the copies. If R2 isn't configured it warns and
// returns the HTML unchanged; scripts/mirror-images.mjs can catch it up later.
export async function mirrorIssueHtml(html, { manifest, r2 }) {
  if (!r2) return html;
  const pending = pendingSrcs(findImageSrcs(html, manifest), manifest);
  if (pending.length) {
    const counts = await mirrorSrcs(pending, { manifest, r2 });
    console.log(`  images: ${counts.uploaded} uploaded, ${counts.existing} already in R2, ${counts.failed} failed`);
  }
  return rewriteHtml(html, manifest).html;
}
