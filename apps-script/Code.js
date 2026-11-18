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
const HEADERS = ['Saved', 'Source', 'Author', 'Text', 'Link', 'Folders', 'Note', 'ID'];
const COL = { saved: 1, source: 2, author: 3, text: 4, link: 5, folders: 6, note: 7, id: 8 };
const NCOLS = HEADERS.length;
const SEP = ', '; // how several folders are written in one cell (same as Sheets multi-select chips)

const UA_BOT = 'Mozilla/5.0 (compatible; SavesBot/1.0; +https://github.com/asyraffff/saves)';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

class UserError extends Error {}

// ═════════════════════════ Web app (called by the Shortcut) ═════════════════════════

function doPost(e) {
  return respond_(handle_(parseBody_(e)));
}

function doGet(e) {
  const p = (e && e.parameter) || {};
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
    const folders = listFolders_();
    const who = authorFromUrl(url);
    const label = who ? '@' + who : sourceLabel(source);

    if (existing) {
      const inFolders = splitFolders(existing.folders);
      return {
        id: existing.id,
        existed: true,
        prompt: 'Already saved' + (inFolders.length ? ' in ' + inFolders.join(SEP) : ' (Inbox)') + '. Add to:',
        in_folders: inFolders,
        folders: [NEW_FOLDER].concat(folders),
      };
    }

    const id = Utilities.getUuid().slice(0, 8);
    const row = [new Date(), sourceLabel(source), who ? '@' + who : '', '', url, '', note, id];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, NCOLS).setValues([row.map(safeCell)]);
    return { id: id, existed: false, prompt: 'Save ' + label + ' to:', in_folders: [], folders: [NEW_FOLDER].concat(folders) };
  } finally {
    lock.releaseLock();
  }
}

/** Step 2: add the chosen folders to the saved row, then fill in the post's details. */
function actionAssign_(body) {
  const id = String(body.id || '').trim();
  if (!id) throw new UserError('Missing id. Check the Shortcut sends the id from the first step.');

  const chosen = (Array.isArray(body.folders) ? body.folders : String(body.folders || '').split(/\r?\n/))
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return s && s !== NEW_FOLDER && s.indexOf('⚠️') !== 0; });
  const newFolder = String(body.new_folder || '').trim();
  if (newFolder) chosen.push(newFolder);

  let row;
  let added = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(SAVES);
    row = readRows_(sheet).find(function (r) { return r.id === id; });
    if (!row) throw new UserError('That saved post was not found.');

    added = chosen.map(cleanFolderName).filter(Boolean);
    added.forEach(ensureFolder_);
    const merged = uniq(splitFolders(row.folders).concat(added));
    sheet.getRange(row.rowNum, COL.folders).setValue(safeCell(merged.join(SEP)));
    if (typeof body.note === 'string' && body.note.trim()) sheet.getRange(row.rowNum, COL.note).setValue(safeCell(body.note.trim()));
    row.folders = merged.join(SEP);
  } finally {
    lock.releaseLock();
  }

  // Fetch author/text after filing, so the folder list appeared quickly.
  if (!row.text) fillDetails_(row);

  const names = uniq(added);
  return { ok: true, folders: names, message: names.length ? 'Saved to ' + names.join(SEP) : 'Saved to Inbox' };
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
    };
  });
}

/** Folder names in the order they appear in the Folders tab (drag rows there to reorder). */
function listFolders_() {
  const sheet = sheet_(FOLDERS);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return uniq(
    sheet.getRange(2, 1, last - 1, 1).getValues()
      .map(function (r) { return cleanFolderName(r[0]); })
      .filter(Boolean),
  );
}

/** Adds "Recipes / Desserts" (and its parent "Recipes") to the Folders tab if missing. */
function ensureFolder_(name) {
  const existing = listFolders_().map(function (f) { return f.toLowerCase(); });
  const parts = splitPath(name);
  const sheet = sheet_(FOLDERS);
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join(' / ');
    if (existing.indexOf(path.toLowerCase()) === -1) {
      sheet.appendRow([safeCell(path)]);
      existing.push(path.toLowerCase());
    }
  }
}

function fillDetails_(row) {
  try {
    const p = fetchPreview_(row.link);
    const sheet = sheet_(SAVES);
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

/** vm.tiktok.com / vt.tiktok.com / tiktok.com/t/ → full video URL. */
function expandShortLink_(url) {
  if (!isTikTokShortLink(url)) return url;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false, headers: { 'User-Agent': UA_IPHONE } });
    const headers = res.getAllHeaders();
    const loc = headers.Location || headers.location;
    if (loc) return String(Array.isArray(loc) ? loc[0] : loc);
  } catch (err) {
    /* keep the short link */
  }
  return url;
}

function fetchPreview_(url) {
  const source = detectSource(url);
  if (source === 'threads') {
    const html = fetchText_(url, UA_BOT);
    return Object.assign({ url: url }, html ? parseThreadsHtml(html, url) : { author: authorFromUrl(url), text: null });
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
  return 'other';
}

function sourceLabel(source) {
  return source === 'threads' ? 'Threads' : source === 'tiktok' ? 'TikTok' : 'Link';
}

function isTikTokShortLink(url) {
  const host = hostOf(url);
  return /^(vm|vt)\.tiktok\.com$/.test(host) || (detectSource(url) === 'tiktok' && pathOf(url).indexOf('/t/') === 0);
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
  const handle = authorFromUrl(url);
  const title = metaTag(html, 'og:title');
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
      return [after];
    });
    range.setValues(values);
  }

  // Subfolders in the Folders tab: "Old / X" → "New / X" (or removed).
  const folders = sheet_(FOLDERS);
  const fl = folders.getLastRow();
  if (fl >= 2) {
    const fr = folders.getRange(2, 1, fl - 1, 1);
    const o = oldName.toLowerCase();
    const vals = fr.getValues().map(function (r) {
      const f = cleanFolderName(r[0]);
      const l = f.toLowerCase();
      if (l.indexOf(o + ' / ') === 0) return [newName ? newName + f.slice(oldName.length) : ''];
      return [r[0]];
    });
    fr.setValues(vals);
    if (!newName) removeBlankFolderRows_();
  }
  return changed;
}

