import { beforeEach, describe, expect, it } from 'vitest';
import { loadScript } from './fake-gas.js';

const THREADS_HTML = `<meta property="og:title" content="Mark Zuckerberg (&#064;zuck) on Threads" />
<meta property="og:description" content="Let&#039;s do this. Welcome to Threads. &#x1f525;" />`;
const TIKTOK_DATA = {
  __DEFAULT_SCOPE__: {
    'webapp.video-detail': {
      itemInfo: { itemStruct: { id: '123', desc: 'frogs 🐸', author: { uniqueId: 'tiktok' }, video: { cover: 'x' } } },
    },
  },
};
const TIKTOK_HTML = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(TIKTOK_DATA)}</script>`;

const SHARE_HTML = `<meta property="og:title" content="Amir (&#064;chef.amir) on Threads" />
<meta property="og:description" content="Mug cake recipe" />
<meta property="og:url" content="https://www.threads.com/@chef.amir/post/DAbC123xyz" />`;

function fakeWeb(url) {
  if (url.startsWith('https://www.threads.com/share/')) return { body: SHARE_HTML };
  if (url.startsWith('https://www.threads.com/@chef.amir/post/')) return { body: SHARE_HTML };
  if (url.startsWith('https://vm.tiktok.com/')) {
    return { code: 302, headers: { Location: 'https://www.tiktok.com/@/video/123?_r=1&u_code=abc' } };
  }
  if (url.includes('threads.com/@zuck/post/')) return { body: THREADS_HTML };
  if (url.includes('tiktok.com/@')) return { body: TIKTOK_HTML };
  return { code: 404 };
}

let env;
let gas;
let token;
const post = (body) => gas.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).json();
const savesRows = () => env.sheets.get('Saves').dump().slice(1);
const folderNames = () => env.sheets.get('Folders').dump().slice(1).map((r) => r[0]).filter(Boolean);

beforeEach(() => {
  env = loadScript({ fetch: fakeWeb });
  gas = env.gas;
  gas.setup();
  token = env.props.get('TOKEN');
});

describe('setup', () => {
  it('creates the three tabs, starter folders, a token and the Browse formula', () => {
    expect([...env.sheets.keys()].sort()).toEqual(['Browse', 'Folders', 'Saves', 'Shortlist']);
    expect(env.sheets.get('Saves').dump()[0]).toEqual(['Saved', 'Source', 'Author', 'Text', 'Link', 'Folders', 'Note', 'ID', 'Status', 'Rating', 'Price', 'Contact']);
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes']);
    expect(token).toMatch(/^svs_[0-9a-f]{40}$/);
    const browse = env.sheets.get('Browse').formulas['5,1'];
    expect(browse).toContain('FILTER(Saves!A2:L');
    expect(browse).toContain('HYPERLINK(u, "Open ↗")');
    expect(browse).not.toContain('$B$1');
  });

  it('is safe to run twice (keeps folders and token)', () => {
    gas.setup();
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes']);
    expect(env.props.get('TOKEN')).toBe(token);
  });
});

describe('Shortcut flow', () => {
  it('rejects a wrong token, and shows the error in the folder list', () => {
    token = 'svs_wrong';
    const res = post({ action: 'save', input: 'https://www.threads.com/@zuck/post/CuP48CiS5sx' });
    expect(res.error).toBe(true);
    expect(res.folders[0]).toMatch(/^⚠️ Wrong token/);
    expect(savesRows()).toEqual([]);
  });

  it('saves a Threads post to the Inbox, then files it into several folders and fills details', () => {
    const saved = post({ action: 'save', input: 'https://www.threads.net/@zuck/post/CuP48CiS5sx?xmt=AQG' });
    expect(saved.prompt).toBe('Save @zuck to:');
    expect(saved.folders).toEqual(['➕ New folder…', '📝 Add note…', '🏷️ Status, rating & price…', '⭐ Favourites', 'Ideas', 'Recipes']);
    let [row] = savesRows();
    expect(row.slice(1, 6)).toEqual(['Threads', '@zuck', '', 'https://www.threads.com/@zuck/post/CuP48CiS5sx', '']);

    const assigned = post({
      action: 'assign',
      id: saved.id,
      folders: '➕ New folder…\nIdeas\n⭐ Favourites',
      new_folder: 'Recipes / Desserts',
    });
    expect(assigned.message).toBe('Saved to Ideas, ⭐ Favourites, Recipes / Desserts');
    [row] = savesRows();
    expect(row[3]).toBe(''); // details come in the background
    expect(env.triggers).toEqual(['autoArchive', 'fillDetailsInBackground']);
    gas.fillDetailsInBackground();
    expect(env.triggers).toEqual(['autoArchive']);
    [row] = savesRows();
    expect(row[5]).toBe('Ideas, ⭐ Favourites, Recipes / Desserts');
    expect(row[3]).toBe("Let's do this. Welcome to Threads. 🔥");
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes', 'Recipes / Desserts']);
  });

  it('expands TikTok short links from share text and recognises duplicates', () => {
    const first = post({ action: 'save', input: 'Check this out! https://vm.tiktok.com/ZMabc/ #fyp' });
    expect(savesRows()[0][4]).toBe('https://www.tiktok.com/@/video/123');
    post({ action: 'assign', id: first.id, folders: 'Ideas' });
    gas.fillDetailsInBackground();
    const [row] = savesRows();
    expect(row[2]).toBe('@tiktok');
    expect(row[3]).toBe('frogs 🐸');
    expect(row[4]).toBe('https://www.tiktok.com/@tiktok/video/123');

    const again = post({ action: 'save', input: 'https://www.tiktok.com/@tiktok/video/123?is_from_webapp=1' });
    expect(again.existed).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.prompt).toBe('Already saved in Ideas. Add to:');
    post({ action: 'assign', id: again.id, folders: 'Recipes\nIdeas' });
    expect(savesRows()).toHaveLength(1);
    expect(savesRows()[0][5]).toBe('Ideas, Recipes');
  });

  it('turns a Threads /share/ link into the real post URL with author, and spots duplicates', () => {
    const first = post({ action: 'save', input: 'https://www.threads.com/share/_zMiAbCdEf/' });
    expect(first.prompt).toBe('Save @chef.amir to:');
    let [row] = savesRows();
    expect(row[4]).toBe('https://www.threads.com/@chef.amir/post/DAbC123xyz');
    post({ action: 'assign', id: first.id, folders: 'Recipes' });
    gas.fillDetailsInBackground();
    [row] = savesRows();
    expect(row[2]).toBe('@chef.amir');
    expect(row[3]).toBe('Mug cake recipe');

    const again = post({ action: 'save', input: 'https://www.threads.net/@chef.amir/post/DAbC123xyz?xmt=1' });
    expect(again.existed).toBe(true);
    expect(savesRows()).toHaveLength(1);
  });

  it('Shortcut list shows subfolders indented, and assign understands those labels', () => {
    const s0 = post({ action: 'save', input: 'https://www.threads.com/@a/post/W1' });
    post({ action: 'assign', id: s0.id, folders: '', new_folder: 'Weddings / Venue' });
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/W2' });
    expect(s.folders).toEqual(['➕ New folder…', '📝 Add note…', '🏷️ Status, rating & price…', '⭐ Favourites', 'Ideas', 'Recipes', 'Weddings', '↳ Venue']);
    const res = post({ action: 'assign', id: s.id, folders: 'Weddings\n↳ Venue' });
    expect(res.message).toBe('Saved to Weddings, Weddings / Venue');
    expect(savesRows()[1][5]).toBe('Weddings, Weddings / Venue');
    expect(JSON.parse(env.props.get('RECENT'))[0]).toBe('Weddings');
  });

  it('cancelled folder pick leaves the post in the Inbox', () => {
    post({ action: 'save', input: 'https://www.threads.com/@someone/post/ABC' });
    expect(savesRows()[0][5]).toBe('');
  });

  it('assign with nothing chosen says Inbox', () => {
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/B' });
    expect(post({ action: 'assign', id: s.id, folders: '' }).message).toBe('Saved to Inbox');
  });

  it('neutralises text that looks like a formula', () => {
    const s = post({ action: 'save', input: 'https://example.com/x', note: '=IMPORTXML("http://evil")' });
    expect(s.id).toBeTruthy();
    expect(gas.safeCell('=1+1')).toBe("'=1+1");
    expect(gas.safeCell('hello')).toBe('hello');
  });

  it('accepts form-encoded parameters too (doGet)', () => {
    const res = gas.doGet({ parameter: { action: 'folders', token } }).json();
    expect(res.folders).toEqual(['⭐ Favourites', 'Ideas', 'Recipes']);
  });
});

describe('folder management', () => {
  beforeEach(() => {
    for (const [input, folders] of [
      ['https://www.threads.com/@a/post/1', 'Recipes\nRecipes / Desserts'],
      ['https://www.threads.com/@a/post/2', 'Recipes / Desserts\nIdeas'],
      ['https://www.threads.com/@a/post/3', 'Ideas'],
    ]) {
      const s = post({ action: 'save', input });
      post({ action: 'assign', id: s.id, folders });
    }
  });

  it('renaming a folder in the Folders tab (onEdit) renames it and its subfolders everywhere', () => {
    const sheet = env.sheets.get('Folders');
    const row = folderNames().indexOf('Recipes') + 2;
    const range = sheet.getRange(row, 1);
    range.setValue('Food');
    gas.onEdit({ range, oldValue: 'Recipes', value: 'Food' });
    expect(savesRows().map((r) => r[5])).toEqual(['Food, Food / Desserts', 'Food / Desserts, Ideas', 'Ideas']);
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Food', 'Food / Desserts']);
  });

  it('clearing a folder cell removes it (and subfolders) from posts but keeps the posts', () => {
    const sheet = env.sheets.get('Folders');
    const row = folderNames().indexOf('Recipes') + 2;
    const range = sheet.getRange(row, 1);
    range.setValue('');
    gas.onEdit({ range, oldValue: 'Recipes', value: undefined });
    expect(savesRows().map((r) => r[5])).toEqual(['', 'Ideas', 'Ideas']);
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas']);
  });

  it('pure helpers (picker)', () => {
    const E = '  ';
    const paths = ['Weddings', 'Ideas', 'Weddings / Venue', 'Weddings / Catering', 'Weddings / Catering / Halal', 'Trips / Bali'];
    const { labels, map } = gas.buildPicker(paths, ['Weddings / Venue']);
    // Few folders → no "recent" section; children indented under their parent; orphan shows full path.
    expect(labels).toEqual([
      '➕ New folder…',
      '📝 Add note…', '🏷️ Status, rating & price…',
      'Weddings',
      '↳ Venue',
      '↳ Catering',
      E + '↳ Halal',
      'Ideas',
      'Trips / Bali',
    ]);
    expect(gas.labelToPath(E + '↳ Halal', map)).toBe('Weddings / Catering / Halal');
    expect(gas.labelToPath('Brand new / Thing', map)).toBe('Brand new / Thing');
    expect(gas.labelToPath('↳ Gone', map)).toBeNull();

    // Same child name under two parents gets disambiguated.
    const dup = gas.buildPicker(['Weddings', 'Weddings / Venue', 'Birthday', 'Birthday / Venue'], []);
    expect(dup.labels).toContain('↳ Venue (Birthday)');
    expect(dup.map['↳ Venue (Birthday)']).toBe('Birthday / Venue');

    // Many folders → up to 5 recent ones on top.
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Weddings', 'Weddings / Venue'];
    const r = gas.buildPicker(many, ['Weddings / Venue', 'Gone', 'C']);
    expect(r.labels.slice(0, 5)).toEqual(['➕ New folder…', '📝 Add note…', '🏷️ Status, rating & price…', '🕘 Weddings / Venue', '🕘 C']);
    expect(r.map['🕘 C']).toBe('C');
  });

  it('pure helpers', () => {
    expect(gas.renameInCell('A, A / B, C', 'A', 'Z')).toBe('Z, Z / B, C');
    expect(gas.removeFromCell('A, A / B, AB', 'A')).toBe('AB');
    expect(gas.cleanFolderName(' Recipes /Desserts, cakes › Choc ')).toBe('Recipes / Desserts cakes / Choc');
    expect(gas.splitFolders('a, b,, A')).toEqual(['a', 'b']);
  });
});

describe('Instagram & YouTube', () => {
  it('normalises links', () => {
    expect(gas.normalizeUrl('https://www.instagram.com/reel/C5vUrq3SN1p/?igsh=abc')).toBe('https://www.instagram.com/reel/C5vUrq3SN1p/');
    expect(gas.normalizeUrl('https://instagram.com/reels/C5vUrq3SN1p')).toBe('https://www.instagram.com/reel/C5vUrq3SN1p/');
    expect(gas.normalizeUrl('https://www.instagram.com/someshop/p/C0tBnJ6Sv5O/?img_index=2')).toBe('https://www.instagram.com/p/C0tBnJ6Sv5O/');
    expect(gas.normalizeUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(gas.normalizeUrl('https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(gas.normalizeUrl('https://youtube.com/shorts/tPEE9ZwTmy0?si=a')).toBe('https://www.youtube.com/shorts/tPEE9ZwTmy0');
    expect(gas.sourceLabel(gas.detectSource('https://instagr.am/p/x'))).toBe('Instagram');
    expect(gas.isShortLink('https://www.instagram.com/share/reel/BAabc')).toBe(true);
  });

  it('parses Instagram post pages and ignores the login page', () => {
    const html = `<meta property="og:title" content="Pelamin Indah on Instagram: &quot;Pelamin set for Dec 2025 &#x1f338;&quot;" />
