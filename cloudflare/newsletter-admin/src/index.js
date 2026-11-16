// Newsletter admin: a page where Tom picks the articles (from inside the
// issues) that belong in the archive's "best of" section, and hides memes he
// doesn't want on the site.
// Saving commits emails/best-of.json or emails/hidden-memes.json to the
// site's repo, and GitHub Pages republishes it.
//
// Login is Cloudflare Access (email one-time code) in front of this Worker.
// The Worker also checks the Access token itself and an email allowlist, so a
// misconfigured route can't expose the save endpoints.

import { ADMIN_HTML } from './page.js';

const DATA_PATH = 'emails/data.json';
const MEMES_PATH = 'emails/memes.json';
const PICKS_PATH = 'emails/best-of.json';
const HIDDEN_PATH = 'emails/hidden-memes.json';
const MAX_NOTE = 200;
const MAX_TITLE = 300;
const MAX_URL = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    let user;
    try {
      user = await verifyAccess(request, env);
    } catch (err) {
      return text(`Not signed in: ${err.message}`, 403);
    }

    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(ADMIN_HTML, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            // The page reads issue HTML and the search index straight from
            // the public site, which allows cross-origin reads.
            'content-security-policy':
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
              `img-src https:; connect-src 'self' ${new URL(env.SITE_URL).origin}; frame-ancestors 'none'`,
            'referrer-policy': 'no-referrer',
          },
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        return json(await loadState(env, user));
      }
      if (request.method === 'POST' && (url.pathname === '/api/save' || url.pathname === '/api/save-memes')) {
        if (request.headers.get('origin') !== url.origin) return text('Bad origin', 403);
        const body = await request.json().catch(() => null);
        return url.pathname === '/api/save' ? await savePicks(body, env) : await saveHidden(body, env);
      }
      return text('Not found', 404);
    } catch (err) {
      if (!err.status || err.status >= 500) console.error(err.stack || err.message);
      return json({ error: err.message }, err.status || 500);
    }
  },
};

/* ── State ── */

async function loadState(env, user) {
  const [data, memes, picksFile, hiddenFile] = await Promise.all([
    getFile(env, DATA_PATH),
    getFile(env, MEMES_PATH, { optional: true }),
    getFile(env, PICKS_PATH, { optional: true }),
    getFile(env, HIDDEN_PATH, { optional: true }),
  ]);
  // Issues are keyed by filename: older entries in data.json have no id.
  const issues = JSON.parse(data.content).map((c) => ({
    id: c.file,
    title: c.title,
    date: c.date,
    excerpt: cleanExcerpt(c.excerpt || ''),
    url: `${env.SITE_URL}/emails/${c.file}`,
  }));
  const memeList = [];
  for (const issue of memes ? JSON.parse(memes.content) : []) {
    for (const m of issue.memes) {
      memeList.push({ src: m.src, title: issue.title, date: issue.date, url: `${env.SITE_URL}/emails/${issue.file}` });
    }
  }
  return {
    user,
    siteUrl: env.SITE_URL,
    issues,
    memes: memeList,
    picks: picksFile ? parseList(picksFile.content).map(cleanPick).filter(Boolean) : [],
    hidden: hiddenFile ? parseList(hiddenFile.content).filter((src) => typeof src === 'string') : [],
    // Sent back on save so we never overwrite someone else's newer save.
    sha: picksFile ? picksFile.sha : null,
    hiddenSha: hiddenFile ? hiddenFile.sha : null,
  };
}

// A pick is one article inside one issue: { issue, url, title, note? },
// where issue is the issue's filename in emails/.
async function savePicks(body, env) {
  if (!body || !Array.isArray(body.picks)) return json({ error: 'Bad request' }, 400);

  const data = await getFile(env, DATA_PATH);
  const known = new Set(JSON.parse(data.content).map((c) => c.file));

  const seen = new Set();
  const picks = [];
  for (const raw of body.picks) {
    const p = cleanPick(raw);
    if (!p || !known.has(p.issue)) continue;
    const key = p.issue + ' ' + p.url;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(p);
  }

  const sha = await putFile(env, PICKS_PATH, picks, body.sha, `Update best-of picks (${picks.length})`, 'picks');
  return json({ ok: true, sha, count: picks.length });
}