function removeBlankFolderRows_() {
  const folders = sheet_(FOLDERS);
  for (let r = folders.getLastRow(); r >= 2; r--) {
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
      if (clean && clean !== newValue) e.range.setValue(clean);
      return;
    }
    if (newValue) e.range.setValue(cleanFolderName(newValue));
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
    .addSeparator()
    .addItem('Rename or move folder…', 'renameFolderPrompt')
    .addItem('Delete folder…', 'deleteFolderPrompt')
    .addItem('Fill missing post details', 'fillMissingDetails')
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
  const names = folders.getRange(2, 1, Math.max(folders.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (cleanFolderName(names[i][0]).toLowerCase() === oldName.toLowerCase()) folders.getRange(i + 2, 1).setValue(newName);
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
  for (let r = folders.getLastRow(); r >= 2; r--) {
    if (cleanFolderName(folders.getRange(r, 1).getValue()).toLowerCase() === name.toLowerCase()) folders.deleteRow(r);
  }
  const n = applyFolderChange_(name, '');
  ui.alert('Deleted. ' + n + ' post(s) updated.');
}

function fillMissingDetails() {
  const rows = readRows_(sheet_(SAVES)).filter(function (r) { return r.link && !r.text; });
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
  [130, 70, 120, 360, 220, 200, 200, 80].forEach(function (w, i) { saves.setColumnWidth(i + 1, w); });

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
  if (folders.getLastRow() < 2) {
    folders.getRange(2, 1, 3, 1).setValues([['⭐ Favourites'], ['Ideas'], ['Recipes']]);
  }

  // Folders column on Saves: dropdown of your folders. Turn on "Allow multiple selections" by hand (see guide).
  const folderRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(folders.getRange('A2:A'), true)
    .setAllowInvalid(true)
    .build();
  saves.getRange(2, COL.folders, saves.getMaxRows() - 1, 1).setDataValidation(folderRule);

  // ── Browse ──
  const browse = getOrCreateSheet_(BROWSE, 0);
  browse.getRange('A1:A2').setValues([['Folder'], ['Search']]).setFontWeight('bold');
  if (!browse.getRange('B1').getValue()) browse.getRange('B1').setValue('Inbox');
  browse.getRange('B1:B2').setBackground('#fff8d6');
  browse.getRange('C1').setValue('← pick a folder (or All saves / Inbox)').setFontColor('#888888');
  browse.getRange('C2').setValue('← type to search text, author, notes').setFontColor('#888888');
  browse.getRange('Z1').setFormula('={"All saves";"Inbox";IFERROR(FILTER(Folders!A2:A, Folders!A2:A<>""), "")}');
  browse.hideColumns(26);
  browse.getRange('B1').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(browse.getRange('Z1:Z'), true).setAllowInvalid(false).build(),
  );
  browse.getRange(4, 1, 1, 7).setValues([HEADERS.slice(0, 7)]).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  browse.getRange('A5').setFormula(BROWSE_FORMULA);
  browse.getRange('A5:A').setNumberFormat('d mmm yyyy');
  browse.getRange('D5:D').setWrap(true);
  browse.setFrozenRows(4);
  [110, 70, 120, 360, 220, 200, 200].forEach(function (w, i) { browse.setColumnWidth(i + 1, w); });

  // Remove the default empty "Sheet1".
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ss.setActiveSheet(browse);

  if (!PropertiesService.getScriptProperties().getProperty('TOKEN')) newToken_();
  showToken();
}

const BROWSE_FORMULA =
  '=IFERROR(SORT(FILTER(Saves!A2:G, Saves!E2:E<>"",' +
  ' IF($B$1="Inbox", Saves!F2:F="",' +
  '  IF(OR($B$1="", $B$1="All saves"), Saves!E2:E<>"",' +
  '   (ISNUMBER(FIND(", "&$B$1&",", ", "&Saves!F2:F&",")) + ISNUMBER(FIND(", "&$B$1&" / ", ", "&Saves!F2:F))) > 0)),' +
  ' IF($B$2="", Saves!E2:E<>"", ISNUMBER(SEARCH($B$2, Saves!C2:C&" "&Saves!D2:D&" "&Saves!F2:F&" "&Saves!G2:G)))' +
  '), 1, FALSE), "Nothing here yet")';

function newToken_() {
  const token = 'svs_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  return token;
}

function showToken() {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN') || newToken_();
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (err) {
    /* not deployed yet */
  }
  const text =
    'Shortcut token:\n' + token + '\n\n' +
    (url ? 'Web app URL:\n' + url : 'Web app URL: not deployed yet. Do Deploy → New deployment (see guide), then copy the Web app URL.');
  console.log(text);
  const ui = ui_();
  if (ui) ui.alert('Saves: Shortcut details', text, ui.ButtonSet.OK);
}

function resetToken() {
  const ui = ui_();
  if (ui && ui.alert('Make a new token?', 'Your current Shortcut will stop working until you paste the new token into it.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  newToken_();
  showToken();
}
