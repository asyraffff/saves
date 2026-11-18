import { describe, expect, it } from 'vitest';
import {
  detectSource,
  extractUrl,
  normalizeUrl,
  parseThreadsHtml,
  parseTikTokHtml,
} from '../server/preview';
import { folderLookup, labelOf, orderedFolders, splitPath, type FolderRow } from '../server/core';

describe('extractUrl', () => {
  it('finds a URL inside TikTok share text', () => {
    expect(extractUrl('Check out this video! https://vm.tiktok.com/ZMabc123/ #fyp')).toBe('https://vm.tiktok.com/ZMabc123/');
  });
  it('strips trailing punctuation', () => {
    expect(extractUrl('(see https://www.threads.com/@a/post/XYZ).')).toBe('https://www.threads.com/@a/post/XYZ');
  });
  it('returns null without a link', () => {
    expect(extractUrl('no link here')).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('canonicalises threads.net and strips tracking params', () => {
    expect(normalizeUrl('https://www.threads.net/@zuck/post/CuP48CiS5sx?xmt=AQGz&slof=1')).toBe(
      'https://www.threads.com/@zuck/post/CuP48CiS5sx',
    );
  });
  it('strips TikTok share params', () => {
    expect(normalizeUrl('https://www.tiktok.com/@tiktok/video/7106594312292453675?_r=1&u_code=x')).toBe(
      'https://www.tiktok.com/@tiktok/video/7106594312292453675',
    );
  });
  it('detects sources', () => {
    expect(detectSource('https://threads.com/@a')).toBe('threads');
    expect(detectSource('https://vm.tiktok.com/x')).toBe('tiktok');
    expect(detectSource('https://example.com')).toBe('other');
  });
});

describe('parsers', () => {
  it('reads Threads Open Graph tags', () => {
    const html = `<meta property="og:title" content="Mark Zuckerberg (&#064;zuck) on Threads" />
      <meta property="og:description" content="Let&#039;s do this. Welcome to Threads. &#x1f525;" />
      <meta property="og:image" content="https://cdn.example/p.jpg?a=1&amp;b=2" />`;
    expect(parseThreadsHtml(html, 'https://www.threads.com/@zuck/post/CuP48CiS5sx')).toEqual({
      author: 'zuck',
      author_name: 'Mark Zuckerberg',
      text: "Let's do this. Welcome to Threads. 🔥",
      thumbnail: 'https://cdn.example/p.jpg?a=1&b=2',
    });
  });
  it('ignores the Threads login page', () => {
    const html = `<meta property="og:title" content="Threads &#x2022; Log in" />`;
    expect(parseThreadsHtml(html, 'https://www.threads.com/@a/post/B').text).toBeNull();
  });
  it('reads TikTok embedded JSON', () => {
    const data = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          itemInfo: {
            itemStruct: { id: '123', desc: 'frogs 🐸', author: { uniqueId: 'tiktok', nickname: 'TikTok' }, video: { cover: 'https://c/1.jpg' } },
          },
        },
      },
    };
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>`;
    expect(parseTikTokHtml(html)).toEqual({
      author: 'tiktok',
      author_name: 'TikTok',
      text: 'frogs 🐸',
      thumbnail: 'https://c/1.jpg',
      canonical: 'https://www.tiktok.com/@tiktok/video/123',
    });
  });
});

describe('folder labels', () => {
  const folders: FolderRow[] = [
    { id: 'r', parent_id: null, name: 'Recipes', emoji: '🍳', pinned: false, position: 2 },
    { id: 'd', parent_id: 'r', name: 'Desserts', emoji: null, pinned: false, position: 1 },
    { id: 'i', parent_id: null, name: 'Ideas', emoji: null, pinned: true, position: 3 },
  ];
  const byId = new Map(folders.map((f) => [f.id, f]));
  it('builds full path labels', () => {
    expect(labelOf(folders[1], byId)).toBe('Recipes / Desserts');
    expect(labelOf(folders[0], byId)).toBe('🍳 Recipes');
  });
  it('orders pinned first, then tree order', () => {
    expect(orderedFolders(folders).map((f) => f.id)).toEqual(['i', 'r', 'd']);
  });
  it('looks up by label or plain path, any case', () => {
    const map = folderLookup(folders);
    expect(map.get('🍳 recipes')).toBe('r');
    expect(map.get('recipes / desserts')).toBe('d');
  });
  it('splits typed paths', () => {
    expect(splitPath(' Recipes /Desserts › Cakes ')).toEqual(['Recipes', 'Desserts', 'Cakes']);
  });
});
