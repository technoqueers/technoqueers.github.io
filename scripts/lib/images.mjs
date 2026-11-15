// Mirrors the images newsletter issues reference into R2 and points the issues
// at the copies, so the archive doesn't depend on Mailchimp/EmailOctopus
// keeping old uploads around.
//
// emails/images.json is the manifest:
//   { "base": "<R2 public base URL>",
//     "images": {
//       "<original src>": { "key", "type", "bytes" }                  mirrored
//       "<original src>": { "error", "transient", "checkedAt" }       couldn't be fetched
//   } }
// A copy's URL is always `${base}/${key}`, so changing R2_PUBLIC_BASE_URL and
// rerunning mirror-images.mjs moves every issue to the new domain. Originals
// stay in the manifest, so every rewrite can be traced back (and undone).
//
// Each R2 key is derived from the original URL alone, so:
//  - reruns are idempotent: a URL in the manifest is skipped, and a URL whose
//    key is already in the bucket (e.g. after a lost manifest) is not re-uploaded;
//  - a copy is recognisable from its URL (…/newsletter/<32 hex>), so copies are
//    never mirrored again, even without the manifest;
//  - the mapping is one-to-one: canonicalSrc() gives an original and its copy
//    the same identity (no manifest needed), which lib/memes.mjs uses for
//    template detection and NOT_MEMES.

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const KEY_PREFIX = 'newsletter';
const MIRROR_KEY = /\/(newsletter\/[0-9a-f]{32}(?:\.[a-z0-9]+)?)$/;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const EXT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /(\bsrc=")([^"]+)(")/i;

/* ── Manifest ── */

export function manifestPath(emailsDir) {
  return path.join(emailsDir, 'images.json');
}

export async function loadManifest(emailsDir) {
  try {
    const m = JSON.parse(await readFile(manifestPath(emailsDir), 'utf-8'));
    return { base: m.base || null, images: m.images || {} };
  } catch (err) {
    if (err.code === 'ENOENT') return { base: null, images: {} };
    throw err;
  }
}

let tmpCounter = 0;

// Written to a temp file and renamed into place, so an interrupted run can't
// leave a truncated manifest behind.
export async function saveManifest(manifest, emailsDir) {
  const images = Object.fromEntries(Object.keys(manifest.images).sort().map((k) => [k, manifest.images[k]]));
  const target = manifestPath(emailsDir);
  const tmp = `${target}.${process.pid}.${tmpCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify({ base: manifest.base, images }, null, 1) + '\n', 'utf-8');
  await rename(tmp, target);
}

/* ── URLs ── */

// The R2 key if `src` is one of our copies, else null.
export function mirrorKeyOf(src) {
  try {
    const m = new URL(src).pathname.match(MIRROR_KEY);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// One identity per image whether `src` is the original or its copy: the R2
// key. Keys are a pure function of the original URL, so no manifest is needed.
export function canonicalSrc(src) {
  return mirrorKeyOf(src) || keyFor(src);
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

/* ── HTML ── */

// Every remote <img src> in an issue that isn't already an R2 copy.
export function findImageSrcs(html) {
  const srcs = new Set();
  for (const tag of html.match(IMG_TAG) || []) {
    const m = tag.match(SRC_ATTR);
    if (m && /^https?:\/\//i.test(m[2]) && !mirrorKeyOf(m[2])) srcs.add(m[2]);
  }
  return [...srcs];
}

// Points every mirrored <img src> at its copy under the manifest's base URL
// (also moving copies from an older base). Returns { html, count }.
export function rewriteHtml(html, manifest) {
  if (!manifest.base) return { html, count: 0 };
  let count = 0;
  const out = html.replace(IMG_TAG, (tag) => tag.replace(SRC_ATTR, (m, pre, src, post) => {
    const key = manifest.images[src]?.key || mirrorKeyOf(src);
    if (!key) return m;
    const url = `${manifest.base}/${key}`;
    if (url === src) return m;
    count++;
    return pre + url + post;
  }));
  return { html: out, count };
}

/* ── Mirroring ── */

function sourceError(message, transient) {
  return Object.assign(new Error(message), { transient });
}

async function download(src, attempts = 3) {
  // src is an HTML attribute value; the only entity that shows up in URLs is &amp;.
  const url = src.replace(/&amp;/g, '&');
  for (let attempt = 1; ; attempt++) {
    try {
      let res;
      try {
        res = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(60_000),
          headers: { 'user-agent': 'technoqueers-archive-image-mirror' },
        });
      } catch (err) {
        throw sourceError(err.name === 'TimeoutError' ? 'timed out' : `network error: ${err.cause?.code || err.message}`, true);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw sourceError(`HTTP ${res.status}`, res.status === 429 || res.status >= 500);
      }

      let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) {
        const ext = urlExt(src);
        // Some CDNs serve images as octet-stream; trust the extension then.
        if (ext && (!type || type === 'application/octet-stream' || type === 'binary/octet-stream')) {
          type = EXT_TYPES[ext];
        } else {
          await res.body?.cancel();
          throw sourceError(`not an image (${type || 'no content-type'})`, false);
        }
      }
      let body;
      try {
        body = Buffer.from(await res.arrayBuffer());
      } catch (err) {
        // The timeout or a dropped connection mid-body: worth retrying later.
        throw sourceError(err.name === 'TimeoutError' ? 'timed out' : `network error: ${err.cause?.code || err.message}`, true);
      }
      if (!body.length) throw sourceError('empty response', true);
      return { body, type };
    } catch (err) {
      if (!err.transient || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

// Mirrors one URL into R2 and records the result in the manifest. A source
// that can't be fetched is recorded; any R2 problem throws.
async function mirrorOne(src, { manifest, r2 }) {
  const key = keyFor(src);
  const existing = await r2.head(key);
  if (existing) {
    manifest.images[src] = { key, type: existing.contentType, bytes: existing.bytes };
    return 'existing';
  }
  let got;
  try {
    got = await download(src);
  } catch (err) {
    manifest.images[src] = { error: err.message, transient: Boolean(err.transient), checkedAt: new Date().toISOString() };
    return 'failed';
  }
  await r2.put(key, got.body, got.type);
  manifest.images[src] = { key, type: got.type, bytes: got.body.length };
  return 'uploaded';
}

// Which of `srcs` still need mirroring: anything not in the manifest, anything
// that failed transiently (rate limits, 5xx, timeouts), and, with retryFailed,
// anything that failed permanently (404s and the like).
export function pendingSrcs(srcs, manifest, { retryFailed = false } = {}) {
  return srcs.filter((src) => {
    const m = manifest.images[src];
    if (!m) return true;
    if (m.key) return false;
    return m.transient || retryFailed;
  });
}

// Mirrors `srcs` with limited concurrency. `onResult(src, outcome, done, total)`
// is called after each; `onCheckpoint()` every `checkpointEvery` results, so a
// long run can persist the manifest as it goes. On an R2 error every worker
// stops before taking more work, and the error is rethrown once they've settled.
export async function mirrorSrcs(srcs, { manifest, r2, concurrency = 6, onResult, onCheckpoint, checkpointEvery = 50 }) {
  const counts = { uploaded: 0, existing: 0, failed: 0 };
  let next = 0;
  let done = 0;
  let abort = null;
  async function worker() {
    while (!abort && next < srcs.length) {
      const src = srcs[next++];
      let outcome;
      try {
        outcome = await mirrorOne(src, { manifest, r2 });
      } catch (err) {
        abort = abort || err;
        return;
      }
      counts[outcome]++;
      done++;
      onResult?.(src, outcome, done, srcs.length);
      if (onCheckpoint && done % checkpointEvery === 0) await onCheckpoint();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, srcs.length)) }, worker));
  if (abort) throw abort;
  return counts;
}

// For the sync/backfill scripts: mirrors a freshly fetched issue's images and
// returns its HTML pointing at the copies (including copies that already exist,
// e.g. template graphics). Never throws for image problems: archiving the issue
// matters more, and scripts/mirror-images.mjs can catch the images up later.
// With no R2 client it only applies what's already in the manifest.
export async function mirrorIssueHtml(html, { manifest, r2, emailsDir }) {
  if (r2) {
    const baseChanged = manifest.base !== r2.publicBaseUrl;
    manifest.base = r2.publicBaseUrl;
    const pending = pendingSrcs(findImageSrcs(html), manifest);
    if (pending.length) {
      try {
        const counts = await mirrorSrcs(pending, { manifest, r2 });
        console.log(`  images: ${counts.uploaded} uploaded, ${counts.existing} already in R2, ${counts.failed} failed`);
      } catch (err) {
        console.warn(`  images: R2 error (${err.message}); images not yet backed up keep their original URLs. ` +
          'Run scripts/mirror-images.mjs once R2 is working.');
      }
    }
    if (pending.length || baseChanged) await saveManifest(manifest, emailsDir);
  }
  return rewriteHtml(html, manifest).html;
}
