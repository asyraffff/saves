// Shared server logic for the /api functions (runs on Vercel, or inside `npm run dev`).
import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const NEW_FOLDER_LABEL = '➕ New folder…';
export const TOKEN_PREFIX = 'svs_';

// ───────── HTTP helpers ─────────

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Wraps a handler so thrown HttpErrors become JSON error responses. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, message: e.message }, e.status);
      console.error(e);
      return json({ error: 'Server error', message: 'Something went wrong saving this post.' }, 500);
    }
  };
}

/** Reads a JSON body; also accepts form bodies and plain text (treated as `input`). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  const raw = await req.text();
  if (!raw) return {};
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { input: String(parsed) };
  } catch {
    return { input: raw };
  }
}

// ───────── Supabase ─────────

let admin: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString('base64url');
}

/**
 * Who is calling? Accepts either a Shortcut token (`Bearer svs_…`)
 * or a signed-in PWA session (`Bearer <supabase access token>`).
 */
export async function authenticate(req: Request): Promise<string> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Missing access token. Check the Authorization header in your Shortcut.');

  if (token.startsWith(TOKEN_PREFIX)) {
    const { data } = await db()
      .from('api_tokens')
      .select('id, user_id')
      .eq('token_hash', hashToken(token))
      .maybeSingle();
    if (!data) throw new HttpError(401, 'This Shortcut token is invalid or was revoked. Make a new one in Saves → Settings.');
    void db().from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {});
    return data.user_id as string;
  }

  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Session expired. Please sign in again.');
  return data.user.id;
}

// ───────── Folders ─────────

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  emoji: string | null;
  pinned: boolean;
  position: number;
}

export async function loadFolders(userId: string): Promise<FolderRow[]> {
  const { data, error } = await db()
    .from('folders')
    .select('id, parent_id, name, emoji, pinned, position')
    .eq('user_id', userId);
  if (error) throw error;
  return data as FolderRow[];
}

const byOrder = (a: FolderRow, b: FolderRow) => a.position - b.position || a.name.localeCompare(b.name);

/** Folder path names, e.g. ["Recipes", "Desserts"]. */
export function pathOf(f: FolderRow, byId: Map<string, FolderRow>): string[] {
  const names: string[] = [];
  let cur: FolderRow | undefined = f;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return names;
}

export function labelOf(f: FolderRow, byId: Map<string, FolderRow>): string {
  return `${f.emoji ? f.emoji + ' ' : ''}${pathOf(f, byId).join(' / ')}`;
}

/** Folders in display order: pinned first, then depth-first tree order. */
export function orderedFolders(folders: FolderRow[]): FolderRow[] {
  const children = new Map<string | null, FolderRow[]>();
  for (const f of folders) {
    const k = f.parent_id;
    if (!children.has(k)) children.set(k, []);
    children.get(k)!.push(f);
  }
  const out: FolderRow[] = [];
  const walk = (parent: string | null) => {
    for (const f of (children.get(parent) ?? []).sort(byOrder)) {
      out.push(f);
      walk(f.id);
    }
  };
  walk(null);
  const pinned = out.filter((f) => f.pinned);
  return [...pinned, ...out.filter((f) => !f.pinned)];
}

/** Map every way a user might name a folder (with/without emoji, any case) to its id. */
export function folderLookup(folders: FolderRow[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const map = new Map<string, string>();
  for (const f of folders) {
    map.set(labelOf(f, byId).toLowerCase(), f.id);
    map.set(pathOf(f, byId).join(' / ').toLowerCase(), f.id);
  }
  return map;
}

export function splitPath(path: string): string[] {
  return path
    .split(/\s*[/›>]\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.slice(0, 80));
}

/** Find or create a folder from a path like "Recipes / Desserts". Returns its id. */
export async function ensureFolderPath(userId: string, path: string, folders: FolderRow[]): Promise<string | null> {
  const parts = splitPath(path);
  if (!parts.length) return null;
  let parent: string | null = null;
  for (const name of parts) {
    const existing = folders.find(
      (f) => f.parent_id === parent && f.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      parent = existing.id;
      continue;
    }
    const res = await db()
      .from('folders')
      .insert({ user_id: userId, parent_id: parent, name, position: Date.now() })
      .select('id, parent_id, name, emoji, pinned, position')
      .single();
    if (res.error) throw res.error;
    const created = res.data as FolderRow;
    folders.push(created);
    parent = created.id;
  }
  return parent;
}

// ───────── Thumbnails ─────────

/** Copy a (soon-to-expire) CDN thumbnail into Supabase Storage. Returns the stored URL or the original. */
export async function cacheThumbnail(userId: string, itemId: string, src: string | null): Promise<string | null> {
  if (!src) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) return src;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return src;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 5_000_000) return src;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('heic') ? 'heic' : 'jpg';
    const path = `${userId}/${itemId}.${ext}`;
    const { error } = await db().storage.from('thumbs').upload(path, buf, { contentType: type, upsert: true });
    if (error) return src;
    return db().storage.from('thumbs').getPublicUrl(path).data.publicUrl;
  } catch {
    return src;
  }
}

export function shortText(s: string | null | undefined, n = 60): string {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1).trimEnd() + '…' : one;
}
