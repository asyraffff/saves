// POST /api/save
// Body: { input: "<shared text or URL>", note?: string }
// Saves the post (to the Inbox until folders are chosen) and returns the
// folder list for the Shortcut's "Choose from List" step.
import { fetchPreview, extractUrl } from '../server/preview.js';
import {
  authenticate,
  cacheThumbnail,
  db,
  handler,
  HttpError,
  json,
  labelOf,
  loadFolders,
  NEW_FOLDER_LABEL,
  orderedFolders,
  readBody,
  shortText,
} from '../server/core.js';

export const POST = handler(async (req) => {
  const userId = await authenticate(req);
  const body = await readBody(req);
  const input = String(body.input ?? body.url ?? '').trim();
  const rawUrl = extractUrl(input);
  if (!rawUrl) throw new HttpError(400, 'No link found in what was shared.');

  const preview = await fetchPreview(rawUrl);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  const { data: existing } = await db()
    .from('items')
    .select('id, item_folders(folder_id)')
    .eq('user_id', userId)
    .eq('url', preview.url)
    .maybeSingle();

  let id: string;
  let currentFolderIds: string[] = [];
  if (existing) {
    id = existing.id;
    currentFolderIds = (existing.item_folders as { folder_id: string }[]).map((r) => r.folder_id);
    if (note) await db().from('items').update({ note }).eq('id', id);
  } else {
    const { data, error } = await db()
      .from('items')
      .insert({
        user_id: userId,
        source: preview.source,
        url: preview.url,
        author: preview.author,
        author_name: preview.author_name,
        text: preview.text,
        thumbnail_url: preview.thumbnail,
        note,
      })
      .select('id')
      .single();
    if (error) throw error;
    id = data.id;
    const stored = await cacheThumbnail(userId, id, preview.thumbnail);
    if (stored && stored !== preview.thumbnail) await db().from('items').update({ thumbnail_url: stored }).eq('id', id);
  }

  const folders = orderedFolders(await loadFolders(userId));
  const byId = new Map(folders.map((f) => [f.id, f]));
  const labels = folders.map((f) => labelOf(f, byId));
  const inLabels = currentFolderIds.map((fid) => byId.get(fid)).filter(Boolean).map((f) => labelOf(f!, byId));

  const who = preview.author ? `@${preview.author}` : preview.source === 'tiktok' ? 'TikTok' : 'Threads';
  const title = `${who}${preview.text ? ': ' + shortText(preview.text, 50) : ''}`;
  const prompt = existing
    ? `Already saved${inLabels.length ? ' in ' + inLabels.join(', ') : ' (Inbox)'}. Add to:`
    : `Save ${title} to:`;

  return json({
    id,
    existed: Boolean(existing),
    title,
    prompt,
    folders: [NEW_FOLDER_LABEL, ...labels],
    in_folders: inLabels,
    item: { ...preview, id },
  });
});
