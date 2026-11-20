/**
 * Saves — Google Sheets edition.
 *
 * Paste this whole file into Extensions → Apps Script (Code.gs) of your Saves sheet.
 * - The iPhone "Save to Saves" Shortcut talks to doPost() (deploy as a Web app).
 * - The sheet itself is the app: Saves (all posts), Folders (your folders), Browse (view one folder).
 *
 * https://github.com/asyraffff/saves
 */

const SAVES = 'Saves';
const FOLDERS = 'Folders';
const BROWSE = 'Browse';
const NEW_FOLDER = '➕ New folder…';
const ADD_NOTE = '📝 Add note…';
const ADD_DETAILS = '🏷️ Status, rating & price…';
const SKIP = '— Skip';
// Planning columns were added after ID (column H) so existing sheets keep working.
const HEADERS = ['Saved', 'Source', 'Author', 'Text', 'Link', 'Folders', 'Note', 'ID', 'Status', 'Rating', 'Price', 'Contact'];
const COL = { saved: 1, source: 2, author: 3, text: 4, link: 5, folders: 6, note: 7, id: 8, status: 9, rating: 10, price: 11, contact: 12 };
const NCOLS = HEADERS.length;
const STATUSES = ['To check', 'Shortlisted', 'Contacted', 'Booked', 'Not for us', 'Archived'];
const ANY_STATUS = 'All active'; // everything except "Not for us" and "Archived"
const RATINGS = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
const SORTS = ['Newest first', 'Oldest first', 'Top rated'];

// Names that must never become folders: Browse views, and Shortcut variable names that
// end up as plain text when a Shortcut field isn't set to the variable.
const NOT_FOLDERS = [
  'inbox', 'all saves', 'chosen', 'choosen', 'chosen item', 'choosen item', 'newfolder', 'new folder',
  'note', 'add note', 'provided input', 'dictionary value', 'combined text', 'shortcut input', 'text', 'saved',
];

/** True for values a Shortcut sends when a field was skipped, or set to a variable's name. */
function isBlankValue(v) {
  const n = String(v == null ? '' : v).replace(/[—–-]/g, '').trim().toLowerCase();
  return !n || isNotFolder(n) || ['skip', 'none', 'price', 'status', 'rating', 'chosen item'].indexOf(n) !== -1;
}

/** "shortlisted" → "Shortlisted"; anything else → null. */
function toStatus(v) {
  const n = String(v || '').trim().toLowerCase();
  const hit = STATUSES.filter(function (st) { return st.toLowerCase() === n; })[0];
  return hit || null;
}

/** "⭐⭐⭐", "3" or "3 stars" → "⭐⭐⭐"; anything else → null. */
function toRating(v) {
  const t = String(v || '').trim();
  const stars = (t.match(/⭐/g) || []).length;
  const n = stars || parseInt(t, 10);
  return n >= 1 && n <= 5 ? RATINGS[n - 1] : null;
}

function isNotFolder(name) {
  const n = String(name || '').replace(/[➕📝…]/g, '').trim().toLowerCase();
  return !n || NOT_FOLDERS.indexOf(n) !== -1;
}
const SEP = ', '; // how several folders are written in one cell (same as Sheets multi-select chips)

const UA_BOT = 'Mozilla/5.0 (compatible; SavesBot/1.0; +https://github.com/asyraffff/saves)';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

class UserError extends Error {}

// ═════════════════════════ Web app (called by the Shortcut) ═════════════════════════

function doPost(e) {
  rememberExecUrl_();
  return respond_(handle_(parseBody_(e)));
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  rememberExecUrl_();
  if (p.page === 'review') return reviewPage_(String(p.token || ''));
  if (p.action) return respond_(handle_(p));
  return respond_({ ok: true, message: 'Saves is running. Use the iPhone Shortcut to save posts.' });
}

function parseBody_(e) {
  const params = (e && e.parameter) || {};
  const raw = e && e.postData && e.postData.contents;
  if (!raw) return params;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return Object.assign({}, params, parsed);
  } catch (err) {
    /* not JSON */
  }
  return Object.assign({ input: raw }, params);
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(body) {
  const action = String(body.action || 'save').toLowerCase();
  try {
    checkToken_(body.token);
    if (action === 'save') return actionSave_(body);
    if (action === 'assign') return actionAssign_(body);
    if (action === 'folders') return { folders: listFolders_() };
    if (action === 'summary') return actionSummary_();
    throw new UserError('Unknown action "' + action + '".');
  } catch (err) {
    const message = err instanceof UserError ? err.message : 'Error: ' + (err && err.message ? err.message : err);
    if (!(err instanceof UserError)) console.error(err && err.stack ? err.stack : err);
    // The Shortcut shows the folder list next, so put the error there where you'll see it.
    return { error: true, message: message, prompt: message, folders: ['⚠️ ' + message], id: '' };
  }
}

function checkToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) throw new UserError('Run Saves → Set up in the sheet first.');
  if (String(token || '').trim() !== expected) throw new UserError('Wrong token. Check the token in your Shortcut.');
}

/** Step 1: save the link (Inbox) and return the folder list for "Choose from List". */
function actionSave_(body) {
  const rawUrl = extractUrl(String(body.input || body.url || ''));
  if (!rawUrl) throw new UserError('No link found in what was shared.');

  const url = normalizeUrl(expandShortLink_(rawUrl));
  const source = detectSource(url);
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(SAVES);
    const rows = readRows_(sheet);
    const existing = rows.find(function (r) { return r.link === url; });
    const picker = buildPicker(listFolders_(), getRecent_());
    const who = authorFromUrl(url);
    const label = who ? '@' + who : sourceLabel(source);

    if (existing) {
      const inFolders = splitFolders(existing.folders);
      return {
        id: existing.id,
        existed: true,
        prompt: 'Already saved' + (inFolders.length ? ' in ' + inFolders.join(SEP) : ' (Inbox)') + '. Add to:',
        in_folders: inFolders,
        folders: picker.labels,
        statuses: [SKIP].concat(STATUSES),
        ratings: [SKIP].concat(RATINGS),
      };
    }

    const id = Utilities.getUuid().slice(0, 8);
    const row = [new Date(), sourceLabel(source), who ? '@' + who : '', '', url, '', note, id, 'To check', '', '', ''];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, NCOLS).setValues([row.map(safeCell)]);
    return {
      id: id,
      existed: false,
      prompt: 'Save ' + label + ' to:',
      in_folders: [],
      folders: picker.labels,
      statuses: [SKIP].concat(STATUSES),
      ratings: [SKIP].concat(RATINGS),
    };
  } finally {
    lock.releaseLock();
  }
}

/** Step 2: add the chosen folders to the saved row, then fill in the post's details. */
function actionAssign_(body) {
  const id = String(body.id || '').trim();
  if (!id) throw new UserError('Missing id. Check the Shortcut sends the id from the first step.');

  const picked = (Array.isArray(body.folders) ? body.folders : String(body.folders || '').split(/\r?\n/))
    .map(function (s) { return String(s); })
    .filter(function (s) {
      const t = s.trim();
      return t && t !== NEW_FOLDER && t !== ADD_NOTE && t !== ADD_DETAILS && t.indexOf('⚠️') !== 0;
    });
  const newFolder = String(body.new_folder || '').trim();

  let row;
  let added = [];
  let noteAdded = false;
  const extras = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(SAVES);
    row = readRows_(sheet).find(function (r) { return r.id === id; });
    if (!row) throw new UserError('That saved post was not found.');

    // Turn the list labels ("↳ Venue", "🕘 Weddings / Venue") back into folder paths.
    const picker = buildPicker(listFolders_(), getRecent_());
    added = picked.map(function (label) { return labelToPath(label, picker.map); }).filter(Boolean);
    if (newFolder) added.push(cleanFolderName(newFolder));
    added = uniq(added.filter(function (f) { return f && !isNotFolder(f); }));
    added.forEach(ensureFolder_);
    const merged = uniq(splitFolders(row.folders).concat(added));
    sheet.getRange(row.rowNum, COL.folders).setValue(safeCell(merged.join(SEP)));
    // A note typed in the Shortcut is added to any existing note.
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    noteAdded = Boolean(note && !isNotFolder(note));
    if (noteAdded && row.note.indexOf(note) === -1) {
      sheet.getRange(row.rowNum, COL.note).setValue(safeCell(row.note ? row.note + '\n' + note : note));
    }
    // Status, rating and price picked in the Shortcut.
    const status = toStatus(body.status);
    if (status) {
      sheet.getRange(row.rowNum, COL.status).setValue(status);
      extras.push(status);
    }
    const rating = toRating(body.rating);
    if (rating) {
      sheet.getRange(row.rowNum, COL.rating).setValue(rating);
      extras.push(rating);
    }
    const price = isBlankValue(body.price) ? '' : String(body.price).trim();
    if (price) {
      sheet.getRange(row.rowNum, COL.price).setValue(safeCell(price));
      extras.push(price);
    }
    row.folders = merged.join(SEP);
    if (added.length) setRecent_(added);
  } finally {
    lock.releaseLock();
  }

  // Author/text are fetched in the background so the notification shows sooner.
  if (!row.text || isShortLink(row.link)) {
    if (!scheduleBackgroundFill_()) fillDetails_(row);
  }

  const where = added.length ? 'Saved to ' + added.join(SEP) : 'Saved to Inbox';
  return { ok: true, folders: added, message: where + extras.map(function (x) { return ' · ' + x; }).join('') + (noteAdded ? ' · 📝 note added' : '') };
}

