// Shared EmailOctopus helpers used by sync-newsletter.mjs and backfill-newsletters.mjs.

export const API_BASE = process.env.EMAILOCTOPUS_API_BASE || 'https://api.emailoctopus.com';

export const NAV_HTML = `\t\t<div id="archive-nav" style="background-color:#6e6e6e;padding:14px 20px;font-family:'Courier New',monospace;">
\t\t\t<a href="../archive.html" style="color:#ffffff;font-weight:700;font-size:17px;letter-spacing:0.5px;text-transform:uppercase;text-decoration:none;">technoqueers</a><span style="color:rgba(255,255,255,0.35);font-weight:700;font-size:17px;">&nbsp;/&nbsp;</span><span style="color:rgba(255,255,255,0.5);font-weight:700;font-size:17px;letter-spacing:0.5px;text-transform:uppercase;">archive</span>
\t\t</div>
`;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function apiKey() {
  const key = process.env.EMAILOCTOPUS_API_KEY;
  if (!key) {
    throw new Error('EMAILOCTOPUS_API_KEY is not set');
  }
  return key;
}

export async function eoFetch(pathAndQuery) {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`EmailOctopus API ${pathAndQuery} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Walks every page of GET /campaigns and returns all SENT campaigns
// (summary objects only — no content.html yet), oldest first.
export async function fetchAllSentCampaigns() {
  const campaigns = [];
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const query = cursor ? `?limit=100&starting_after=${encodeURIComponent(cursor)}` : '?limit=100';
    const list = await eoFetch(`/campaigns${query}`);
    campaigns.push(...(list.data || []));

    const next = list.paging?.next;
    if (!next) break;
    cursor = typeof next === 'string'
      ? next
      : next.starting_after || new URL(next.url || next.href, API_BASE).searchParams.get('starting_after');
    if (!cursor) break;
  }
  return campaigns
    .filter((c) => c.status?.toUpperCase() === 'SENT' && c.sent_at)
    .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
}

export async function fetchLatestSentCampaign() {
  const all = await fetchAllSentCampaigns();
  return all[all.length - 1] || null;
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stripTags(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function injectNav(html) {
  if (/id="archive-nav"/.test(html)) return html;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/(<body[^>]*>)/i, `$1\n${NAV_HTML}`);
  }
  return `<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n${NAV_HTML}${html}\n</body>\n</html>\n`;
}

// Fetches full campaign content and builds the {entry, file, html} triple
// used for both the data.json entry and the on-disk HTML file.
export async function buildArchiveItem(campaignSummary) {
  const full = await eoFetch(`/campaigns/${campaignSummary.id}`);
  const html = full.content?.html;
  if (!html) {
    throw new Error(`Campaign ${full.id} has no content.html`);
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

  return { entry, file, html: injectNav(html) };
}
