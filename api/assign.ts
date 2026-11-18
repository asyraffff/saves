// POST /api/assign
// Body: { id: "<item id from /api/save>", folders: "Label A\nLabel B" | string[], new_folder?: "Parent / Child", note?: string }
// Adds the item to the chosen folders (existing folders are kept).
import {
  authenticate,
  db,
  ensureFolderPath,
  folderLookup,
  handler,
  HttpError,
  json,
  labelOf,
  loadFolders,
  NEW_FOLDER_LABEL,
  readBody,
} from '../server/core.js';

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(/\r?\n/);
  return [];
}

export const POST = handler(async (req) => {
  const userId = await authenticate(req);
  const body = await readBody(req);
  const id = String(body.id ?? '').trim();
  if (!id) throw new HttpError(400, 'Missing item id.');

  const { data: item } = await db().from('items').select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!item) throw new HttpError(404, 'That saved post was not found.');

  if (typeof body.note === 'string' && body.note.trim()) {
    await db().from('items').update({ note: body.note.trim() }).eq('id', id);
  }

  const folders = await loadFolders(userId);
  const lookup = folderLookup(folders);
  const chosen = toList(body.folders)
    .map((s) => s.trim())
    .filter((s) => s && s !== NEW_FOLDER_LABEL);
  const newFolder = typeof body.new_folder === 'string' ? body.new_folder.trim() : '';

  const ids = new Set<string>();
  for (const label of chosen) {
    const found = lookup.get(label.toLowerCase());
    // Unknown names are created, so typing "Recipes / Desserts" just works.
    const fid = found ?? (await ensureFolderPath(userId, label, folders));
    if (fid) ids.add(fid);
  }
  if (newFolder) {
    const fid = await ensureFolderPath(userId, newFolder, folders);
    if (fid) ids.add(fid);
  }

  if (ids.size) {
    const rows = [...ids].map((folder_id) => ({ item_id: id, folder_id, user_id: userId }));
    const { error } = await db().from('item_folders').upsert(rows, { onConflict: 'item_id,folder_id', ignoreDuplicates: true });
    if (error) throw error;
  }

  const byId = new Map(folders.map((f) => [f.id, f]));
  const names = [...ids].map((fid) => byId.get(fid)).filter(Boolean).map((f) => labelOf(f!, byId));
  return json({
    ok: true,
    folders: names,
    message: names.length ? `Saved to ${names.join(', ')}` : 'Saved to Inbox',
  });
});