// Returns a tidy pick, or null if it isn't one. Only http(s) links are
// allowed, since the archive turns them into links.
function cleanPick(p) {
  if (!p || typeof p.issue !== 'string' || typeof p.url !== 'string' || typeof p.title !== 'string') return null;
  const url = p.url.trim();
  const title = p.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (!/^https?:\/\//i.test(url) || url.length > MAX_URL || !title) return null;
  try { new URL(url); } catch { return null; }
  const note = typeof p.note === 'string' ? p.note.trim().slice(0, MAX_NOTE) : '';
  return note ? { issue: p.issue, url, title, note } : { issue: p.issue, url, title };
}

// Hidden memes are kept by image URL, which is stable across rebuilds of
// memes.json. Only URLs that are actually memes are accepted.
async function saveHidden(body, env) {
  if (!body || !Array.isArray(body.hidden)) return json({ error: 'Bad request' }, 400);

  const memes = await getFile(env, MEMES_PATH);
  const known = new Set(JSON.parse(memes.content).flatMap((issue) => issue.memes.map((m) => m.src)));
  const hidden = [...new Set(body.hidden.filter((src) => typeof src === 'string' && known.has(src)))];

  const sha = await putFile(env, HIDDEN_PATH, hidden, body.sha, `Update hidden memes (${hidden.length})`, 'hidden memes');
  return json({ ok: true, sha, count: hidden.length });
}

async function putFile(env, path, value, sha, message, what) {
  const res = await github(env, `contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      // Kept free of the editor's email: the repo is public.
      message,
      content: base64(JSON.stringify(value, null, 2) + '\n'),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw httpError(`The ${what} changed since this page loaded. Reload and try again.`, 409);
  }
  if (!res.ok) throw httpError(`GitHub save failed (${res.status})`, 502);
  return (await res.json()).content.sha;
}

// Excerpts open with the same header links in every issue and keep some
// HTML entities; drop both so each row shows what's actually in the issue.
function cleanExcerpt(excerpt) {
  return excerpt
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^(?:\s*\+?\s*(?:mixes of the week|anonymous feedback form|view this email in your browser)\s*\+?)+/i, '')
    .replace(/^[\s+]+/, '')
    .trim();
}

function parseList(content) {
  try {
    const list = JSON.parse(content);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* ── GitHub ── */

async function getFile(env, path, { optional = false } = {}) {
  const res = await github(env, `contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
  if (res.status === 404 && optional) return null;
  if (!res.ok) throw httpError(`GitHub read of ${path} failed (${res.status})`, 502);
  const meta = await res.json();

  // The contents API inlines files up to 1 MB; past that, fetch the blob.
  let b64 = meta.content;
  if (!b64 || meta.encoding !== 'base64') {
    const blob = await github(env, `git/blobs/${meta.sha}`);
    if (!blob.ok) throw httpError(`GitHub read of ${path} failed (${blob.status})`, 502);
    b64 = (await blob.json()).content;
  }
  return { sha: meta.sha, content: unbase64(b64) };
}

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'technoqueers-newsletter-admin',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

/* ── Cloudflare Access ── */

let certCache = { keys: null, at: 0 };

async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAILS) {
    throw new Error('admin is not configured yet');
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new Error('missing Access token');

  const [h, p, s] = token.split('.');
  if (!s) throw new Error('malformed token');
  const header = JSON.parse(b64urlText(h));
  const claims = JSON.parse(b64urlText(p));

  if (header.alg !== 'RS256') throw new Error('unexpected token algorithm');
  const key = await accessKey(env, header.kid);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new Error('bad token signature');

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error('token is for another app');
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error('token from another team');
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new Error('token expired');

  const email = String(claims.email || '').toLowerCase();
  const allowed = env.ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) throw new Error('this email is not allowed');
  return email;
}

async function accessKey(env, kid) {
  const fresh = Date.now() - certCache.at < 60 * 60 * 1000;
  if (!fresh || !certCache.keys?.some((k) => k.kid === kid)) {
    const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error('could not load Access keys');
    certCache = { keys: (await res.json()).keys, at: Date.now() };
  }
  const jwk = certCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('unknown token key');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/* ── Helpers ── */

function base64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function unbase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlText(s) {
  return new TextDecoder().decode(b64urlBytes(s));
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function text(body, status) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
