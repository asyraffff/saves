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
    expect([...env.sheets.keys()].sort()).toEqual(['Browse', 'Folders', 'Saves']);
    expect(env.sheets.get('Saves').dump()[0]).toEqual(['Saved', 'Source', 'Author', 'Text', 'Link', 'Folders', 'Note', 'ID']);
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes']);
    expect(token).toMatch(/^svs_[0-9a-f]{40}$/);
    expect(env.sheets.get('Browse').formulas['5,1']).toContain('FILTER(Saves!A2:G');
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
    expect(saved.folders).toEqual(['➕ New folder…', '⭐ Favourites', 'Ideas', 'Recipes']);
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
    expect(row[5]).toBe('Ideas, ⭐ Favourites, Recipes / Desserts');
    expect(row[3]).toBe("Let's do this. Welcome to Threads. 🔥");
    expect(folderNames()).toEqual(['⭐ Favourites', 'Ideas', 'Recipes', 'Recipes / Desserts']);
  });

  it('expands TikTok short links from share text and recognises duplicates', () => {
    const first = post({ action: 'save', input: 'Check this out! https://vm.tiktok.com/ZMabc/ #fyp' });
    expect(savesRows()[0][4]).toBe('https://www.tiktok.com/@/video/123');
    post({ action: 'assign', id: first.id, folders: 'Ideas' });
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
    [row] = savesRows();
    expect(row[2]).toBe('@chef.amir');
    expect(row[3]).toBe('Mug cake recipe');

    const again = post({ action: 'save', input: 'https://www.threads.net/@chef.amir/post/DAbC123xyz?xmt=1' });
    expect(again.existed).toBe(true);
    expect(savesRows()).toHaveLength(1);
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

  it('pure helpers', () => {
    expect(gas.renameInCell('A, A / B, C', 'A', 'Z')).toBe('Z, Z / B, C');
    expect(gas.removeFromCell('A, A / B, AB', 'A')).toBe('AB');
    expect(gas.cleanFolderName(' Recipes /Desserts, cakes › Choc ')).toBe('Recipes / Desserts cakes / Choc');
    expect(gas.splitFolders('a, b,, A')).toEqual(['a', 'b']);
  });
});