/**
 * Removes folders that should never exist (see NOT_FOLDERS), from the Folders tab and from
 * every post. Runs in setup. Returns the names removed.
 */
function cleanUpJunkFolders_() {
  const removed = [];
  const folders = sheet_(FOLDERS);
  for (let r = lastFolderRow_(folders); r >= 2; r--) {
    const name = String(folders.getRange(r, 1).getValue());
    if (name.trim() && isNotFolder(cleanFolderName(name))) {
      removed.push(name.trim());
      folders.deleteRow(r);
    }
  }
  const saves = sheet_(SAVES);
  const last = saves.getLastRow();
  if (last >= 2) {
    const range = saves.getRange(2, COL.folders, last - 1, 1);
    range.setValues(range.getValues().map(function (v) {
      const kept = splitFolders(v[0]).filter(function (f) {
        if (!isNotFolder(f)) return true;
        if (removed.indexOf(f) === -1) removed.push(f);
        return false;
      });
      return [safeCell(kept.join(SEP))];
    }));
  }
  return uniq(removed);
}

// ═════════════════════════ Recent folders & background work ═════════════════════════

const RECENT_MAX = 5;

function getRecent_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('RECENT');
    return (raw ? JSON.parse(raw) : []).filter(function (r) { return !isNotFolder(r); });
  } catch (err) {
    return [];
  }
}

function setRecent_(used) {
  const next = uniq(used.concat(getRecent_())).slice(0, RECENT_MAX * 2);
  PropertiesService.getScriptProperties().setProperty('RECENT', JSON.stringify(next));
}

/** Run fillDetailsInBackground() in a few seconds, unless one is already queued. */
function scheduleBackgroundFill_() {
  try {
    const pending = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'fillDetailsInBackground';
    });
    if (!pending) ScriptApp.newTrigger('fillDetailsInBackground').timeBased().after(5 * 1000).create();
    return true;
  } catch (err) {
    console.warn('Could not schedule background fill (run setup once to allow triggers): ' + err);
    return false;
  }
}

/** Trigger handler: fills author/text for recent saves that are missing them. */
function fillDetailsInBackground() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fillDetailsInBackground') ScriptApp.deleteTrigger(t);
  });
  readRows_(sheet_(SAVES))
    .filter(function (r) { return r.link && (!r.text || isShortLink(r.link)); })
    .slice(-10)
    .forEach(fillDetails_);
}

// ═════════════════════════ Sheet helpers ═════════════════════════

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new UserError('Missing "' + name + '" tab. Run Saves → Set up in the sheet.');
  return s;
}

function readRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, NCOLS).getValues().map(function (v, i) {
    return {
      rowNum: i + 2,
      saved: v[0],
      source: String(v[1]),
      author: String(v[2]),
      text: String(v[3]),
      link: String(v[4]),
      folders: String(v[5]),
      note: String(v[6]),
      id: String(v[7]),
      status: String(v[8]),
      rating: String(v[9]),
      price: String(v[10]),
      contact: String(v[11]),
    };
  });
}

/**
 * Last row with a folder name in column A. (Column B's Posts formula fills every row, so
 * getLastRow() would point at the bottom of the sheet and new folders would land below row 1000.)
 */
function lastFolderRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 1) return 0;
  const values = sheet.getRange(1, 1, last, 1).getValues();
  for (let i = values.length; i > 0; i--) if (String(values[i - 1][0]).trim()) return i;
  return 0;
}

/** Folder names in the order they appear in the Folders tab (drag rows there to reorder). */
function listFolders_() {
  const sheet = sheet_(FOLDERS);
  const last = lastFolderRow_(sheet);
  if (last < 2) return [];
  return uniq(
    sheet.getRange(2, 1, last - 1, 1).getValues()
      .map(function (r) { return cleanFolderName(r[0]); })
      .filter(Boolean),
  );
}

/** Adds "Recipes / Desserts" (and its parent "Recipes") to the Folders tab if missing. */
function ensureFolder_(name) {
  if (isNotFolder(name)) return;
  const existing = listFolders_().map(function (f) { return f.toLowerCase(); });
  const parts = splitPath(name);
  const sheet = sheet_(FOLDERS);
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join(' / ');
    if (existing.indexOf(path.toLowerCase()) === -1) {
      sheet.getRange(lastFolderRow_(sheet) + 1, 1).setValue(safeCell(path));
      existing.push(path.toLowerCase());
    }
  }
}

function fillDetails_(row) {
  try {
    const link = isShortLink(row.link) ? normalizeUrl(expandShortLink_(row.link)) : row.link;
    const p = fetchPreview_(link);
    if (link !== row.link) p.url = p.url || link;
    const sheet = sheet_(SAVES);
    // Rows may have been deleted/moved while we fetched: only write if it's still the same post.
    if (String(sheet.getRange(row.rowNum, COL.id).getValue()) !== row.id) return;
    if (p.author) sheet.getRange(row.rowNum, COL.author).setValue(safeCell('@' + p.author));
    if (p.text) sheet.getRange(row.rowNum, COL.text).setValue(safeCell(p.text.slice(0, 2000)));
    if (p.url && p.url !== row.link) sheet.getRange(row.rowNum, COL.link).setValue(safeCell(p.url));
  } catch (err) {
    console.warn('Could not fetch details for ' + row.link + ': ' + err);
  }
}

// ═════════════════════════ Fetching post details ═════════════════════════

function fetchText_(url, ua) {
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (res.getResponseCode() >= 400) return null;
    return res.getContentText();
  } catch (err) {
    return null;
  }
}

/**
 * Short/share links → the real post URL:
 * vm.tiktok.com, vt.tiktok.com, tiktok.com/t/…, threads.com/share/…, threads.com/t/…
 */
function expandShortLink_(url) {
  if (!isShortLink(url)) return url;
  let current = url;
  try {
    // Follow up to 3 HTTP redirects by hand, stopping at the first real post URL.
    for (let i = 0; i < 3 && isShortLink(current); i++) {
      const res = UrlFetchApp.fetch(current, { muteHttpExceptions: true, followRedirects: false, headers: { 'User-Agent': UA_IPHONE } });
      const headers = res.getAllHeaders();
      const loc = headers.Location || headers.location;
      if (!loc) break;
      current = resolveUrl(String(Array.isArray(loc) ? loc[0] : loc), current);
    }
    // Threads/Instagram share pages may not redirect; their page says where the post is.
    if (isShortLink(current) && !isTikTokShortLink(current)) {
      const html = fetchText_(current, UA_BOT);
      const canonical = html && canonicalFromHtml(html);
      if (canonical && !isShortLink(canonical) && detectSource(canonical) === detectSource(current)) current = canonical;
    }
  } catch (err) {
    /* keep what we have */
  }
  return current;
}

function fetchPreview_(url) {
  const source = detectSource(url);
  if (source === 'threads') {
    const html = fetchText_(url, UA_BOT);
    if (!html) return { url: url, author: authorFromUrl(url), text: null };
    const canonical = canonicalFromHtml(html);
    return Object.assign(
      { url: canonical && isThreadsPostUrl(canonical) ? normalizeUrl(canonical) : url },
      parseThreadsHtml(html, url),
    );
  }
  if (source === 'tiktok') {
    const uas = [UA_BOT, UA_IPHONE];
    for (let i = 0; i < uas.length; i++) {
      const html = fetchText_(url, uas[i]);
      if (!html) continue;
      const p = parseTikTokHtml(html);
      if (p.text || p.author) return { url: p.canonical || url, author: p.author || authorFromUrl(url), text: p.text };
    }
    return { url: url, author: authorFromUrl(url), text: null };
  }
  if (source === 'youtube') {
    // YouTube's public oEmbed endpoint: reliable, no login, gives title + channel.
    const json = fetchText_('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), UA_BOT);
    try {
      const o = json ? JSON.parse(json) : null;
      if (o) return { url: url, author: parseYouTubeAuthor(o), text: o.title || null };
    } catch (err) {
      /* fall through */
    }
    return { url: url, author: null, text: null };
  }
  if (source === 'instagram') {
    // Best effort: Instagram sometimes shows Google's servers a login page instead.
    const html = fetchText_(url, UA_BOT);
    return Object.assign({ url: url }, html ? parseInstagramHtml(html) : { author: null, text: null });
  }
  const html = fetchText_(url, UA_BOT);
  return { url: url, author: null, text: html ? metaTag(html, 'og:title') || metaTag(html, 'og:description') : null };
}

// ═════════════════════════ Pure helpers (unit-tested) ═════════════════════════

function extractUrl(input) {
  const m = String(input).match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.!?]+$/, '') : null;
}

