// Finds the meme(s) each issue ends with and writes emails/memes.json for
// memes.html and the random meme on the home page.
//
// An issue's memes are the images that come after its last piece of text and
// before the footer (Copyright / Unsubscribe). There's usually one, sometimes
// a few. Template images (section dividers, the footer graphic, social icons)
// are skipped: they're recognised by showing up in more than one issue.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest } from './images.mjs';

// Real issues are "the guide v.N" (one is typo'd "the guie"); test sends reuse
// the previous issue's images, so they'd make a meme look like a template.
const ISSUE_TITLE = /^the gui?de v\.(\d+)/i;

// Issues only started signing off with a meme at the July 2021 relaunch;
// before that, the trailing images are event flyers.
const FIRST_MEME_ISSUE = 219;

// Images seen in this many issues or more are part of the template.
const TEMPLATE_MIN_ISSUES = 2;

// Smaller than this is an icon, not a meme.
const MIN_WIDTH = 100;

// Images that sit where a meme would but aren't memes. Add a src here to drop it
// (either the original URL or its R2 copy; originals are matched via emails/images.json).
const NOT_MEMES = new Set([
  // v.363: the NYC Dyke March statement about 3 Dollar Bill (two slides)
  'https://gallery.eocampaign1.com/62a6a8da-856c-11ee-aacc-278c4c25eb7d%2Fmedia-manager%2F1717085930604-1.jpg',
  'https://gallery.eocampaign1.com/62a6a8da-856c-11ee-aacc-278c4c25eb7d%2Fmedia-manager%2F1717085938613-2.jpg',
]);

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

// Flattens an issue into images, link opens/closes and text runs, in order.
export function tokenize(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s>][\s\S]*?<\/head>/i, ' ')
    .replace(/<div id="archive-nav"[\s\S]*?<\/div>/i, ' ');
  const tokens = [];
  const re = /<img\b[^>]*>|<a\b[^>]*>|<\/a\s*>|<[^>]*>|[^<]+/gi;
  let m;
  while ((m = re.exec(body))) {
    const s = m[0];
    if (/^<img\b/i.test(s)) {
      tokens.push({ type: 'img', src: attr(s, 'src'), width: parseInt(attr(s, 'width'), 10) || 0 });
    } else if (/^<a\b/i.test(s)) {
      tokens.push({ type: 'a', href: attr(s, 'href').replace(/&amp;/g, '&') });
    } else if (/^<\/a/i.test(s)) {
      tokens.push({ type: '/a' });
    } else if (s[0] !== '<') {
      const text = s.replace(/&nbsp;|&#160;|‌/g, ' ').trim();
      if (text) tokens.push({ type: 'text', text });
    }
  }
  return tokens;
}

function isFooter(t) {
  return (t.type === 'text' && /^Copyright/i.test(t.text)) ||
         (t.type === 'a' && /UnsubscribeURL|\*\|UNSUB\|\*/i.test(t.href));
}

// Text that sits between the memes and the footer without ending the run: the
// "+" separators and the footer's own "Subscribe" link.
function isFiller(text) {
  return /^\+?\s*u?(subscribe)?\s*\+?$/i.test(text);
}

// Returns [{ src, href }] for the memes at the end of one issue, in order.
export function extractMemes(tokens, isTemplate) {
  let end = tokens.findIndex(isFooter);
  if (end === -1) end = tokens.length;

  const memes = [];
  for (let i = end - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.type === 'a' || t.type === '/a') continue;
    if (t.type === 'text') {
      if (isFiller(t.text)) continue;
      break;
    }
    if (!t.src || (t.width && t.width < MIN_WIDTH) || isTemplate(t.src)) continue;
    const prev = tokens[i - 1];
    memes.unshift({ src: t.src, href: prev && prev.type === 'a' ? prev.href : null });
  }
  return memes;
}

// Regenerates emails/memes.json: [{ file, title, date, memes: [{ src, href }] }],
// newest first, only issues that end with at least one meme.
export async function writeMemeIndex(entries, emailsDir) {
  const issues = [];
  for (const entry of entries) {
    const m = entry.title.match(ISSUE_TITLE);
    if (!m) continue;
    const html = await readFile(path.join(emailsDir, entry.file), 'utf-8');
    issues.push({ entry, number: Number(m[1]), tokens: tokenize(html) });
  }

  const seenIn = new Map();
  for (const { tokens } of issues) {
    const srcs = new Set(tokens.filter((t) => t.type === 'img').map((t) => t.src));
    for (const src of srcs) seenIn.set(src, (seenIn.get(src) || 0) + 1);
  }
  const isTemplate = (src) => seenIn.get(src) >= TEMPLATE_MIN_ISSUES;

  const manifest = await loadManifest(emailsDir);
  const notMemes = new Set(NOT_MEMES);
  for (const src of NOT_MEMES) if (manifest[src]?.url) notMemes.add(manifest[src].url);

  const index = [];
  for (const { entry, number, tokens } of issues) {
    if (number < FIRST_MEME_ISSUE) continue;
    const memes = extractMemes(tokens, isTemplate).filter((m) => !notMemes.has(m.src));
    if (memes.length) {
      index.push({ file: entry.file, title: entry.title, date: entry.date, memes });
    }
  }

  await writeFile(path.join(emailsDir, 'memes.json'), JSON.stringify(index), 'utf-8');
  return index;
}
