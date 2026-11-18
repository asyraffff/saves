import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import type { Folder, Item, Link } from './types';

// ───────── Folder tree helpers ─────────

export interface TreeNode {
  folder: Folder;
  depth: number;
}

const byOrder = (a: Folder, b: Folder) => a.position - b.position || a.name.localeCompare(b.name);

export function childrenOf(folders: Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => f.parent_id === parentId).sort(byOrder);
}

/** Depth-first list of folders with their nesting depth. */
export function flattenTree(folders: Folder[], parentId: string | null = null, depth = 0): TreeNode[] {
  return childrenOf(folders, parentId).flatMap((f) => [{ folder: f, depth }, ...flattenTree(folders, f.id, depth + 1)]);
}

export function descendantIds(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const f of folders) if (f.parent_id === pid && !out.has(f.id)) {
      out.add(f.id);
      walk(f.id);
    }
  };
  walk(id);
  return out;
}

export function folderPath(folders: Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  let cur = byId.get(id);
  while (cur && !out.includes(cur)) {
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

export function folderLabel(f: Folder) {
  return `${f.emoji ? f.emoji + ' ' : ''}${f.name}`;
}

// ───────── Data loading ─────────

async function fetchAll<T>(table: string, columns: string, order?: string): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(columns).range(from, from + page - 1);
    if (order) q = q.order(order, { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < page) return out;
  }
}

export async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `Request failed (${res.status})`);
  return json as T;
}

export function useLibrary(userId: string) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [f, i, l] = await Promise.all([
        fetchAll<Folder>('folders', '*'),
        fetchAll<Item>('items', '*', 'saved_at'),
        fetchAll<Link>('item_folders', 'item_id, folder_id'),
      ]);
      setFolders(f);
      setItems(i);
      setLinks(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Pick up posts saved from the Shortcut whenever the app comes back to the foreground.
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload, userId]);

  const foldersByItem = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of links) {
      if (!m.has(l.item_id)) m.set(l.item_id, new Set());
      m.get(l.item_id)!.add(l.folder_id);
    }
    return m;
  }, [links]);

  const countByFolder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.folder_id, (m.get(l.folder_id) ?? 0) + 1);
    return m;
  }, [links]);

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
    setError(msg);
    throw e;
  };

  // ───────── Folder actions ─────────

  async function createFolder(name: string, parentId: string | null = null, emoji: string | null = null): Promise<Folder> {
    const existing = folders.find(
      (f) => f.parent_id === parentId && f.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (existing) return existing;
    const { data, error } = await supabase
      .from('folders')
      .insert({ user_id: userId, name: name.trim(), parent_id: parentId, emoji, position: Date.now() })
      .select('*')
      .single();
    if (error) fail(error);
    setFolders((fs) => [...fs, data as Folder]);
    return data as Folder;
  }

  /** "Recipes / Desserts" → creates any missing folders, returns the last one. */
  async function createFolderPath(path: string): Promise<Folder | null> {
    const parts = path.split(/\s*[/›>]\s*/).map((p) => p.trim()).filter(Boolean);
    let parent: Folder | null = null;
    let known = folders;
    for (const name of parts) {
      const found = known.find(
        (f) => f.parent_id === (parent?.id ?? null) && f.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (found) {
        parent = found;
        continue;
      }
      const { data, error } = await supabase
        .from('folders')
        .insert({ user_id: userId, name, parent_id: parent?.id ?? null, position: Date.now() })
        .select('*')
        .single();
      if (error) fail(error);
      const created = data as Folder;
      known = [...known, created];
      setFolders((fs) => [...fs, created]);
      parent = created;
    }
    return parent;
  }

  async function updateFolder(id: string, patch: Partial<Pick<Folder, 'name' | 'emoji' | 'parent_id' | 'pinned' | 'color'>>) {
    const { error } = await supabase.from('folders').update(patch).eq('id', id);
    if (error) fail(error);
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function deleteFolder(id: string) {
    const gone = new Set([id, ...descendantIds(folders, id)]);
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) fail(error);
    setFolders((fs) => fs.filter((f) => !gone.has(f.id)));
    setLinks((ls) => ls.filter((l) => !gone.has(l.folder_id)));
  }

  // ───────── Item actions ─────────

  /** Replace an item's folders with exactly `folderIds`. */
  async function setItemFolders(itemId: string, folderIds: string[]) {
    const current = foldersByItem.get(itemId) ?? new Set<string>();
    const next = new Set(folderIds);
    const add = [...next].filter((f) => !current.has(f));
    const remove = [...current].filter((f) => !next.has(f));
    if (add.length) {
      const { error } = await supabase
        .from('item_folders')
        .upsert(add.map((folder_id) => ({ item_id: itemId, folder_id, user_id: userId })), { ignoreDuplicates: true });
      if (error) fail(error);
    }
    if (remove.length) {
      const { error } = await supabase.from('item_folders').delete().eq('item_id', itemId).in('folder_id', remove);
      if (error) fail(error);
    }
    setLinks((ls) => [
      ...ls.filter((l) => l.item_id !== itemId),
      ...[...next].map((folder_id) => ({ item_id: itemId, folder_id })),
    ]);
  }

  async function updateItem(id: string, patch: Partial<Pick<Item, 'note' | 'text'>>) {
    const { error } = await supabase.from('items').update(patch).eq('id', id);
    if (error) fail(error);
    setItems((is) => is.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function deleteItem(id: string) {
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) fail(error);
    setItems((is) => is.filter((i) => i.id !== id));
    setLinks((ls) => ls.filter((l) => l.item_id !== id));
  }

  /** Save a pasted link through the same endpoint the Shortcut uses. */
  async function addLink(input: string): Promise<Item> {
    const res = await apiFetch<{ item: Item & { thumbnail: string | null } }>('/api/save', { input });
    await reload();
    return { ...res.item, thumbnail_url: res.item.thumbnail, note: null, saved_at: new Date().toISOString() };
  }

  return {
    folders,
    items,
    links,
    loading,
    error,
    clearError: () => setError(null),
    reload,
    foldersByItem,
    countByFolder,
    createFolder,
    createFolderPath,
    updateFolder,
    deleteFolder,
    setItemFolders,
    updateItem,
    deleteItem,
    addLink,
  };
}

export type Library = ReturnType<typeof useLibrary>;
