#!/usr/bin/env node
// Fetches the latest sent EmailOctopus campaign and, if it's not already in
// emails/data.json, adds it to the static archive (new HTML file + JSON entry).
// Requires EMAILOCTOPUS_API_KEY in the environment.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMAILS_DIR = path.join(ROOT, 'emails');
const DATA_JSON = path.join(EMAILS_DIR, 'data.json');
const API_BASE = process.env.EMAILOCTOPUS_API_BASE || 'https://api.emailoctopus.com';

const NAV_HTML = `\t\t<div id="archive-nav" style="background-color:#6e6e6e;padding:14px 20px;font-family:'Courier New',monospace;">
\t\t\t<a href="../archive.html" style="color:#ffffff;font-weight:700;font-size:17px;letter-spacing:0.5px;text-transform:uppercase;text-decoration:none;">technoqueers</a><span style="color:rgba(255,255,255,0.35);font-weight:700;font-size:17px;">&nbsp;/&nbsp;</span><span style="color:rgba(255,255,255,0.5);font-weight:700;font-size:17px;letter-spacing:0.5px;text-transform:uppercase;">archive</span>
\t\t</div>
`;

function apiKey() {
  const key = process.env.EMAILOCTOPUS_API_KEY;
  if (!key) {
    throw new Error('EMAILOCTOPUS_API_KEY is not set');
  }
  return key;
}

async function eoFetch(pathAndQuery) {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`EmailOctopus API ${pathAndQuery} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchLatestSentCampaign() {
  const list = await eoFetch('/campaigns?limit=10');
  const campaigns = (list.data || [])
    .filter((c) => c.status === 'SENT' && c.sent_at)
    .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  return campaigns[0] || null;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripTags(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function injectNav(html) {
  if (/id="archive-nav"/.test(html)) return html;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/(<body[^>]*>)/i, `$1\n${NAV_HTML}`);
  }
  return `<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n${NAV_HTML}${html}\n</body>\n</html>\n`;
}

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

  const full = await eoFetch(`/campaigns/${latest.id}`);
  const html = full.content?.html;
  if (!html) {
    throw new Error(`Campaign ${latest.id} has no content.html`);
  }

  const sentAt = new Date(full.sent_at);
  const date = sentAt.toISOString().slice(0, 10);
  const subject = full.subject || full.name || 'untitled';
  const file = `${full.id}_${slugify(subject)}.html`;
  const plainText = full.content?.plain_text || stripTags(html);
  const excerpt = plainText.replace(/\s+/g, ' ').trim().slice(0, 150);

  const entry = {
    title: subject,
    subject,
    date,
    year: sentAt.getUTCFullYear(),
    month: sentAt.getUTCMonth() + 1,
    monthName: MONTH_NAMES[sentAt.getUTCMonth()],
    week: isoWeek(sentAt),
    file,
    excerpt,
    id: full.id,
  };

  await writeFile(path.join(EMAILS_DIR, file), injectNav(html), 'utf-8');

  data.unshift(entry);
  await writeFile(DATA_JSON, JSON.stringify(data), 'utf-8');

  console.log(`Added newsletter: ${subject} (${date}) -> emails/${file}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
