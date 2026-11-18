import { useMemo, useState, type FormEvent } from 'react';
import Sheet from './Sheet';
import { descendantIds, flattenTree, type Library } from '../library';
import type { Folder } from '../types';

const EMOJIS = ['📁', '⭐', '💡', '🍳', '🍰', '✈️', '💪', '💼', '📚', '🎨', '🎵', '😂', '🛍️', '💻', '🏠', '❤️'];

/** Create or edit a folder: name, emoji, parent, pin, delete. */
export default function FolderEditor({
  lib,
  folder,
  defaultParent,
  onClose,
  onDeleted,
}: {
  lib: Library;
  folder?: Folder;
  defaultParent?: string | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [emoji, setEmoji] = useState(folder?.emoji ?? '');
  const [parent, setParent] = useState<string>(folder?.parent_id ?? defaultParent ?? '');
  const [pinned, setPinned] = useState(folder?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A folder can't be moved inside itself or its own subfolders.
  const parentOptions = useMemo(() => {
    const blocked = folder ? new Set([folder.id, ...descendantIds(lib.folders, folder.id)]) : new Set<string>();
    return flattenTree(lib.folders).filter((n) => !blocked.has(n.folder.id));
  }, [lib.folders, folder]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const patch = { name: name.trim(), emoji: emoji.trim() || null, parent_id: parent || null, pinned };
      if (folder) await lib.updateFolder(folder.id, patch);
      else {
        const f = await lib.createFolder(patch.name, patch.parent_id, patch.emoji);
        if (pinned) await lib.updateFolder(f.id, { pinned });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save folder (is the name already used here?)');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!folder) return;
    const subs = descendantIds(lib.folders, folder.id).size;
    const ok = window.confirm(
      `Delete “${folder.name}”${subs ? ` and its ${subs} subfolder${subs > 1 ? 's' : ''}` : ''}?\n\n` +
        'Posts are NOT deleted: they stay in their other folders, or go back to the Inbox.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await lib.deleteFolder(folder.id);
      onDeleted?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={folder ? 'Edit folder' : 'New folder'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Icon</span>
          <div className="emoji-row">
            <input
              className="emoji-input"
              value={emoji}
              maxLength={8}
              placeholder="🙂"
              onChange={(e) => setEmoji(e.target.value)}
              aria-label="Custom emoji"
            />
            {EMOJIS.map((em) => (
              <button
                type="button"
                key={em}
                className={`emoji ${emoji === em ? 'on' : ''}`}
                onClick={() => setEmoji(emoji === em ? '' : em)}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Inside</span>
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— Top level —</option>
            {parentOptions.map(({ folder: f, depth }) => (
              <option key={f.id} value={f.id}>
                {'  '.repeat(depth)}
                {f.emoji ? f.emoji + ' ' : ''}
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span>Pin to top</span>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {folder ? 'Save' : 'Create folder'}
        </button>
        {folder && (
          <button type="button" className="btn danger" onClick={remove} disabled={busy}>
            Delete folder
          </button>
        )}
      </form>
    </Sheet>
  );
}