function hostOf(url) {
  const m = String(url).match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function pathOf(url) {
  const m = String(url).match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  return m ? m[1] || '/' : '/';
}

function detectSource(url) {
  const host = hostOf(url);
  if (/(^|\.)threads\.(net|com)$/.test(host)) return 'threads';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)(instagram\.com|instagr\.am)$/.test(host)) return 'instagram';
  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return 'youtube';
  return 'other';
}

function sourceLabel(source) {
  return { threads: 'Threads', tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' }[source] || 'Link';
}

function queryParam(url, name) {
  const m = String(url).match(new RegExp('[?&]' + name + '=([^&#]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function parseYouTubeAuthor(o) {
  const m = String(o.author_url || '').match(/\/@([^/?#]+)/);
  return m ? m[1] : o.author_name || null;
}

/** Instagram post page → author + caption (from Open Graph tags). */
function parseInstagramHtml(html) {
  const title = metaTag(html, 'og:title') || '';
  const desc = metaTag(html, 'og:description') || '';
  if (!title || /log\s?in|sign up/i.test(title)) return { author: null, text: null };
  // desc: '1,234 likes, 56 comments - weddingvendor on March 3, 2025: "Caption…".'
  const a = desc.match(/-\s+([A-Za-z0-9._]+)\s+on\s+[A-Z][a-z]+ \d/) || title.match(/\(@([A-Za-z0-9._]+)\)/);
  // title: 'Vendor Name on Instagram: "Caption…"'
  const c = title.match(/on Instagram:\s*["“]([\s\S]*)["”]\s*$/) || desc.match(/:\s*["“]([\s\S]*)["”]\.?\s*$/);
  return { author: a ? a[1] : null, text: c ? c[1].trim() || null : null };
}

function isTikTokShortLink(url) {
  const host = hostOf(url);
  return /^(vm|vt)\.tiktok\.com$/.test(host) || (detectSource(url) === 'tiktok' && pathOf(url).indexOf('/t/') === 0);
}

function isThreadsPostUrl(url) {
  return detectSource(url) === 'threads' && /^\/@[^/]+\/post\/[A-Za-z0-9_-]+/.test(pathOf(url));
}

/** Links that hide the real post: TikTok short links and Threads share links. */
function isShortLink(url) {
  if (isTikTokShortLink(url)) return true;
  const source = detectSource(url);
  if (source === 'instagram') return /^\/share\//.test(pathOf(url));
  return source === 'threads' && /^\/(share|t)\//.test(pathOf(url));
}

function resolveUrl(loc, base) {
  if (/^https?:\/\//i.test(loc)) return loc;
  const origin = String(base).match(/^https?:\/\/[^/?#]+/i)[0];
  return origin + (loc.charAt(0) === '/' ? loc : '/' + loc);
}

/** The page's own idea of its URL (og:url or <link rel="canonical">). */
function canonicalFromHtml(html) {
  const og = metaTag(html, 'og:url');
  if (og) return og;
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : null;
}

/** Canonical form so the same post shared twice is recognised. */
function normalizeUrl(url) {
  const source = detectSource(url);
  const path = pathOf(url);
  if (source === 'threads') {
    const m = path.match(/^\/(@[^/]+)\/post\/([A-Za-z0-9_-]+)/);
    if (m) return 'https://www.threads.com/' + m[1] + '/post/' + m[2];
    return 'https://www.threads.com' + path.replace(/\/$/, '');
  }
  if (source === 'tiktok') {
    const m = path.match(/^\/(@[^/]*)\/(video|photo)\/(\d+)/);
    if (m) return 'https://www.tiktok.com/' + m[1] + '/' + m[2] + '/' + m[3];
    return 'https://' + hostOf(url) + path;
  }
  if (source === 'instagram') {
    // /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, also /username/p/CODE → drop ?igsh= etc.
    const m = path.match(/^\/(?:[^/]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/);
    if (m) return 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2] + '/';
    return 'https://www.instagram.com' + (path.replace(/\/?$/, '/'));
  }
  if (source === 'youtube') {
    const host = hostOf(url);
    let id = null;
    let shorts = false;
    if (/youtu\.be$/.test(host)) id = path.slice(1).split('/')[0];
    else if (/^\/shorts\//.test(path)) { id = path.split('/')[2]; shorts = true; }
    else if (/^\/(embed|live|v)\//.test(path)) id = path.split('/')[2];
    else id = queryParam(url, 'v');
    if (id) return shorts ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id;
    return 'https://www.youtube.com' + path;
  }
  return String(url).replace(/#.*$/, '');
}

function authorFromUrl(url) {
  const m = pathOf(url).match(/^\/@([^/]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function metaTag(html, prop) {
  const re = new RegExp(
    '<meta[^>]+(?:property|name)=["\']' + prop.replace(/[:.]/g, '\\$&') + '["\'][^>]*content=["\']([^"\']*)["\']',
    'i',
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function parseThreadsHtml(html, url) {
  const title = metaTag(html, 'og:title'); // "Mark Zuckerberg (@zuck) on Threads"
  const fromTitle = title && title.match(/\(@([^)\s]+)\)/);
  const canonical = canonicalFromHtml(html);
  const handle = authorFromUrl(url) || (fromTitle && fromTitle[1]) || (canonical ? authorFromUrl(canonical) : null);
  if (!title || !/on Threads/i.test(title) || /log in/i.test(title)) return { author: handle, text: null };
  const desc = metaTag(html, 'og:description');
  return { author: handle, text: desc ? desc.trim() || null : null };
}

function findTikTokItem(node, depth) {
  depth = depth || 0;
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (node.itemInfo && node.itemInfo.itemStruct && node.itemInfo.itemStruct.author && node.itemInfo.itemStruct.author.uniqueId) {
    return node.itemInfo.itemStruct;
  }
  if (typeof node.desc === 'string' && node.author && node.author.uniqueId && node.video) return node;
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    const found = findTikTokItem(node[keys[i]], depth + 1);
    if (found) return found;
  }
  return null;
}

function parseTikTokHtml(html) {
  const ids = ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'api-data', 'SIGI_STATE'];
  for (let i = 0; i < ids.length; i++) {
    const m = html.match(new RegExp('<script[^>]+id="' + ids[i] + '"[^>]*>([\\s\\S]*?)</script>'));
    if (!m) continue;
    try {
      const item = findTikTokItem(JSON.parse(m[1]));
      if (item) {
        const handle = item.author.uniqueId;
        return {
          author: handle,
          text: item.desc ? String(item.desc).trim() || null : null,
          canonical: handle && item.id ? 'https://www.tiktok.com/@' + handle + '/video/' + item.id : null,
        };
      }
    } catch (err) {
      /* try next */
    }
  }
  return { author: null, text: metaTag(html, 'og:description') || metaTag(html, 'og:title'), canonical: null };
}

/** "Recipes /Desserts › Cakes" → ["Recipes", "Desserts", "Cakes"] */
function splitPath(path) {
  return String(path)
    .split(/\s*[/›>]\s*/)
    .map(function (p) { return p.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); })
    .filter(Boolean);
}

/** Folder names can't contain commas (commas separate folders in a cell). */
function cleanFolderName(name) {
  return splitPath(String(name || '').replace(/^'/, '')).join(' / ');
}

function splitFolders(cell) {
  return uniq(String(cell || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
}

function uniq(list) {
  const seen = {};
  return list.filter(function (x) {
    const k = String(x).toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

const RECENT_PREFIX = '🕘 ';
const CHILD_MARK = '↳ ';
const INDENT = '  '; // em spaces: iOS keeps them, so nesting stays visible
const RECENT_MIN_FOLDERS = 8; // with only a few folders a "recent" section is just clutter

/**
 * The list the Shortcut shows:
 *   ➕ New folder…
 *   🕘 Weddings / Venue        ← up to 5 recently used (only once you have many folders)
 *   💍 Weddings
 *   ↳ Venue
 *   ↳ Catering
 *     ↳ Halal caterers        ← deeper levels are indented
 * Returns { labels: [...], map: { label: "full / path" } }.
 */
function buildPicker(paths, recent) {
  const lower = {};
  paths.forEach(function (p) { lower[p.toLowerCase()] = p; });

  // Children are grouped under their parent, keeping Folders-tab order.
  const kids = {};
  const roots = [];
  paths.forEach(function (p) {
    const parts = splitPath(p);
    const parent = parts.slice(0, -1).join(' / ');
    if (parts.length > 1 && lower[parent.toLowerCase()]) {
      const key = lower[parent.toLowerCase()];
      (kids[key] = kids[key] || []).push(p);
    } else {
      roots.push(p);
    }
  });

  const labels = [NEW_FOLDER, ADD_NOTE, ADD_DETAILS];
  const map = {};
  const add = function (label, path) {
    let l = label;
    if (map[l] !== undefined) l = label + ' (' + splitPath(path).slice(0, -1).join(' / ') + ')';
    labels.push(l);
    map[l] = path;
  };

  if (paths.length > RECENT_MIN_FOLDERS) {
    (recent || [])
      .map(function (r) { return lower[String(r).toLowerCase()]; })
      .filter(Boolean)
      .slice(0, RECENT_MAX)
      .forEach(function (p) { add(RECENT_PREFIX + p, p); });
  }

  const walk = function (p, depth, isRoot) {
    const parts = splitPath(p);
    // A root that is really a subfolder (its parent row is missing) shows its full path.
    const name = isRoot ? parts.join(' / ') : parts[parts.length - 1];
    add(depth === 0 ? name : INDENT.repeat(depth - 1) + CHILD_MARK + name, p);
    (kids[p] || []).forEach(function (k) { walk(k, depth + 1, false); });
  };
  roots.forEach(function (r) { walk(r, 0, true); });
  return { labels: labels, map: map };
}

/** A label the user picked → folder path. Falls back to treating the label as a typed path. */
function labelToPath(label, map) {
  if (map[label] !== undefined) return map[label];
  const trimmed = String(label).trim();
  if (map[trimmed] !== undefined) return map[trimmed];
  if (trimmed.indexOf(RECENT_PREFIX.trim()) === 0) return cleanFolderName(trimmed.slice(RECENT_PREFIX.trim().length));
  if (trimmed.indexOf(CHILD_MARK.trim()) === 0 || /^[\s ]/.test(label)) return null; // stale indented label
  return cleanFolderName(trimmed);
}

/** Stop shared text like "=IMPORTXML(...)" from becoming a formula. */
function safeCell(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** Rename a folder (and its subfolders) inside one Folders cell. */
function renameInCell(cell, oldName, newName) {
  const o = oldName.toLowerCase();
  return uniq(
    splitFolders(cell).map(function (f) {
      const l = f.toLowerCase();
      if (l === o) return newName;
      if (l.indexOf(o + ' / ') === 0) return newName + f.slice(oldName.length);
      return f;
    }),
  ).join(SEP);
}

/** Remove a folder (and its subfolders) from one Folders cell. */
function removeFromCell(cell, name) {
  const n = name.toLowerCase();
  return splitFolders(cell)
    .filter(function (f) {
      const l = f.toLowerCase();
      return l !== n && l.indexOf(n + ' / ') !== 0;
    })
    .join(SEP);
}

// ═════════════════════════ Folder management ═════════════════════════

/** Apply a folder rename/delete to every post and to subfolders in the Folders tab. */
function applyFolderChange_(oldName, newName) {
  oldName = cleanFolderName(oldName);
  newName = cleanFolderName(newName);
  if (!oldName || oldName === newName) return 0;

  const saves = sheet_(SAVES);
  const last = saves.getLastRow();
  let changed = 0;
  if (last >= 2) {
    const range = saves.getRange(2, COL.folders, last - 1, 1);
    const values = range.getValues().map(function (r) {
      const before = String(r[0]);
      const after = newName ? renameInCell(before, oldName, newName) : removeFromCell(before, oldName);
      if (after !== splitFolders(before).join(SEP)) changed++;
      return [safeCell(after)];
    });
    range.setValues(values);
  }

  // Subfolders in the Folders tab: "Old / X" → "New / X" (or removed).
  const folders = sheet_(FOLDERS);
  const fl = lastFolderRow_(folders);
  if (fl >= 2) {
    const fr = folders.getRange(2, 1, fl - 1, 1);
    const o = oldName.toLowerCase();
    const vals = fr.getValues().map(function (r) {
      const f = cleanFolderName(r[0]);
      const l = f.toLowerCase();
      if (l.indexOf(o + ' / ') === 0) return [newName ? safeCell(newName + f.slice(oldName.length)) : ''];
      return [safeCell(r[0])];
    });
    fr.setValues(vals);
    if (!newName) removeBlankFolderRows_();
  }
  return changed;
}

function removeBlankFolderRows_() {
  const folders = sheet_(FOLDERS);
  for (let r = lastFolderRow_(folders); r >= 2; r--) {
    if (!String(folders.getRange(r, 1).getValue()).trim()) folders.deleteRow(r);
  }
}

/**
 * Simple trigger: works from the iPhone Sheets app too.
 * - Rename a folder in the Folders tab → renamed on every post.
 * - Clear a folder's cell → removed from every post (posts are kept).
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== FOLDERS || e.range.getColumn() !== 1 || e.range.getRow() < 2) return;
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    const oldValue = e.oldValue !== undefined ? String(e.oldValue) : '';
    const newValue = e.value !== undefined ? String(e.value) : '';
    if (!oldValue) {
      // New folder typed in: tidy it up.
      const clean = cleanFolderName(newValue);
      if (clean && clean !== newValue) e.range.setValue(safeCell(clean));
      return;
    }
    if (newValue) e.range.setValue(safeCell(cleanFolderName(newValue)));
    applyFolderChange_(oldValue, newValue);
    if (!newValue) removeBlankFolderRows_();
  } catch (err) {
    console.error(err);
  }
}

// ═════════════════════════ Menu (Sheets on a computer) ═════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Saves')
    .addItem('Set up / repair sheet', 'setup')
    .addItem('Show Shortcut token', 'showToken')
    .addItem('Show Review page link', 'showReviewLink')
    .addSeparator()
    .addItem('Rename or move folder…', 'renameFolderPrompt')
    .addItem('Delete folder…', 'deleteFolderPrompt')
    .addItem('Fill missing post details', 'fillMissingDetails')
    .addItem('Archive unreviewed posts older than 60 days', 'autoArchive')
    .addSeparator()
    .addItem('Make a new token (old one stops working)', 'resetToken')
    .addToUi();
}

function ui_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (err) {
    return null; // run from the script editor
  }
}

function selectedFolderName_() {
  const range = ss_().getActiveRange();
  if (range && range.getSheet().getName() === FOLDERS && range.getColumn() === 1 && range.getRow() >= 2) {
    return cleanFolderName(range.getValue());
  }
  return '';
}

function renameFolderPrompt() {
  const ui = SpreadsheetApp.getUi();
  let oldName = selectedFolderName_();
  if (!oldName) {
    const r = ui.prompt('Rename or move folder', 'Folder to rename (exactly as in the Folders tab):', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    oldName = cleanFolderName(r.getResponseText());
  }
  if (listFolders_().map(function (f) { return f.toLowerCase(); }).indexOf(oldName.toLowerCase()) === -1) {
    ui.alert('No folder called "' + oldName + '".');
    return;
  }
  const r2 = ui.prompt(
    'Rename "' + oldName + '"',
    'New name. To move it inside another folder, write the full path, e.g. "Food / Desserts".',
    ui.ButtonSet.OK_CANCEL,
  );
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const newName = cleanFolderName(r2.getResponseText());
  if (!newName) return;

  const folders = sheet_(FOLDERS);
  const names = folders.getRange(2, 1, Math.max(lastFolderRow_(folders) - 1, 1), 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (cleanFolderName(names[i][0]).toLowerCase() === oldName.toLowerCase()) folders.getRange(i + 2, 1).setValue(safeCell(newName));
  }
  const n = applyFolderChange_(oldName, newName);
  ensureFolder_(newName);
  ui.alert('Renamed. ' + n + ' post(s) updated.');
}

function deleteFolderPrompt() {
  const ui = SpreadsheetApp.getUi();
  let name = selectedFolderName_();
  if (!name) {
    const r = ui.prompt('Delete folder', 'Folder to delete:', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    name = cleanFolderName(r.getResponseText());
  }
  if (!name) return;
  const ok = ui.alert(
    'Delete "' + name + '" and its subfolders?',
    'Posts are NOT deleted. They stay in their other folders, or go back to the Inbox.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (ok !== ui.Button.OK) return;
  const folders = sheet_(FOLDERS);
  for (let r = lastFolderRow_(folders); r >= 2; r--) {
    if (cleanFolderName(folders.getRange(r, 1).getValue()).toLowerCase() === name.toLowerCase()) folders.deleteRow(r);
  }
  const n = applyFolderChange_(name, '');
  ui.alert('Deleted. ' + n + ' post(s) updated.');
}

function fillMissingDetails() {
  const rows = readRows_(sheet_(SAVES)).filter(function (r) { return r.link && (!r.text || !r.author || isShortLink(r.link)); });
  rows.slice(0, 50).forEach(fillDetails_);
  const ui = ui_();
  if (ui) ui.alert('Checked ' + Math.min(rows.length, 50) + ' post(s).');
}

// ═════════════════════════ Setup ═════════════════════════

function getOrCreateSheet_(name, index) {
  const ss = ss_();
  return ss.getSheetByName(name) || ss.insertSheet(name, index);
}

function setup() {
  const ss = ss_();

  // ── Saves ──
  const saves = getOrCreateSheet_(SAVES, 0);
  saves.getRange(1, 1, 1, NCOLS).setValues([HEADERS]).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  saves.setFrozenRows(1);
  saves.getRange('A:A').setNumberFormat('d mmm yyyy, h:mm');
  saves.getRange('D:D').setWrap(true);
  saves.getRange('G:G').setWrap(true);
  [130, 70, 120, 360, 220, 200, 200, 80, 110, 100, 90, 160].forEach(function (w, i) { saves.setColumnWidth(i + 1, w); });

  // Planning columns: Status (dropdown), Rating (dropdown), Price, Contact.
  const rows = saves.getMaxRows() - 1;
  saves.getRange(2, COL.status, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build(),
  );
  saves.getRange(2, COL.rating, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(RATINGS, true).setAllowInvalid(false).build(),
  );
  saves.getRange(1, COL.status).setNote('To check → Shortlisted → Contacted → Booked. "Not for us" or "Archived" hides a post from Browse (unless you pick that status there).');
  saves.getRange(1, COL.price).setNote('Anything you like, e.g. "RM 15,000" or "RM 45/pax".');
  saves.getRange(1, COL.contact).setNote('Phone, WhatsApp or IG handle of the vendor.');
  saves.getRange(2, COL.note, rows, 1).setWrap(true);

  // ── Folders ──
  const folders = getOrCreateSheet_(FOLDERS, 1);
  folders.getRange('A1').setValue('Folder').setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  folders.getRange('A1').setNote(
    'One folder per row. Use "/" for subfolders, e.g. "Recipes / Desserts". ' +
      'The order here is the order in the Shortcut, so drag rows to reorder. ' +
      'Renaming a cell renames that folder on every post. Clearing a cell removes the folder (posts are kept).',
  );
  folders.getRange('B1').setFormula(
    '={"Posts"; MAP(A2:A, LAMBDA(n, IF(n="", "", SUMPRODUCT(--ISNUMBER(FIND(", "&n&",", ", "&Saves!F2:F&","))))))}',
  );
  folders.getRange('B1').setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  folders.setFrozenRows(1);
  folders.setColumnWidth(1, 260);
  folders.setColumnWidth(2, 70);
  if (lastFolderRow_(folders) < 2) {
    folders.getRange(2, 1, 3, 1).setValues([['⭐ Favourites'], ['Ideas'], ['Recipes']]);
  }

  // Folders column on Saves: dropdown of your folders. "Allow multiple selections" can only be
  // ticked by hand (see guide), and Sheets only allows it when invalid input is rejected.
  // Only add the rule if there isn't one yet, so re-running setup keeps that checkbox on.
  const folderCells = saves.getRange(2, COL.folders, saves.getMaxRows() - 1, 1);
  if (!folderCells.getDataValidation()) {
    folderCells.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInRange(folders.getRange('A2:A'), true)
        .setAllowInvalid(false)
        .build(),
    );
  }

  saves.hideColumns(COL.id); // internal ID, not useful to look at

  const removed = cleanUpJunkFolders_();
  compactFolders_();
  setupShortlist_();
  const archiveOn = ensureDailyArchive_();

  // ── Browse (phone-friendly) ──
  //  📁 Folder  [ Weddings / Venue ▾ ]   12 posts
  //  🔎 Search  [                    ]   📥 3 unsorted in Inbox
  //  🏷️ Status  [ Any (not archived) ▾ ] [ Newest first ▾ ]
  //  Saved | 🧵 | Who | Post | Link | Status | ⭐ | Price | Folders | Note | Contact
  const browse = getOrCreateSheet_(BROWSE, 0);
  // Keep what you were looking at (the first layout kept the folder in B1).
  const oldLayout = String(browse.getRange('A1').getValue()) === 'Folder';
  const current = String(browse.getRange(oldLayout ? 'B1' : 'D1').getValue() || 'Inbox');
  const search = String(browse.getRange(oldLayout ? 'B2' : 'D2').getValue() || '');
  const status = oldLayout ? '' : String(browse.getRange('D3').getValue() || '');
  const sort = oldLayout ? '' : String(browse.getRange('E3').getValue() || '');
  const top = browse.getRange('A1:K3');
  top.breakApart();
  top.clearContent();
  top.clearDataValidations();
  top.setBackground(null).setFontColor(null).setFontWeight('normal');

  browse.getRange('A1:C1').merge().setValue('📁 Folder').setFontWeight('bold');
  browse.getRange('A2:C2').merge().setValue('🔎 Search').setFontWeight('bold');
  browse.getRange('A3:C3').merge().setValue('🏷️ Status').setFontWeight('bold');
  browse.getRange('D1').setValue(current).setBackground('#fff8d6');
  browse.getRange('D2').setValue(search).setBackground('#fff8d6');
  browse.getRange('D3').setValue(STATUSES.indexOf(status) !== -1 ? status : ANY_STATUS).setBackground('#fff8d6');
  browse.getRange('E3:G3').merge().setValue(SORTS.indexOf(sort) !== -1 ? sort : SORTS[0]).setBackground('#fff8d6');
  browse.getRange('E1:G1').merge().setFormula('=IF($A$5="Nothing here yet", "0 posts", COUNTA($A$5:$A) & " posts")').setFontColor('#666666');
  browse.getRange('E2:G2').merge()
    .setFormula('="📥 " & COUNTIFS(Saves!E2:E, "<>", Saves!F2:F, "") & " unsorted in Inbox"')
    .setFontColor('#666666');

  browse.getRange('Z1').setFormula('={"All saves";"Inbox";IFERROR(FILTER(Folders!A2:A, Folders!A2:A<>""), "")}');
  browse.hideColumns(26);
  browse.getRange('D1').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(browse.getRange('Z1:Z'), true).setAllowInvalid(false).build(),
  );
  browse.getRange('D3').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([ANY_STATUS].concat(STATUSES), true).setAllowInvalid(false).build(),
  );
  browse.getRange('E3').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SORTS, true).setAllowInvalid(false).build(),
  );

  browse.getRange(4, 1, 1, 11)
    .setValues([['Saved', '', 'Who', 'Post', 'Link', 'Status', '⭐', 'Price', 'Folders', 'Note', 'Contact']])
    .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  browse.getRange('A5').setFormula(BROWSE_FORMULA);
  browse.getRange('A5:A').setNumberFormat('d mmm');
  browse.getRange('A5:K').setVerticalAlignment('top');
  browse.getRange('D5:D').setWrap(true);
  browse.getRange('I5:K').setWrap(true);
  browse.setFrozenRows(4);
  [62, 30, 105, 240, 62, 95, 75, 85, 150, 150, 120].forEach(function (w, i) { browse.setColumnWidth(i + 1, w); });

  // Remove the default empty "Sheet1".
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ss.setActiveSheet(browse);

  if (!PropertiesService.getScriptProperties().getProperty('TOKEN')) newToken_();
  // No popup here: a popup in the sheet tab blocks the run (and times out) if nobody clicks OK.
  console.log(shortcutDetails_());
  try {
    ss.toast(
      'Setup complete.' + (removed.length ? ' Removed junk folders: ' + removed.join(', ') + '.' : '') +
        (archiveOn ? '' : ' (Daily auto-archive could not be turned on.)') +
        ' Use Saves → Show Shortcut token to see your token.',
      'Saves',
      10,
    );
    if (removed.length) console.log('Removed junk folders: ' + removed.join(', '));
  } catch (err) {
    /* no sheet open */
  }
}

// Filters by folder (D1), search (D2) and status (D3); sorts by E3. Empty status counts as "To check".
// Shows a 🧵/🎵/📸/▶️ icon instead of a Source column, and "Open ↗" instead of the long URL.
const BROWSE_FORMULA =
  '=IFERROR(LET(' +
  ' st, ARRAYFORMULA(IF(Saves!I2:I="", "To check", Saves!I2:I)),' +
  ' f, FILTER(Saves!A2:L, Saves!E2:E<>"",' +
  '  IF($D$1="Inbox", Saves!F2:F="",' +
  '   IF(OR($D$1="", $D$1="All saves"), Saves!E2:E<>"",' +
  '    (ISNUMBER(FIND(", "&$D$1&",", ", "&Saves!F2:F&",")) + ISNUMBER(FIND(", "&$D$1&" / ", ", "&Saves!F2:F))) > 0)),' +
  '  IF($D$2="", Saves!E2:E<>"",' +
  '   ISNUMBER(SEARCH($D$2, Saves!C2:C&" "&Saves!D2:D&" "&Saves!F2:F&" "&Saves!G2:G&" "&Saves!K2:K&" "&Saves!L2:L))),' +
  '  IF(OR($D$3="", $D$3="' + ANY_STATUS + '"), (st<>"Archived")*(st<>"Not for us"), st=$D$3)),' +
  ' key, IF($E$3="Top rated", MAP(INDEX(f,,10), LAMBDA(r, LEN(r))), INDEX(f,,1)),' +
  ' s, SORT(f, key, $E$3="Oldest first", INDEX(f,,1), FALSE),' +
  ' HSTACK(INDEX(s,,1),' +
  '  MAP(INDEX(s,,2), LAMBDA(x, IF(x="TikTok", "🎵", IF(x="Threads", "🧵", IF(x="Instagram", "📸", IF(x="YouTube", "▶️", "🔗")))))),' +
  '  INDEX(s,,3), INDEX(s,,4),' +
  '  MAP(INDEX(s,,5), LAMBDA(u, HYPERLINK(u, "Open ↗"))),' +
  '  MAP(INDEX(s,,9), LAMBDA(v, IF(v="", "To check", v))),' +
  '  INDEX(s,,10), INDEX(s,,11), INDEX(s,,6), INDEX(s,,7), INDEX(s,,12))),' +
  ' "Nothing here yet")';

function newToken_() {
  const token = 'svs_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  return token;
}

function shortcutDetails_() {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN') || newToken_();
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (err) {
    /* not deployed yet */
  }
  // From the editor this returns the /dev test address, which the Shortcut must not use.
  const urlText = url && /\/exec$/.test(url)
    ? 'Web app URL:\n' + url
    : 'Web app URL: copy it from Deploy → Manage deployments (it ends in /exec).';
  return 'Shortcut token:\n' + token + '\n\n' + urlText;
}

function showToken() {
  const text = shortcutDetails_();
  console.log(text);
  const ui = ui_();
  if (ui) ui.alert('Saves: Shortcut details', text, ui.ButtonSet.OK);
}

function resetToken() {
  const ui = ui_();
  // Only from the Sheets menu, after you confirm. (Public functions can also be reached from
  // a web page, so never change the token without the confirmation dialog.)
  if (!ui) {
    console.log('Use Saves → Make a new token in the sheet to change the token.');
    return;
  }
  if (ui.alert('Make a new token?', 'Your current Shortcut will stop working until you paste the new token into it.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  newToken_();
  showToken();
}

// ═════════════════════════ Review page, weekly summary, auto-archive ═════════════════════════

const SHORTLIST = 'Shortlist';
const AUTO_ARCHIVE_DAYS = 60;
const SHORTLISTED = ['Shortlisted', 'Contacted', 'Booked'];
const INBOX_KEY = '__inbox__';

function isToCheck_(r) {
  return Boolean(r.link) && (!r.status || r.status === 'To check');
}

/** Does this post belong in `folder` (or one of its subfolders)? '' = everything, INBOX_KEY = no folder. */
function inFolder_(r, folder) {
  if (!folder) return true;
  const fs = splitFolders(r.folders);
  if (folder === INBOX_KEY) return fs.length === 0;
  const f = folder.toLowerCase();
  return fs.some(function (x) {
    const l = x.toLowerCase();
    return l === f || l.indexOf(f + ' / ') === 0;
  });
}

function toDate_(v) {
  if (v instanceof Date) return v;
  if (v === '' || v === null || v === undefined) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** "today", "yesterday", "5 days ago", "2 months ago". */
function ageText(saved, now) {
  const d = toDate_(saved);
  if (!d) return '';
  const days = Math.floor(((now || new Date()).getTime() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return days + ' days ago';
  return Math.round(days / 30) + ' months ago';
}

function postForPage_(r, now) {
  return {
    id: r.id, source: r.source, author: r.author, text: r.text.slice(0, 3000), link: r.link,
    folders: splitFolders(r.folders), note: r.note, status: r.status || 'To check',
    rating: r.rating, price: r.price, contact: r.contact, age: ageText(r.saved, now),
  };
}

/** Called by the Review page: posts still "To check" (newest first) and the shortlist. */
function reviewData(token, folder) {
  checkToken_(token);
  const now = new Date();
  const rows = readRows_(sheet_(SAVES));
  const f = String(folder || '');
  return {
    posts: rows.filter(function (r) { return isToCheck_(r) && inFolder_(r, f); }).reverse()
      .map(function (r) { return postForPage_(r, now); }),
    shortlist: rows.filter(function (r) { return r.link && SHORTLISTED.indexOf(r.status) !== -1 && inFolder_(r, f); })
      .map(function (r) { return postForPage_(r, now); }),
    folders: listFolders_(),
    total: rows.filter(isToCheck_).length,
  };
}

/**
 * Called by the Review page. `changes` may have status, rating, price, contact, note,
 * folders (replaces all) and add_folder. Returns the values from before, so the page can undo.
 */
function reviewUpdate(token, id, changes) {
  checkToken_(token);
  const c = changes || {};
  const has = function (k) { return Object.prototype.hasOwnProperty.call(c, k) && c[k] !== null && c[k] !== undefined; };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(SAVES);
    const row = readRows_(sheet).find(function (r) { return r.id === String(id); });
    if (!row) throw new UserError('That post was not found. It may have been deleted.');
    const prev = { status: row.status, rating: row.rating, price: row.price, contact: row.contact, note: row.note, folders: row.folders };
    const set = function (col, v) { sheet.getRange(row.rowNum, col).setValue(safeCell(v)); };

    if (has('status')) {
      const st = String(c.status) === '' ? '' : toStatus(c.status);
      if (st !== null) set(COL.status, st);
    }
    if (has('rating')) {
      const rt = String(c.rating) === '' ? '' : toRating(c.rating);
      if (rt !== null) set(COL.rating, rt);
    }
    ['price', 'contact', 'note'].forEach(function (k) {
      if (has(k)) set(COL[k], String(c[k]).trim());
    });
    let folders = splitFolders(row.folders);
    if (has('folders')) folders = splitFolders(c.folders).filter(function (x) { return !isNotFolder(x); });
    if (has('add_folder') && String(c.add_folder).trim()) {
      const nf = cleanFolderName(c.add_folder);
      if (nf && !isNotFolder(nf)) {
        ensureFolder_(nf);
        folders = uniq(folders.concat([nf]));
        setRecent_([nf]);
      }
    }
    if (has('folders') || has('add_folder')) set(COL.folders, folders.join(SEP));
    return { ok: true, prev: prev };
  } finally {
    lock.releaseLock();
  }
}

/** For the weekly iPhone automation: "🗂️ 12 saves to review (5 Venue, 4 Attire, 3 Inbox)". */
function summaryFor_(rows) {
  const todo = rows.filter(isToCheck_);
  if (!todo.length) return { count: 0, message: '🎉 Nothing to review. You are all caught up!' };
  const counts = {};
  todo.forEach(function (r) {
    const fs = splitFolders(r.folders);
    (fs.length ? fs : ['Inbox']).forEach(function (f) {
      const name = splitPath(f).slice(-1)[0];
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  const top = Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, 3)
    .map(function (k) { return counts[k] + ' ' + k; });
  return {
    count: todo.length,
    message: '🗂️ ' + todo.length + (todo.length === 1 ? ' save' : ' saves') + ' to review (' + top.join(', ') + ')',
  };
}

function actionSummary_() {
  const s = summaryFor_(readRows_(sheet_(SAVES)));
  s.review_url = reviewUrl_();
  return s;
}

function rememberExecUrl_() {
  try {
    const url = ScriptApp.getService().getUrl();
    const props = PropertiesService.getScriptProperties();
    if (url && /\/exec$/.test(url) && props.getProperty('EXEC_URL') !== url) props.setProperty('EXEC_URL', url);
  } catch (err) {
    /* ignore */
  }
}

/** The Review page link (it includes your token, so keep it to yourself). '' until deployed. */
function reviewUrl_() {
  let url = PropertiesService.getScriptProperties().getProperty('EXEC_URL') || '';
  if (!url) {
    try {
      url = ScriptApp.getService().getUrl() || '';
    } catch (err) {
      /* not deployed */
    }
  }
  if (!/\/exec$/.test(url)) return '';
  return url + '?page=review&token=' + encodeURIComponent(PropertiesService.getScriptProperties().getProperty('TOKEN') || '');
}

/** Daily trigger: posts left "To check" for 60+ days become "Archived" (not deleted). */
function autoArchive() {
  const n = archiveOld_(new Date(), AUTO_ARCHIVE_DAYS);
  try {
    if (ui_()) ss_().toast(n ? 'Archived ' + n + ' old unreviewed post(s).' : 'Nothing old enough to archive.', 'Saves', 6);
  } catch (err) {
    /* triggered run: no sheet open */
  }
  return n;
}

function archiveOld_(now, days) {
  const sheet = sheet_(SAVES);
  const rows = readRows_(sheet);
  if (!rows.length) return 0;
  const cutoff = now.getTime() - days * 86400000;
  let n = 0;
  const values = rows.map(function (r) {
    const d = toDate_(r.saved);
    if (isToCheck_(r) && d && d.getTime() < cutoff) {
      n++;
      return ['Archived'];
    }
    return [safeCell(r.status)];
  });
  if (n) sheet.getRange(2, COL.status, rows.length, 1).setValues(values);
  return n;
}

function ensureDailyArchive_() {
  try {
    const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoArchive'; });
    if (!exists) ScriptApp.newTrigger('autoArchive').timeBased().everyDays(1).atHour(4).create();
    return true;
  } catch (err) {
    console.warn('Could not add the daily auto-archive: ' + err);
    return false;
  }
}

/** Moves folder names up so there are no gaps in the Folders tab. */
function compactFolders_() {
  const folders = sheet_(FOLDERS);
  const last = folders.getLastRow();
  if (last < 2) return false;
  const range = folders.getRange(2, 1, last - 1, 1);
  const values = range.getValues();
  const names = uniq(values.map(function (v) { return String(v[0]).trim(); }).filter(Boolean));
  const changed = values.some(function (v, i) { return String(v[0]).trim() !== (i < names.length ? names[i] : ''); });
  const out = values.map(function (_v, i) { return [i < names.length ? safeCell(names[i]) : '']; });
  if (changed) range.setValues(out);
  return changed;
}

function showReviewLink() {
  const url = reviewUrl_();
  const text = url
    ? 'Open this on your iPhone in Safari, then Share → Add to Home Screen:\n\n' + url + '\n\nIt contains your token, so keep it to yourself.'
    : 'Deploy the web app first (Deploy → New deployment), save one post with the Shortcut, then try again.';
  console.log(text);
  const ui = ui_();
  if (ui) ui.alert('Saves: Review page', text, ui.ButtonSet.OK);
}

// Folder, ⭐, Price, Status, Who, Contact, Post, Link, Note. Sorted by folder, best rated first.
const SHORTLIST_FORMULA =
  '=IFERROR(LET(' +
  ' st, Saves!I2:I,' +
  ' f, FILTER(Saves!A2:L, Saves!E2:E<>"", (st="Shortlisted")+(st="Contacted")+(st="Booked")),' +
  ' s, SORT(f, INDEX(f,,6), TRUE, MAP(INDEX(f,,10), LAMBDA(r, LEN(r))), FALSE),' +
  ' HSTACK(MAP(INDEX(s,,6), LAMBDA(x, IF(x="", "📥 Inbox", x))), INDEX(s,,10), INDEX(s,,11), INDEX(s,,9),' +
  '  INDEX(s,,3), INDEX(s,,12), INDEX(s,,4), MAP(INDEX(s,,5), LAMBDA(u, HYPERLINK(u, "Open ↗"))), INDEX(s,,7))),' +
  ' "No shortlisted posts yet. On the Review page, tap ⭐ Shortlist.")';

function setupShortlist_() {
  const sh = getOrCreateSheet_(SHORTLIST, 1);
  sh.getRange(1, 1, 1, 9)
    .setValues([['Folder', '⭐', 'Price', 'Status', 'Who', 'Contact', 'Post', 'Link', 'Note']])
    .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  sh.getRange('A2').setFormula(SHORTLIST_FORMULA);
  sh.setFrozenRows(1);
  sh.getRange('A2:I').setVerticalAlignment('top');
  sh.getRange('G2:G').setWrap(true);
  sh.getRange('I2:I').setWrap(true);
  [150, 75, 90, 95, 110, 120, 260, 62, 160].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}

function reviewPage_(token) {
  const ok = token && token === PropertiesService.getScriptProperties().getProperty('TOKEN');
  // Without the right token, answer with plain text, not an HtmlService page: any HtmlService page
  // lets its visitor call this script's public functions through google.script.run.
  if (!ok) {
    return ContentService.createTextOutput(
      'This Review link is out of date. In the sheet, use Saves → Show Review page link to get the current one.',
    ).setMimeType(ContentService.MimeType.TEXT);
  }
  const html = REVIEW_HTML.split('__TOKEN__').join(JSON.stringify(String(token)).replace(/</g, '\\u003c'));
  return HtmlService.createHtmlOutput(html)
    .setTitle('Saves Review')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// The Review page (served by doGet with ?page=review&token=…). __TOKEN__ is filled in by reviewPage_.
const REVIEW_HTML = `<!doctype html>
<html><head><base target="_blank"><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<style>
:root{--bg:#f4f3ef;--card:#fff;--ink:#1b1b1b;--muted:#6b6b6b;--line:#e3e1da;--chip:#efede6;--accent:#2f6f5e;--accent-ink:#fff;--warn:#a33a2c;--gold:#d9a400}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1e1e1e;--ink:#f0f0f0;--muted:#a0a0a0;--line:#333;--chip:#2a2a2a;--accent:#5fb39b;--accent-ink:#0d1f1a;--warn:#e07a6b;--gold:#f0c040}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
header{position:sticky;top:0;z-index:2;background:var(--bg);padding:12px 16px 8px;border-bottom:1px solid var(--line)}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.top b{font-size:20px}
#count{color:var(--muted);font-size:14px}
.tabs{display:flex;gap:6px;margin:10px 0 8px}
.tabs button{flex:1;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:15px}
.tabs button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
select,input,textarea{width:100%;font:inherit;font-size:16px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 10px}
textarea{min-height:64px;resize:vertical}
main{padding:12px 16px 120px;max-width:560px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}
.meta{color:var(--muted);font-size:14px;margin-bottom:6px}
.meta b{color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{background:var(--chip);border-radius:999px;padding:2px 10px;font-size:13px}
.text{white-space:pre-wrap;word-wrap:break-word;max-height:9.5em;overflow:hidden;position:relative}
.text.open{max-height:none}
.more{background:none;border:0;color:var(--accent);font:inherit;font-size:14px;padding:4px 0}
.openpost{display:block;text-align:center;margin:10px 0 12px;padding:10px;border-radius:10px;background:var(--chip);color:var(--ink);text-decoration:none;font-weight:600}
.stars{display:flex;gap:4px;margin:4px 0 10px}
.stars button{flex:1;font-size:24px;padding:4px 0;border:0;background:none;color:var(--line);line-height:1}
.stars button.on{color:var(--gold)}
.field{margin-bottom:8px}
.actions{position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:560px;margin:0 auto}
.actions button{padding:11px 4px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:14px;font-weight:600}
.actions .primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.actions .no{color:var(--warn)}
.empty{text-align:center;padding:48px 8px;color:var(--muted)}
.empty b{display:block;font-size:22px;color:var(--ink);margin-bottom:6px}
.empty button{margin-top:16px;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
h3{margin:18px 0 8px;font-size:16px}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px}
.item .row{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.item .snip{font-size:14px;color:var(--muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.item a{color:var(--accent);font-weight:600;text-decoration:none;white-space:nowrap}
#toast{position:fixed;left:16px;right:16px;bottom:150px;max-width:528px;margin:0 auto;background:var(--ink);color:var(--bg);border-radius:12px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:15px}
#toast button{background:none;border:0;color:var(--bg);font:inherit;font-weight:700;text-decoration:underline}
[hidden]{display:none!important}
</style></head><body>
<header>
  <div class="top"><b>🗂️ Review</b><span id="count">Loading…</span></div>
  <div class="tabs"><button id="tabReview" class="on">To review</button><button id="tabShort">⭐ Shortlist</button></div>
  <select id="folder" aria-label="Folder"></select>
</header>
<main id="review"><div class="empty">Loading your saves…</div></main>
<main id="short" hidden></main>
<div class="actions" id="actions" hidden>
  <button class="primary" data-status="Shortlisted">⭐ Shortlist</button>
  <button data-status="Contacted">📞 Contacted</button>
  <button data-status="Booked">✅ Booked</button>
  <button class="no" data-status="Not for us">👎 Not for us</button>
  <button data-status="Archived">🗄️ Archive</button>
  <button data-skip="1">⏭️ Skip</button>
</div>
<div id="toast" hidden><span id="toastText"></span><button id="undo" type="button">Undo</button></div>
<script>
var TOKEN = __TOKEN__;
var ICONS = {Threads:'🧵', TikTok:'🎵', Instagram:'📸', YouTube:'▶️'};
var S = {posts:[], i:0, shortlist:[], folders:[], total:0, rating:'', last:null, folder:''};
try { S.folder = localStorage.getItem('saves.folder') || ''; } catch (e) {}

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function webUrl(u){ return /^https?:\\/\\//i.test(String(u || '')) ? String(u) : ''; }
function link(u, cls, text){ var w = webUrl(u); return w ? '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(w) + '" rel="noopener noreferrer">' + text + '</a>' : ''; }
function stars(n){ return n ? new Array(n + 1).join('⭐') : ''; }
function starCount(r){ return (String(r || '').match(/⭐/g) || []).length; }

function call(name, args, ok){
  var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function(e){ toast('⚠️ ' + (e && e.message ? e.message : e)); });
  r[name].apply(r, args);
}

function load(){
  call('reviewData', [TOKEN, S.folder], function(d){
    S.posts = d.posts; S.shortlist = d.shortlist; S.folders = d.folders; S.total = d.total; S.i = 0;
    fillFolders(); render(); renderShort();
  });
}

function fillFolders(){
  var sel = $('folder');
  var opts = ['<option value="">📂 All folders</option>', '<option value="__inbox__">📥 Inbox (no folder)</option>'];
  S.folders.forEach(function(f){
    var parts = f.split(' / ');
    var label = parts.length > 1 ? new Array(parts.length).join(' ') + '↳ ' + parts[parts.length - 1] : f;
    opts.push('<option value="' + esc(f) + '">' + esc(label) + '</option>');
  });
  sel.innerHTML = opts.join('');
  sel.value = S.folder;
  if (sel.value !== S.folder) { S.folder = ''; sel.value = ''; }
}

function updateCount(){
  var n = S.posts.length;
  $('count').textContent = n ? n + ' to review' + (S.folder ? ' here' : '') : 'All caught up';
}

function render(){
  updateCount();
  var box = $('review');
  var p = S.posts[S.i];
  $('actions').hidden = !p || !$('short').hidden;
  if (!p) {
    var skipped = S.posts.length;
    box.innerHTML = '<div class="empty"><b>🎉 All caught up</b>' +
      (skipped ? 'You skipped ' + skipped + (skipped === 1 ? ' post.' : ' posts.') + '<br><button id="again">Go through skipped again</button>'
               : (S.folder ? 'Nothing left to review in this folder.' : 'Nothing left to review.')) + '</div>';
    if ($('again')) $('again').onclick = function(){ S.i = 0; render(); };
    return;
  }
  S.rating = p.rating || '';
  var folderOpts = ['<option value="">➕ Add to a folder…</option>'].concat(S.folders.filter(function(f){ return p.folders.indexOf(f) === -1; })
    .map(function(f){ return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; })).join('');
  box.innerHTML =
    '<div class="card">' +
      '<div class="meta">' + (ICONS[p.source] || '🔗') + ' <b>' + esc(p.author || p.source) + '</b> · saved ' + esc(p.age) + '</div>' +
      '<div class="chips">' + (p.folders.length ? p.folders.map(function(f){ return '<span class="chip">' + esc(f) + '</span>'; }).join('') : '<span class="chip">📥 Inbox</span>') + '</div>' +
      '<div class="text" id="text">' + (p.text ? esc(p.text) : '<i>No text saved. Open the post to see it.</i>') + '</div>' +
      '<button class="more" id="more" hidden>Show more</button>' +
      link(p.link, 'openpost', 'Open post ↗') +
      '<div class="stars" id="stars">' + [1,2,3,4,5].map(function(n){ return '<button type="button" data-n="' + n + '" aria-label="' + n + ' stars">★</button>'; }).join('') + '</div>' +
      '<div class="field"><input id="price" placeholder="Price, e.g. RM 15,000" value="' + esc(p.price) + '"></div>' +
      '<div class="field"><input id="contact" placeholder="Contact (phone, WhatsApp, IG)" value="' + esc(p.contact) + '"></div>' +
      '<div class="field"><textarea id="note" placeholder="Note">' + esc(p.note) + '</textarea></div>' +
      '<div class="field"><select id="addFolder">' + folderOpts + '</select></div>' +
    '</div>';
  paintStars();
  $('stars').onclick = function(e){
    var n = +e.target.getAttribute('data-n');
    if (!n) return;
    S.rating = starCount(S.rating) === n ? '' : stars(n);
    paintStars();
  };
  var t = $('text');
  if (t.scrollHeight > t.clientHeight + 4) { $('more').hidden = false; $('more').onclick = function(){ t.className = 'text open'; this.hidden = true; }; }
  window.scrollTo(0, 0);
}

function paintStars(){
  var n = starCount(S.rating);
  Array.prototype.forEach.call($('stars').children, function(b, i){ b.className = i < n ? 'on' : ''; });
}

function act(status){
  var p = S.posts[S.i];
  if (!p) return;
  var changes = { status: status, rating: S.rating, price: $('price').value, contact: $('contact').value, note: $('note').value, add_folder: $('addFolder').value };
  var removed = S.posts.splice(S.i, 1)[0];
  var undo = { post: removed, index: S.i, prev: null };
  S.last = undo;
  render();
  toast(status === 'Archived' ? '🗄️ Archived' : status === 'Not for us' ? '👎 Not for us' : '✓ ' + status, true);
  call('reviewUpdate', [TOKEN, p.id, changes], function(res){
    undo.prev = res.prev;
    if (SHORTLISTED.indexOf(status) !== -1) { removed.status = status; removed.rating = changes.rating; removed.price = changes.price; removed.contact = changes.contact; removed.note = changes.note; S.shortlist.push(removed); renderShort(); }
  });
}

var SHORTLISTED = ['Shortlisted', 'Contacted', 'Booked'];

$('undo').onclick = function(){
  var u = S.last;
  if (!u) return;
  S.last = null;
  $('toast').hidden = true;
  S.posts.splice(u.index, 0, u.post);
  S.i = u.index;
  S.shortlist = S.shortlist.filter(function(x){ return x.id !== u.post.id; });
  render(); renderShort();
  var restore = function(prev){ call('reviewUpdate', [TOKEN, u.post.id, prev], function(){}); };
  if (u.prev) restore(u.prev);
  else { var wait = setInterval(function(){ if (u.prev) { clearInterval(wait); restore(u.prev); } }, 300); setTimeout(function(){ clearInterval(wait); }, 15000); }
};

var toastTimer;
function toast(text, canUndo){
  $('toastText').textContent = text;
  $('undo').hidden = !canUndo;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ $('toast').hidden = true; }, canUndo ? 5000 : 7000);
}

$('actions').onclick = function(e){
  var b = e.target.closest('button');
  if (!b) return;
  if (b.getAttribute('data-skip')) { S.i++; render(); return; }
  act(b.getAttribute('data-status'));
};

function renderShort(){
  var box = $('short');
  if (!S.shortlist.length) { box.innerHTML = '<div class="empty"><b>No shortlist yet</b>Tap ⭐ Shortlist while reviewing and the post shows up here, grouped by folder.</div>'; return; }
  var groups = {};
  S.shortlist.forEach(function(p){ var k = p.folders[0] || '📥 Inbox'; (groups[k] = groups[k] || []).push(p); });
  box.innerHTML = Object.keys(groups).sort().map(function(k){
    var items = groups[k].sort(function(a, b){ return starCount(b.rating) - starCount(a.rating); });
    return '<h3>' + esc(k) + ' · ' + items.length + '</h3>' + items.map(function(p){
      var bits = [p.rating, p.price, p.status === 'Shortlisted' ? '' : p.status, p.contact].filter(Boolean).map(esc).join(' · ');
      return '<div class="item"><div class="row"><span>' + (ICONS[p.source] || '🔗') + ' <b>' + esc(p.author || p.source) + '</b></span>' + link(p.link, '', 'Open ↗') + '</div>' +
        (bits ? '<div class="row"><span>' + bits + '</span></div>' : '') +
        (p.text ? '<div class="snip">' + esc(p.text) + '</div>' : '') +
        (p.note ? '<div class="snip">📝 ' + esc(p.note) + '</div>' : '') + '</div>';
    }).join('');
  }).join('');
}

function showTab(review){
  $('tabReview').className = review ? 'on' : '';
  $('tabShort').className = review ? '' : 'on';
  $('review').hidden = !review;
  $('short').hidden = review;
  $('actions').hidden = !review || !S.posts[S.i];
}
$('tabReview').onclick = function(){ showTab(true); };
$('tabShort').onclick = function(){ showTab(false); };
$('folder').onchange = function(){
  S.folder = this.value;
  try { localStorage.setItem('saves.folder', S.folder); } catch (e) {}
  $('review').innerHTML = '<div class="empty">Loading…</div>';
  load();
};
load();
</script>
</body></html>`;
