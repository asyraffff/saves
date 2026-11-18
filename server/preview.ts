// Turns whatever the share sheet hands us (a URL, or text containing one)
// into a clean URL plus post details (author, text, thumbnail).

export type Source = 'threads' | 'tiktok' | 'other';

export interface Preview {
  source: Source;
  url: string;
  author: string | null;
  author_name: string | null;
  text: string | null;
  thumbnail: string | null;
}

const UA = 'Mozilla/5.0 (compatible; SavesBot/1.0; +https://github.com/asyraffff/saves)';
const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Pull the first http(s) URL out of shared text ("Check this out! https://vm.tiktok.com/xyz/"). */
export function extractUrl(input: string): string | null {
  const m = input.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  return m[0].replace(/[),.!?]+$/, '');
}

export function detectSource(url: string): Source {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (/(^|\.)threads\.(net|com)$/.test(host)) return 'threads';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  return 'other';
}

/** Canonical form so the same post shared twice is recognised as a duplicate. */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  const source = detectSource(url);
  if (source === 'threads') {
    // threads.net/@user/post/CODE?xmt=... → https://www.threads.com/@user/post/CODE
    const m = u.pathname.match(/^\/(@[^/]+)\/post\/([A-Za-z0-9_-]+)/);
    if (m) return `https://www.threads.com/${m[1]}/post/${m[2]}`;
    return `https://www.threads.com${u.pathname.replace(/\/$/, '')}`;
  }
  if (source === 'tiktok') {
    const m = u.pathname.match(/^\/(@[^/]*)\/(video|photo)\/(\d+)/);
    if (m) return `https://www.tiktok.com/${m[1]}/${m[2]}/${m[3]}`;
    return `${u.origin}${u.pathname}`;
  }
  u.hash = '';
  return u.toString();
}

export function threadsAuthorFromUrl(url: string): string | null {
  const m = new URL(url).pathname.match(/^\/@([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ───────── HTML helpers ─────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function metaTag(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop.replace(/[:.]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** Parse a Threads post page's Open Graph tags. */
export function parseThreadsHtml(html: string, url: string): Omit<Preview, 'source' | 'url'> {
  const handle = threadsAuthorFromUrl(url);
  const title = metaTag(html, 'og:title'); // "Mark Zuckerberg (@zuck) on Threads"
  const description = metaTag(html, 'og:description');
  const image = metaTag(html, 'og:image');
  const isLoginPage = !title || /log in/i.test(title) || !/on Threads/i.test(title);
  if (isLoginPage) return { author: handle, author_name: null, text: null, thumbnail: null };
  const nameMatch = title.match(/^(.*?)\s*\(@[^)]+\)\s+on Threads/i);
  return {
    author: handle,
    author_name: nameMatch ? nameMatch[1].trim() || null : null,
    text: description?.trim() || null,
    thumbnail: image || null,
  };
}

interface TikTokItem {
  id?: string;
  desc?: string;
  author?: { uniqueId?: string; nickname?: string };
  video?: { cover?: string; originCover?: string };
  imagePost?: { cover?: { imageURL?: { urlList?: string[] } } };
}

/** Find the video object (has `desc` and `author.uniqueId`) anywhere in TikTok's page data. */
function findItemStruct(node: unknown, depth = 0): TikTokItem | null {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  const o = node as Record<string, unknown>;
  const direct = (o.itemInfo as { itemStruct?: TikTokItem } | undefined)?.itemStruct;
  if (direct?.author?.uniqueId) return direct;
  if (typeof o.desc === 'string' && (o.author as TikTokItem['author'])?.uniqueId && o.video) return o as TikTokItem;
  for (const v of Object.values(o)) {
    const found = findItemStruct(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Parse a TikTok video page's embedded JSON. */
export function parseTikTokHtml(html: string): Omit<Preview, 'source' | 'url'> & { canonical: string | null } {
  const empty = { author: null, author_name: null, text: null, thumbnail: null, canonical: null };
  // TikTok serves the post data in different <script> blocks depending on the client.
  for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'api-data', 'SIGI_STATE']) {
    const m = html.match(new RegExp(`<script[^>]+id="${id}"[^>]*>([\\s\\S]*?)</script>`));
    if (!m) continue;
    try {
      const item = findItemStruct(JSON.parse(m[1]));
      if (item) {
        const handle: string | null = item.author?.uniqueId ?? null;
        return {
          author: handle,
          author_name: item.author?.nickname ?? null,
          text: item.desc?.trim() || null,
          thumbnail: item.video?.originCover || item.video?.cover || item.imagePost?.cover?.imageURL?.urlList?.[0] || null,
          canonical: handle && item.id ? `https://www.tiktok.com/@${handle}/video/${item.id}` : null,
        };
      }
    } catch {
      /* try the next block, then Open Graph */
    }
  }
  const title = metaTag(html, 'og:title');
  return {
    ...empty,
    text: metaTag(html, 'og:description') || title,
    thumbnail: metaTag(html, 'og:image'),
  };
}

// ───────── Network ─────────

async function fetchText(url: string, ua: string, timeoutMs = 8000): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return { html: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Resolve vm.tiktok.com / vt.tiktok.com / tiktok.com/t/ short links to the full video URL. */
async function expandTikTok(url: string): Promise<string> {
  const host = new URL(url).hostname;
  const isShort = /^(vm|vt)\./.test(host) || new URL(url).pathname.startsWith('/t/');
  if (!isShort) return url;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': BROWSER_UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
    });
    const loc = res.headers.get('location');
    if (loc) return new URL(loc, url).toString();
  } catch {
    /* keep the short link */
  }
  return url;
}

export async function fetchPreview(rawUrl: string): Promise<Preview> {
  const source = detectSource(rawUrl);

  if (source === 'threads') {
    const url = normalizeUrl(rawUrl);
    const page = await fetchText(url, UA);
    const parsed = page && !page.finalUrl.includes('error=')
      ? parseThreadsHtml(page.html, url)
      : { author: threadsAuthorFromUrl(url), author_name: null, text: null, thumbnail: null };
    return { source, url, ...parsed };
  }

  if (source === 'tiktok') {
    const expanded = await expandTikTok(rawUrl);
    let url = normalizeUrl(expanded);
    let parsed: ReturnType<typeof parseTikTokHtml> | null = null;
    for (const ua of [UA, BROWSER_UA]) {
      const page = await fetchText(url, ua);
      if (!page) continue;
      parsed = parseTikTokHtml(page.html);
      if (parsed.text || parsed.author) break;
    }
    if (!parsed) return { source, url, author: authorFromTikTokUrl(url), author_name: null, text: null, thumbnail: null };
    const { canonical, ...rest } = parsed;
    if (canonical) url = canonical;
    return { source, url, ...rest, author: rest.author ?? authorFromTikTokUrl(url) };
  }

  const url = normalizeUrl(rawUrl);
  const page = await fetchText(url, UA);
  return {
    source,
    url,
    author: null,
    author_name: page ? metaTag(page.html, 'og:site_name') : null,
    text: page ? metaTag(page.html, 'og:title') || metaTag(page.html, 'og:description') : null,
    thumbnail: page ? metaTag(page.html, 'og:image') : null,
  };
}

function authorFromTikTokUrl(url: string): string | null {
  const m = new URL(url).pathname.match(/^\/@([^/]+)/);
  return m && m[1] ? m[1] : null;
}
