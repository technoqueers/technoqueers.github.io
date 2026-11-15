// The admin page Tom sees. Served by the Worker behind Cloudflare Access.
// String.raw keeps the regexes in the inline script readable; the page must
// not contain backticks or "${".

export const ADMIN_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Technoqueers Admin</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #6e6e6e; --fg: #fff; --muted: rgba(255,255,255,0.6);
    --line: rgba(0,0,0,0.15); --ink: #000; --picked: rgba(255,255,255,0.12);
  }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: Univers, "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 16px 120px; }
  h1 {
    font-size: 17px; letter-spacing: 0.5px; text-transform: uppercase;
    margin: 0 0 20px;
  }
  h2 {
    font-size: 15px; letter-spacing: 0.5px; text-transform: uppercase;
    margin: 28px 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--ink);
  }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .tab {
    padding: 8px 18px; border: 1px solid var(--ink); border-radius: 20px;
    background: transparent; color: var(--ink); font: inherit; font-weight: 700;
    font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer;
  }
  .tab[aria-selected="true"] { background: #fff; border-color: #fff; }
  .tab .dot { color: #b00; margin-left: 4px; }
  .help { color: var(--muted); font-size: 14px; line-height: 20px; margin: 0 0 8px; max-width: 680px; }
  .tools { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
  .search {
    flex: 1 1 220px; height: 40px; padding: 0 18px; border: 1px solid var(--ink);
    border-radius: 20px; background: transparent; color: var(--ink);
    font: inherit; font-size: 15px; outline: none;
  }
  .search::placeholder { color: rgba(0,0,0,0.45); }
  .search:focus { border-width: 2px; padding: 0 17px; }
  .toggle { display: flex; gap: 6px; align-items: center; font-size: 14px; cursor: pointer; }
  .toggle input { width: 18px; height: 18px; accent-color: #000; }
  .filter {
    height: 40px; padding: 0 12px; border: 1px solid var(--ink); border-radius: 20px;
    background: transparent; color: var(--ink); font: inherit; font-size: 14px;
  }
  .date { color: var(--muted); font-size: 13px; }
  .view { color: var(--fg); font-size: 13px; text-decoration: underline; }
  .view:hover { color: var(--ink); }
  .search-note { color: var(--muted); font-size: 13px; margin: -6px 0 10px; min-height: 16px; }

  /* Heart button: picks and unpicks an article */
  .heart {
    flex: 0 0 36px; width: 36px; height: 36px; border: 1px solid var(--ink); border-radius: 50%;
    background: transparent; color: var(--ink); font-size: 17px; line-height: 1; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; padding: 0;
  }
  .heart:hover { background: rgba(0,0,0,0.1); }
  .heart[aria-pressed="true"] { background: #000; color: #fff; }

  /* Your picks */
  .pick {
    display: grid; grid-template-columns: 36px 1fr; gap: 6px 12px;
    padding: 12px 8px; border-bottom: 1px solid var(--line); background: var(--picked); border-radius: 6px;
    margin-bottom: 6px;
  }
  .pick-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .pick-meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; font-size: 13px; }
  .pick-meta b { text-transform: uppercase; letter-spacing: 0.5px; }
  .field {
    width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--ink); border-radius: 8px;
    background: rgba(255,255,255,0.9); color: #000; font: inherit; font-size: 14px;
  }
  .field.title-field { font-weight: 700; }
  .field-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }

  /* Issues and their articles */
  .issue { border-bottom: 1px solid var(--line); }
  .issue-head {
    display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; width: 100%;
    padding: 12px 8px; background: transparent; border: 0; color: var(--fg); font: inherit;
    text-align: left; cursor: pointer; border-radius: 6px;
  }
  .issue-head:hover { background: rgba(0,0,0,0.08); }
  .issue-title { font-weight: 700; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
  .issue-count { font-size: 13px; font-weight: 700; }
  .issue-open { margin-left: auto; font-size: 13px; text-decoration: underline; }
  .issue-snippet { flex-basis: 100%; color: #e8e8e8; font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
  .articles { padding: 0 8px 14px 8px; }
  .article { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px solid rgba(0,0,0,0.08); }
  .article-body { min-width: 0; }
  .article-title { font-weight: 700; font-size: 15px; line-height: 20px; color: var(--fg); text-decoration: none; overflow-wrap: anywhere; }
  .article-title:hover { color: var(--ink); text-decoration: underline; }
  .article-context { color: #e8e8e8; font-size: 13px; line-height: 18px; margin-top: 2px; overflow-wrap: anywhere; }
  .article.is-event .article-title { font-weight: 400; }
  .tag {
    display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 8px; vertical-align: 1px;
    background: rgba(0,0,0,0.25); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .articles-note { color: var(--muted); font-size: 13px; padding: 10px 0 0; }
  .linkish {
    background: none; border: 0; padding: 0; color: var(--fg); font: inherit; font-size: 13px;
    text-decoration: underline; cursor: pointer;
  }

  /* Memes */
  .meme-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;
  }
  .meme { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .meme-frame {
    position: relative; aspect-ratio: 1; background: rgba(0,0,0,0.18); border-radius: 6px;
    overflow: hidden; display: flex; align-items: center; justify-content: center;
  }
  .meme-frame img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .meme.is-hidden .meme-frame img { opacity: 0.25; filter: grayscale(1); }
  .badge {
    position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 10px;
    background: #000; color: #fff; font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .broken { color: var(--muted); font-size: 13px; padding: 12px; text-align: center; }
  .meme-meta { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
  .meme-meta b { text-transform: uppercase; letter-spacing: 0.5px; }
  .hide-btn {
    padding: 8px 0; border: 1px solid var(--ink); border-radius: 18px; background: transparent;
    color: var(--ink); font: inherit; font-weight: 700; font-size: 13px;
    text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer;
  }
  .hide-btn:hover { background: rgba(0,0,0,0.1); }
  .meme.is-hidden .hide-btn { background: #fff; border-color: #fff; }

  .more {
    display: block; margin: 20px auto 0; padding: 10px 20px; border: 1px solid var(--ink);
    border-radius: 20px; background: transparent; font: inherit; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; color: var(--ink);
  }
  .empty, .loading { color: var(--muted); padding: 16px 0; font-size: 15px; }
  .bar {
    position: fixed; left: 0; right: 0; bottom: 0; background: #000; color: #fff;
    padding: 12px 16px; display: flex; justify-content: center;
  }
  .bar-inner {
    width: 100%; max-width: 960px; display: flex; gap: 12px; align-items: center;
    justify-content: space-between; flex-wrap: wrap;
  }
  .status { font-size: 14px; line-height: 20px; }
  .status.error { color: #ffb3b3; }
  .save {
    padding: 10px 28px; border: 0; border-radius: 20px; background: #fff; color: #000;
    font: inherit; font-weight: 700; font-size: 15px; text-transform: uppercase;
    letter-spacing: 0.5px; cursor: pointer;
  }
  .save:disabled { opacity: 0.4; cursor: default; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>technoqueers admin</h1>

  <div class="tabs" role="tablist">
    <button class="tab" role="tab" id="tab-best" aria-controls="panel-best" aria-selected="true">&#9829;&#65038; Best of</button>
    <button class="tab" role="tab" id="tab-memes" aria-controls="panel-memes" aria-selected="false">Memes</button>
  </div>

  <section id="panel-best" role="tabpanel" aria-labelledby="tab-best">
    <p class="help">Pick the articles from the guide that belong in the "best of" section of the
      archive. Find an issue below, open it, and click &#9829;&#65038; next to an article. You can tidy
      its title and add a short note to say why.<span class="who"></span></p>

    <h2 id="picks-title">Your picks</h2>
    <div id="picks"><div class="loading">Loading…</div></div>

    <h2>Find an article</h2>
    <div class="tools">
      <input class="search" id="search" type="search" placeholder="Search every issue (article, artist, venue…)" autocomplete="off">
      <label class="toggle"><input type="checkbox" id="show-events"> Show event listings too</label>
    </div>
    <div class="search-note" id="search-note" aria-live="polite"></div>
    <div id="list"><div class="loading">Loading issues…</div></div>
  </section>

  <section id="panel-memes" role="tabpanel" aria-labelledby="tab-memes" hidden>
    <p class="help">These are the memes from the end of each issue, shown on the memes page
      and at random on the archive. Click <b>Hide</b> to take one off the site, or
      <b>Unhide</b> to bring it back. Hiding doesn't change the original issue email.</p>
    <div class="tools">
      <input class="search" id="meme-search" type="search" placeholder="Find by issue number or date" autocomplete="off">
      <select class="filter" id="meme-filter" aria-label="Which memes to show">
        <option value="all">All memes</option>
        <option value="shown">On the site</option>
        <option value="hidden">Hidden</option>
      </select>
    </div>
    <div id="meme-list"><div class="loading">Loading memes…</div></div>
  </section>
</div>

<div class="bar">
  <div class="bar-inner">
    <span class="status" id="status" aria-live="polite"></span>
    <button class="save" id="save" disabled>Save</button>
  </div>
</div>

<script>
(function () {
  var HEART = '♥︎';
  var PAGE = 40;
  var MEME_PAGE = 48;
  var siteUrl = '';
  var issues = [];
  var issueById = new Map();
  var memes = [];
  var picks = [];          // [{ issue, url, title, note }]
  var hidden = new Set();  // meme image URLs
  var savedPicks = '', savedHidden = '';
  var sha = null, hiddenSha = null;
  var shown = PAGE, memesShown = MEME_PAGE;
  var saving = false;
  var openIssues = new Set();
  var articleCache = new Map(); // issue id -> { state: 'loading'|'ready'|'failed', articles }
  var searchIndex = null, searchState = 'idle';

  var $ = function (id) { return document.getElementById(id); };

  fetch('/api/state', { credentials: 'same-origin' })
    .then(readJson)
    .then(function (state) {
      siteUrl = state.siteUrl;
      issues = state.issues;
      issues.forEach(function (c) { issueById.set(c.id, c); });
      memes = state.memes;
      sha = state.sha;
      hiddenSha = state.hiddenSha;
      picks = state.picks.filter(function (p) { return issueById.has(p.issue); })
        .map(function (p) { return { issue: p.issue, url: p.url, title: p.title, note: p.note || '' }; });
      state.hidden.forEach(function (src) { hidden.add(src); });
      savedPicks = serializePicks();
      savedHidden = serializeHidden();
      if (state.user) {
        document.querySelectorAll('.who').forEach(function (el) { el.textContent = ' Signed in as ' + state.user + '.'; });
      }
      renderPicks();
      render();
      renderMemes();
      updateBar();
    })
    .catch(function (err) {
      $('picks').innerHTML = '';
      $('list').innerHTML = '';
      $('meme-list').innerHTML = '';
      setStatus('Could not load: ' + err.message, true);
    });

  // When the login has expired, Access answers with a login page, not JSON.
  function readJson(r) {
    var type = r.headers.get('content-type') || '';
    if (type.indexOf('application/json') === -1) {
      throw new Error('your login may have expired. Reload the page to sign in again.');
    }
    return r.json().then(function (body) {
      if (!r.ok) throw new Error(body.error || ('error ' + r.status));
      return body;
    });
  }

  /* ── Tabs ── */

  function selectTab(name) {
    var memesTab = name === 'memes';
    $('tab-best').setAttribute('aria-selected', String(!memesTab));
    $('tab-memes').setAttribute('aria-selected', String(memesTab));
    $('panel-best').hidden = memesTab;
    $('panel-memes').hidden = !memesTab;
    try { history.replaceState(null, '', memesTab ? '#memes' : '#best-of'); } catch (e) {}
  }
  $('tab-best').onclick = function () { selectTab('best'); };
  $('tab-memes').onclick = function () { selectTab('memes'); };
  if (location.hash === '#memes') selectTab('memes');

  /* ── Dirty tracking ── */

  function serializePicks() {
    return JSON.stringify(picks.map(function (p) {
      return [p.issue, p.url, p.title.trim(), p.note.trim()];
    }).sort());
  }
  function serializeHidden() { return JSON.stringify(Array.from(hidden).sort()); }
  function picksDirty() { return serializePicks() !== savedPicks; }
  function hiddenDirty() { return serializeHidden() !== savedHidden; }

  /* ── Picks ── */

  function findPick(issueId, url) {
    for (var i = 0; i < picks.length; i++) {
      if (picks[i].issue === issueId && picks[i].url === url) return i;
    }
    return -1;
  }

  function togglePick(issueId, article) {
    var i = findPick(issueId, article.url);
    if (i === -1) picks.push({ issue: issueId, url: article.url, title: article.title, note: '' });
    else picks.splice(i, 1);
    renderPicks();
    updateBar();
  }

  // Newest issue first, then in the order Tom picked them.
  function sortedPicks() {
    return picks.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
      var da = issueById.get(a.p.issue).date, db = issueById.get(b.p.issue).date;
      return da < db ? 1 : da > db ? -1 : a.i - b.i;
    }).map(function (x) { return x.p; });
  }

  function renderPicks() {
    var box = $('picks');
    box.textContent = '';
    $('picks-title').textContent = 'Your picks (' + picks.length + ')';
    if (!picks.length) {
      box.appendChild(el('div', 'empty', 'No picks yet. Open an issue below and click ' + HEART + ' next to an article.'));
      return;
    }
    sortedPicks().forEach(function (p) { box.appendChild(pickCard(p)); });
  }

  function pickCard(p) {
    var issue = issueById.get(p.issue);
    var card = el('div', 'pick');
    var btn = heartButton(true, 'Remove from best of: ' + p.title);
    btn.onclick = function () {
      togglePick(p.issue, p);
      refreshIssue(p.issue);
    };

    var body = el('div', 'pick-body');
    var title = el('input', 'field title-field');
    title.type = 'text';
    title.maxLength = 300;
    title.value = p.title;
    title.setAttribute('aria-label', 'Title shown on the site');
    title.oninput = function () { p.title = title.value; updateBar(); };

    var meta = el('div', 'pick-meta');
    meta.append(el('b', '', 'from ' + issue.title), el('span', 'date', issue.date),
      link(issue.url, 'view issue'), link(p.url, 'open article'));

    var note = el('input', 'field');
    note.type = 'text';
    note.maxLength = 200;
    note.placeholder = 'Optional note shown on the site';
    note.value = p.note;
    note.setAttribute('aria-label', 'Note for ' + p.title);
    note.oninput = function () { p.note = note.value; updateBar(); };

    body.append(title, meta, note);
    card.append(btn, body);
    return card;
  }

  /* ── Search ── */

  // Full text of every issue, from the public site. Loaded on first search;
  // until then (or if it fails) search uses titles and excerpts.
  function loadSearchIndex() {
    if (searchState !== 'idle') return;
    searchState = 'loading';
    fetch(siteUrl + '/emails/search.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (index) { searchIndex = index; searchState = 'ready'; render(); })
      .catch(function () { searchState = 'failed'; render(); });
  }

  // Lowercase, no accents, punctuation as spaces; same length as the input.
  function fold(s) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, function (ch) {
      var base = ch.normalize('NFD').charAt(0);
      return /[\p{L}\p{N}]/u.test(base) ? base : ' ';
    });
  }

  function queryWords() {
    return fold($('search').value).split(/\s+/).filter(Boolean);
  }

  function issueText(c) {
    var file = c.url.slice(c.url.lastIndexOf('/') + 1);
    return searchIndex && searchIndex[file] ? searchIndex[file] : c.excerpt;
  }

  function folded(c) {
    if (searchIndex && c._folded === undefined) c._folded = fold(c.title + ' ' + c.date + ' ' + issueText(c));
    return searchIndex ? c._folded : fold(c.title + ' ' + c.date + ' ' + c.excerpt);
  }

  function snippet(c, words) {
    var body = folded(c), text = c.title + ' ' + c.date + ' ' + issueText(c);
    var pos = -1, len = 0;
    for (var i = 0; pos === -1 && i < words.length; i++) { pos = body.indexOf(words[i]); len = words[i].length; }
    if (pos === -1) return c.excerpt;
    var start = Math.max(0, pos - 60), end = Math.min(text.length, pos + len + 100);
    return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
  }

  /* ── Issue list ── */

  function render() {
    var words = queryWords();
    if (words.length) loadSearchIndex();
    var items = words.length
      ? issues.filter(function (c) { var f = folded(c); return words.every(function (w) { return f.indexOf(w) !== -1; }); })
      : issues;

    $('search-note').textContent = !words.length ? '' :
      items.length + ' issue' + (items.length === 1 ? '' : 's') + ' mention this' +
      (searchState === 'loading' ? ' (searching full text…)' :
       searchState === 'failed' ? ' (titles only: full text failed to load)' : '') +
      (items.length ? '. Open one to see its articles.' : '');

    var list = $('list');
    list.textContent = '';
    if (!items.length) {
      list.appendChild(el('div', 'empty', words.length ? 'No issues match.' : 'No issues.'));
      return;
    }
    items.slice(0, shown).forEach(function (c) { list.appendChild(issueRow(c, words)); });
    if (items.length > shown) {
      list.appendChild(moreButton(items.length - shown, function () { shown += PAGE * 3; render(); }));
    }
  }

  function picksIn(issueId) {
    return picks.filter(function (p) { return p.issue === issueId; }).length;
  }

  function issueRow(c, words) {
    var row = el('div', 'issue');
    row.id = 'issue-' + c.id;
    var isOpen = openIssues.has(c.id);
    var head = el('button', 'issue-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(isOpen));
    var n = picksIn(c.id);
    head.append(el('span', 'issue-title', c.title), el('span', 'date', c.date));
    if (n) head.appendChild(el('span', 'issue-count', HEART + ' ' + n));
    head.appendChild(el('span', 'issue-open', isOpen ? 'close' : 'open'));
    var snip = words && words.length ? snippet(c, words) : c.excerpt;
    if (snip && !isOpen) head.appendChild(el('span', 'issue-snippet', snip));
    head.onclick = function () {
      if (openIssues.has(c.id)) openIssues.delete(c.id); else openIssues.add(c.id);
      refreshIssue(c.id, true);
    };
    row.appendChild(head);
    if (isOpen) row.appendChild(articleList(c, words || queryWords()));
    return row;
  }

  // Redraws one issue row in place (keeps the scroll position and the rest of the list).
  function refreshIssue(issueId, focusHead) {
    var old = document.getElementById('issue-' + issueId);
    if (!old) return;
    var fresh = issueRow(issueById.get(issueId), queryWords());
    old.replaceWith(fresh);
    if (focusHead) fresh.querySelector('.issue-head').focus();
  }

  /* ── Articles inside an issue ── */

  function articleList(c, words) {
    var box = el('div', 'articles');
    var cached = articleCache.get(c.id);
    if (!cached) {
      articleCache.set(c.id, { state: 'loading' });
      fetch(c.url)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) { articleCache.set(c.id, { state: 'ready', articles: extractArticles(html) }); })
        .catch(function () { articleCache.set(c.id, { state: 'failed' }); })
        .then(function () { refreshIssue(c.id); });
      cached = articleCache.get(c.id);
    }
    if (cached.state === 'loading') { box.appendChild(el('div', 'loading', 'Loading articles…')); return box; }
    if (cached.state === 'failed') {
      box.appendChild(el('div', 'empty', 'Could not load this issue. Try again in a moment.'));
      articleCache.delete(c.id);
      return box;
    }

    var showEvents = $('show-events').checked;
    var all = cached.articles;
    var visible = all.filter(function (a) { return showEvents || !a.isEvent; });
    var events = all.length - all.filter(function (a) { return !a.isEvent; }).length;

    // While searching, put the articles that match first.
    if (words.length) {
      var hits = visible.filter(function (a) {
        var f = fold(a.title + ' ' + a.context);
        return words.every(function (w) { return f.indexOf(w) !== -1; });
      });
      if (hits.length) visible = hits.concat(visible.filter(function (a) { return hits.indexOf(a) === -1; }));
    }

    if (!visible.length) {
      box.appendChild(el('div', 'empty', all.length ? 'Only event listings in this issue.' : 'No links found in this issue.'));
    }
    visible.forEach(function (a) { box.appendChild(articleRow(c, a)); });
    if (!showEvents && events) {
      var note = el('div', 'articles-note', events + ' event listing' + (events === 1 ? '' : 's') + ' hidden. ');
      var btn = el('button', 'linkish', 'Show them');
      btn.type = 'button';
      btn.onclick = function () { $('show-events').checked = true; render(); };
      note.appendChild(btn);
      box.appendChild(note);
    }
    return box;
  }

  function articleRow(c, a) {
    var picked = findPick(c.id, a.url) !== -1;
    var row = el('div', 'article' + (a.isEvent ? ' is-event' : ''));
    var btn = heartButton(picked, (picked ? 'Remove from' : 'Add to') + ' best of: ' + a.title);
    btn.onclick = function () {
      togglePick(c.id, a);
      var fresh = articleRow(c, a);
      row.replaceWith(fresh);
      fresh.querySelector('.heart').focus();
      var head = document.querySelector('#issue-' + CSS.escape(c.id) + ' .issue-head');
      if (head) {
        var count = head.querySelector('.issue-count');
        var n = picksIn(c.id);
        if (!n && count) count.remove();
        else if (n) {
          if (!count) { count = el('span', 'issue-count'); head.insertBefore(count, head.querySelector('.issue-open')); }
          count.textContent = HEART + ' ' + n;
        }
      }
    };
    var body = el('div', 'article-body');
    var t = link(a.url, a.title);
    t.className = 'article-title';
    body.appendChild(t);
    if (a.isEvent) t.appendChild(el('span', 'tag', 'event'));
    if (a.context && a.context !== a.title) body.appendChild(el('div', 'article-context', a.context));
    row.append(btn, body);
    return row;
  }

  // Pulls the links out of an issue's HTML, with the line of text each sits
  // in. Issues have been laid out differently over the years, so this stays
  // generic: every outbound link with real text is a candidate, and Tom
  // decides. Event listings (a time range like [10p-4a], or a ticketing
  // site) are flagged so they can be tucked away.
  var SKIP_TEXT = /^(\+\s*)?(subscribe|unsubscribe|donate|view (this email|in browser)|mixes of the week|anonymous feedback form|designed? by|composite|update (your )?preferences|forward to a friend)\b/i;
  var SKIP_HREF = /(eocampaign|list-manage\.com|mailchimp\.com|\*\||\{\{|eomail|emailoctopus\.com|technoqueers\.com)/i;
  var EVENT_HOSTS = /(^|\.)(funqtion\.app|dice\.fm|eventbrite\.[a-z.]+|partiful\.com|posh\.vip|ticketfairy\.com|shotgun\.live|withfriends\.co|seetickets\.[a-z.]+|venuepilot\.co|tixr\.com|ticketweb\.com|universe\.com|ticketleap\.com|link\.dice\.fm)$/i;
  var EVENT_PATH = /(ra\.co|residentadvisor\.net)\/events\//i;
  var TIME_RANGE = /\[\s*(?:[a-z]{3},?\s*)?\d{1,2}(?::\d{2})?\s*(?:[ap]m?)?\s*[-–]\s*(?:\d{1,2}(?::\d{2})?\s*(?:[ap]m?)?|\?|close)\s*\]/i;

  function extractArticles(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, #archive-nav').forEach(function (n) { n.remove(); });
    var out = [], seen = new Set();
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var href = (a.getAttribute('href') || '').trim();
      if (!/^https?:\/\//i.test(href) || SKIP_HREF.test(href) || seen.has(href)) return;
      var title = tidy(a.textContent);
      if (title.length < 4 || SKIP_TEXT.test(title) || /^\+.*\+$/.test(title)) return;
      var context = lineAround(a, title);
      var host = '';
      try { host = new URL(href).hostname; } catch (e) { return; }
      seen.add(href);
      out.push({
        url: href,
        title: title.replace(/^\+\s*/, ''),
        context: context,
        isEvent: TIME_RANGE.test(context) || EVENT_HOSTS.test(host) || EVENT_PATH.test(href),
      });
    });
    return out;
  }

  function tidy(s) { return s.replace(/[\s ‌]+/g, ' ').trim(); }

  // The line of text the link sits in: its block, split at <br>s. When the
  // line is only the title (older issues put "By author" and a quote on the
  // next lines), the next line is added.
  function lineAround(a, title) {
    var block = a.closest('p, li, td, div') || a.parentNode;
    var MARK = '\u0001';
    var clone = block.cloneNode(true);
    var path = [], n = a;
    while (n && n !== block) { path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n)); n = n.parentNode; }
    var target = clone;
    path.forEach(function (i) { target = target.childNodes[i]; });
    if (!target) return '';
    target.replaceWith(clone.ownerDocument.createTextNode(MARK));
    clone.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
    clone.querySelectorAll('p, div, li, tr').forEach(function (b) { b.append('\n'); });
    var lines = clone.textContent.split('\n').map(tidy).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(MARK) === -1) continue;
      var line = lines[i].replace(MARK, title);
      if (tidy(line.replace(/^\+/, '')) === title && lines[i + 1]) line += ' ' + lines[i + 1].replace(MARK, title);
      // The title is already shown above the line; drop it from the start.
      line = tidy(line.replace(/^\+?\s*/, '').replace(title, function (t, at) { return at === 0 ? '' : t; }));
      return line.length > 320 ? line.slice(0, 320) + '…' : line;
    }
    return '';
  }

  /* ── Memes ── */

  function renderMemes() {
    var words = $('meme-search').value.toLowerCase().split(/\s+/).filter(Boolean);
    var filter = $('meme-filter').value;
    var items = memes.filter(function (m) {
      if (filter === 'hidden' && !hidden.has(m.src)) return false;
      if (filter === 'shown' && hidden.has(m.src)) return false;
      var hay = (m.title + ' ' + m.date).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });

    var list = $('meme-list');
    list.textContent = '';
    if (!items.length) {
      list.appendChild(el('div', 'empty', filter === 'hidden' && !words.length ? 'No hidden memes.' : 'No memes match.'));
      return;
    }
    var grid = el('div', 'meme-grid');
    items.slice(0, memesShown).forEach(function (m) { grid.appendChild(memeCard(m)); });
    list.appendChild(grid);
    if (items.length > memesShown) {
      list.appendChild(moreButton(items.length - memesShown, function () { memesShown += MEME_PAGE * 2; renderMemes(); }));
    }
  }

  function memeCard(m) {
    var isHidden = hidden.has(m.src);
    var fig = el('figure', 'meme' + (isHidden ? ' is-hidden' : ''));
    var frame = el('div', 'meme-frame');
    var img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.alt = 'Meme from ' + m.title;
    img.onerror = function () {
      img.replaceWith(el('div', 'broken', 'Image no longer available (the site already skips it)'));
    };
    img.src = m.src;
    frame.appendChild(img);
    if (isHidden) frame.appendChild(el('span', 'badge', 'hidden'));

    var meta = el('figcaption', 'meme-meta');
    meta.append(el('b', '', m.title), el('span', 'date', m.date), link(m.url, 'view issue'));

    var btn = el('button', 'hide-btn', isHidden ? 'Unhide' : 'Hide');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(isHidden));
    btn.setAttribute('aria-label', (isHidden ? 'Unhide' : 'Hide') + ' meme from ' + m.title);
    btn.onclick = function () {
      if (hidden.has(m.src)) hidden.delete(m.src);
      else hidden.add(m.src);
      var fresh = memeCard(m);
      fig.replaceWith(fresh);
      fresh.querySelector('.hide-btn').focus();
      updateBar();
    };

    fig.append(frame, meta, btn);
    return fig;
  }

  /* ── Shared ── */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(url, text) {
    var a = el('a', 'view', text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function heartButton(pressed, label) {
    var b = el('button', 'heart', HEART);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pressed));
    b.setAttribute('aria-label', label);
    b.title = pressed ? 'Remove from best of' : 'Add to best of';
    return b;
  }

  function moreButton(left, onclick) {
    var more = el('button', 'more', 'Show more (' + left + ' left)');
    more.onclick = onclick;
    return more;
  }

  function setStatus(msg, isError) {
    $('status').textContent = msg;
    $('status').className = 'status' + (isError ? ' error' : '');
  }

  function summary() {
    var n = picks.length, h = hidden.size;
    return n + ' article' + (n === 1 ? '' : 's') + ' picked · ' + h + ' meme' + (h === 1 ? '' : 's') + ' hidden';
  }

  function updateBar() {
    var pd = picksDirty(), hd = hiddenDirty();
    $('tab-best').innerHTML = '&#9829;&#65038; Best of' + (pd ? '<span class="dot" aria-label="unsaved">•</span>' : '');
    $('tab-memes').innerHTML = 'Memes' + (hd ? '<span class="dot" aria-label="unsaved">•</span>' : '');
    $('save').disabled = saving || !(pd || hd);
    if (!saving) setStatus(summary() + ((pd || hd) ? ' · unsaved changes' : ' · all saved'));
  }

  var searchTimer;
  $('search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { shown = PAGE; render(); }, 150);
  });
  $('show-events').addEventListener('change', function () { render(); });
  $('meme-search').addEventListener('input', function () { memesShown = MEME_PAGE; renderMemes(); });
  $('meme-filter').addEventListener('change', function () { memesShown = MEME_PAGE; renderMemes(); });

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(readJson);
  }

  // Saves whichever of the two lists changed. Each is its own small commit.
  $('save').addEventListener('click', function () {
    var empty = picks.filter(function (p) { return !p.title.trim(); });
    if (empty.length) { setStatus('Every pick needs a title before saving.', true); return; }
    saving = true;
    $('save').disabled = true;
    setStatus('Saving…');
    var steps = Promise.resolve();
    if (picksDirty()) {
      var picksBody = sortedPicks().map(function (p) {
        return { issue: p.issue, url: p.url, title: p.title.trim(), note: p.note.trim() };
      });
      var picksSnapshot = serializePicks();
      steps = steps.then(function () { return post('/api/save', { picks: picksBody, sha: sha }); })
        .then(function (res) { sha = res.sha; savedPicks = picksSnapshot; });
    }
    if (hiddenDirty()) {
      var hiddenBody = Array.from(hidden);
      var hiddenSnapshot = serializeHidden();
      steps = steps.then(function () { return post('/api/save-memes', { hidden: hiddenBody, sha: hiddenSha }); })
        .then(function (res) { hiddenSha = res.sha; savedHidden = hiddenSnapshot; });
    }
    steps
      .then(function () {
        saving = false;
        updateBar();
        setStatus('Saved (' + summary() + '). The site updates in about a minute.');
      })
      .catch(function (err) {
        saving = false;
        updateBar();
        setStatus('Not saved: ' + err.message, true);
      });
  });

  window.addEventListener('beforeunload', function (e) {
    if (picksDirty() || hiddenDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}());
</script>
</body>
</html>`;