<meta property="og:description" content="1,234 likes, 56 comments - pelamin.indah on March 3, 2025: &quot;Pelamin set for Dec 2025 &#x1f338;&quot;." />`;
    expect(gas.parseInstagramHtml(html)).toEqual({ author: 'pelamin.indah', text: 'Pelamin set for Dec 2025 🌸' });
    expect(gas.parseInstagramHtml('<meta property="og:title" content="Login • Instagram" />')).toEqual({ author: null, text: null });
  });

  it('saves a YouTube link with title and channel from oEmbed', () => {
    env = loadScript({
      fetch: (url) =>
        url.startsWith('https://www.youtube.com/oembed')
          ? { body: JSON.stringify({ title: 'Wedding vlog', author_name: 'Aina', author_url: 'https://www.youtube.com/@ainavlogs' }) }
          : { code: 404 },
    });
    gas = env.gas;
    gas.setup();
    token = env.props.get('TOKEN');
    const s = post({ action: 'save', input: 'https://youtu.be/abc123XYZ00?si=1' });
    post({ action: 'assign', id: s.id, folders: 'Ideas' });
    gas.fillDetailsInBackground();
    const [row] = savesRows();
    expect(row.slice(1, 5)).toEqual(['YouTube', '@ainavlogs', 'Wedding vlog', 'https://www.youtube.com/watch?v=abc123XYZ00']);
  });
});

describe('wedding planning & clean-up', () => {
  it('new saves start as "To check"', () => {
    post({ action: 'save', input: 'https://www.threads.com/@a/post/S1' });
    expect(savesRows()[0][8]).toBe('To check');
  });

  it('📝 Add note… adds the typed note and is never a folder', () => {
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/N1' });
    expect(s.folders[1]).toBe('📝 Add note…');
    const res = post({ action: 'assign', id: s.id, folders: '📝 Add note…\nIdeas', note: 'RM15k, ask about Dec date' });
    expect(res.message).toBe('Saved to Ideas · 📝 note added');
    const [row] = savesRows();
    expect(row[5]).toBe('Ideas');
    expect(row[6]).toBe('RM15k, ask about Dec date');
  });

  it('variable names sent as plain text never become folders', () => {
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/J1' });
    const res = post({ action: 'assign', id: s.id, folders: 'Chosen\nChoosen Item\nIdeas', new_folder: 'NewFolder', note: 'Note' });
    expect(res.message).toBe('Saved to Ideas');
    expect(folderNames()).not.toContain('Chosen');
    expect(folderNames()).not.toContain('NewFolder');
    expect(savesRows()[0][6]).toBe('');
  });

  it('setup removes junk folders left from earlier Shortcut mistakes', () => {
    env.sheets.get('Folders').appendRow(['Chosen']);
    env.sheets.get('Folders').appendRow(['Choosen Item']);
    env.sheets.get('Folders').appendRow(['Inbox']);
    env.sheets.get('Folders').appendRow(['NewFolder']);
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/C1' });
    env.sheets.get('Saves').getRange(2, 6).setValue('Chosen, Ideas, NewFolder, Choosen Item');
    gas.setup();
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes']);
    expect(savesRows()[0][5]).toBe('Ideas');
    expect(s.id).toBeTruthy();
  });
});

describe('status, rating & price from the Shortcut', () => {
  it('save returns the lists and assign fills the columns', () => {
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/P1' });
    expect(s.folders.slice(0, 3)).toEqual(['➕ New folder…', '📝 Add note…', '🏷️ Status, rating & price…']);
    expect(s.statuses[0]).toBe('— Skip');
    expect(s.statuses).toContain('Shortlisted');
    expect(s.ratings).toEqual(['— Skip', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐']);
    const res = post({
      action: 'assign', id: s.id, folders: '🏷️ Status, rating & price…\nIdeas',
      status: 'Shortlisted', rating: '⭐⭐⭐⭐', price: 'RM 15,000',
    });
    expect(res.message).toBe('Saved to Ideas · Shortlisted · ⭐⭐⭐⭐ · RM 15,000');
    const [row] = savesRows();
    expect(row.slice(8, 11)).toEqual(['Shortlisted', '⭐⭐⭐⭐', 'RM 15,000']);
    expect(folderNames()).not.toContain('🏷️ Status, rating & price…');
  });

  it('skipped or unset fields change nothing', () => {
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/P2' });
    const res = post({ action: 'assign', id: s.id, folders: 'Ideas', status: '— Skip', rating: 'Rating', price: 'Price' });
    expect(res.message).toBe('Saved to Ideas');
    expect(savesRows()[0].slice(8, 11)).toEqual(['To check', '', '']);
  });

  it('understands loose ratings and statuses', () => {
    expect(gas.toRating('3')).toBe('⭐⭐⭐');
    expect(gas.toRating('5 stars')).toBe('⭐⭐⭐⭐⭐');
    expect(gas.toRating('9')).toBe(null);
    expect(gas.toStatus('booked')).toBe('Booked');
    expect(gas.toStatus('maybe')).toBe(null);
  });
});

describe('review page, summary, auto-archive', () => {
  const save = (url, folders) => {
    const s = post({ action: 'save', input: url });
    post({ action: 'assign', id: s.id, folders });
    return s.id;
  };

  it('new folders go right under the last folder, even with the Posts formula filling column B', () => {
    env.sheets.get('Folders').set(1000, 2, ''); // like the formula's empty results
    env.sheets.get('Folders').set(1000, 2, 0);
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/F1' });
    post({ action: 'assign', id: s.id, folders: '', new_folder: 'Weddings / Rings' });
    const col = env.sheets.get('Folders').dump().map((r) => r[0]);
    expect(col.slice(1, 6)).toEqual(['⭐ Favourites', 'Ideas', 'Recipes', 'Weddings', 'Weddings / Rings']);
    expect(col.length).toBe(1000);
  });

  it('setup moves stranded folders back up', () => {
    env.sheets.get('Folders').set(1001, 1, 'Places');
    gas.setup();
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes', 'Places']);
    expect(env.sheets.get('Folders').cell(5, 1)).toBe('Places');
  });

  it('reviewData lists "To check" posts newest first, by folder, with the shortlist', () => {
    const a = save('https://www.threads.com/@a/post/R1', 'Weddings / Venue');
    const b = save('https://www.threads.com/@b/post/R2', 'Ideas');
    const c = save('https://www.threads.com/@c/post/R3', '');
    expect(() => gas.reviewData('nope', '')).toThrow();
    let d = gas.reviewData(token, '');
    expect(d.posts.map((p) => p.id)).toEqual([c, b, a]);
    expect(d.total).toBe(3);
    expect(gas.reviewData(token, 'Weddings').posts.map((p) => p.id)).toEqual([a]);
    expect(gas.reviewData(token, '__inbox__').posts.map((p) => p.id)).toEqual([c]);

    const res = gas.reviewUpdate(token, a, { status: 'Shortlisted', rating: '⭐⭐⭐⭐', price: 'RM 15,000', contact: '012-345', note: 'nice', add_folder: 'Weddings / Shortlist trip' });
    expect(res.prev.status).toBe('To check');
    d = gas.reviewData(token, '');
    expect(d.posts.map((p) => p.id)).toEqual([c, b]);
    expect(d.shortlist.map((p) => [p.id, p.rating, p.price, p.contact, p.note])).toEqual([[a, '⭐⭐⭐⭐', 'RM 15,000', '012-345', 'nice']]);
    expect(d.shortlist[0].folders).toEqual(['Weddings / Venue', 'Weddings / Shortlist trip']);
    expect(folderNames()).toContain('Weddings / Shortlist trip');

    // Undo puts everything back.
    gas.reviewUpdate(token, a, res.prev);
    const row = savesRows().find((r) => r[7] === a);
    expect(row.slice(8, 12)).toEqual(['To check', '', '', '']);
    expect(row[5]).toBe('Weddings / Venue');
    expect(row[6]).toBe('');
  });

  it('serves the Review page only with the right token', () => {
    const page = gas.doGet({ parameter: { page: 'review', token } });
    expect(page.title).toBe('Saves Review');
    expect(page.getContent()).toContain(JSON.stringify(token));
    expect(page.getContent()).not.toContain('__TOKEN__');
    const bad = gas.doGet({ parameter: { page: 'review', token: 'x' } });
    expect(bad.getContent()).toContain('out of date');
    expect(bad.title).toBeUndefined(); // plain text, not an HtmlService page
  });

  it('summary counts posts to review by folder and links the Review page', () => {
    save('https://www.threads.com/@a/post/S1', 'Weddings / Venue');
    save('https://www.threads.com/@b/post/S2', 'Weddings / Venue');
    save('https://www.threads.com/@c/post/S3', '');
    const s = post({ action: 'summary' });
    expect(s.count).toBe(3);
    expect(s.message).toBe('🗂️ 3 saves to review (2 Venue, 1 Inbox)');
    expect(s.review_url).toBe('https://script.google.com/macros/s/TEST/exec?page=review&token=' + token);
    expect(gas.summaryFor_([]).message).toContain('all caught up');
  });

  it('archives posts left "To check" for 60+ days, and only those', () => {
    const old = save('https://www.threads.com/@a/post/O1', 'Ideas');
    const kept = save('https://www.threads.com/@b/post/O2', 'Ideas');
    const shortlisted = save('https://www.threads.com/@c/post/O3', 'Ideas');
    gas.reviewUpdate(token, shortlisted, { status: 'Shortlisted' });
    const sheet = env.sheets.get('Saves');
    const longAgo = new Date(Date.now() - 61 * 86400000);
    sheet.dump().forEach((r, i) => { if (i > 0 && r[7] !== kept) sheet.set(i + 1, 1, longAgo); });
    expect(gas.autoArchive()).toBe(1);
    const status = Object.fromEntries(savesRows().map((r) => [r[7], r[8]]));
    expect(status).toEqual({ [old]: 'Archived', [kept]: 'To check', [shortlisted]: 'Shortlisted' });
    expect(gas.ageText(longAgo, new Date())).toBe('2 months ago');
    expect(gas.ageText(new Date(Date.now() - 3 * 86400000), new Date())).toBe('3 days ago');
  });

  it('setup adds the Shortlist tab and a single daily archive trigger', () => {
    gas.setup();
    expect(env.sheets.get('Shortlist').formulas['2,1']).toContain('FILTER(Saves!A2:L');
    expect(env.triggers.filter((t) => t === 'autoArchive')).toHaveLength(1);
  });
});

describe('security fixes', () => {
  it('resetToken does nothing outside the Sheets menu', () => {
    const before = env.props.get('TOKEN');
    gas.resetToken();
    expect(env.props.get('TOKEN')).toBe(before);
  });

  // Records what the script writes, before the fake strips Sheets' leading apostrophe.
  const recordWrites = (name) => {
    const sheet = env.sheets.get(name);
    const raw = [];
    const set = sheet.set.bind(sheet);
    sheet.set = (r, c, v) => { raw.push(v); set(r, c, v); };
    return raw;
  };

  it('folder names that look like formulas stay text when folders are compacted', () => {
    env.sheets.get('Folders').set(1001, 1, '=IMAGE("x")'); // as read back from the sheet
    const raw = recordWrites('Folders');
    gas.setup();
    expect(raw).toContain(`'=IMAGE("x")`);
    expect(raw).not.toContain('=IMAGE("x")');
  });

  it('renaming and cleaning folders keep formula-looking names as text', () => {
    const s = post({ action: 'save', input: 'https://www.threads.com/@a/post/X1' });
    post({ action: 'assign', id: s.id, folders: 'Ideas' });
    const raw = recordWrites('Saves');
    gas.applyFolderChange_('Ideas', '+1 Ideas');
    expect(raw).toContain("'+1 Ideas");
    env.sheets.get('Saves').set(2, 6, '=1+1, Chosen');
    raw.length = 0;
    gas.setup(); // junk-folder cleanup rewrites the Folders column
    expect(raw).toContain("'=1+1");
  });

  it('the Review page only links to web addresses and sends no referrer', () => {
    const html = gas.doGet({ parameter: { page: 'review', token } }).getContent();
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('rel="noopener noreferrer"');
    const m = html.match(/function webUrl\(u\)\{ return (\/.*?\/i)\.test/);
    const re = eval(m[1]);
    expect(re.test('https://www.threads.com/x')).toBe(true);
    expect(re.test('javascript:alert(1)')).toBe(false);
    // The page script must still parse.
    const script = html.split('<script>')[1].split('</script>')[0];
    expect(() => new Function(script)).not.toThrow();
  });
});
