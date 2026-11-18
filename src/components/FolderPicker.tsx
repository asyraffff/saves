import { useMemo, useState } from 'react';
import Sheet from './Sheet';
import { flattenTree, folderLabel, type Library } from '../library';
import type { Item } from '../types';

/** Tick any number of folders for one post. Can create new folders inline. */
export default function FolderPicker({ lib, item, onClose }: { lib: Library; item: Item; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(lib.foldersByItem.get(item.id) ?? []));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const tree = useMemo(() => flattenTree(lib.folders), [lib.folders]);
  const q = query.trim().toLowerCase();
  const visible = q ? tree.filter((n) => n.folder.name.toLowerCase().includes(q)) : tree;
  const exact = q && lib.folders.some((f) => f.name.toLowerCase() === q);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function create() {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const f = await lib.createFolderPath(query);
      if (f) setSelected((s) => new Set(s).add(f.id));
      setQuery('');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await lib.setItemFolders(item.id, [...selected]);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Folders"
      onClose={onClose}
      footer={
        <>
          <span className="muted small">
            {selected.size ? `${selected.size} folder${selected.size > 1 ? 's' : ''}` : 'Inbox only'}
          </span>
          <button className="btn primary" onClick={save} disabled={busy}>
            Done
          </button>
        </>
      }
    >
      <p className="muted small clamp-2">{item.author ? `@${item.author}: ` : ''}{item.text || item.url}</p>
      <input
        className="search"
        placeholder="Search or create… (e.g. Recipes / Desserts)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !exact && void create()}
      />
      {q && !exact && (
        <button className="row-btn create" onClick={create} disabled={busy}>
          ＋ Create “{query.trim()}”
        </button>
      )}
      <ul className="pick-list">
        {visible.map(({ folder, depth }) => (
          <li key={folder.id}>
            <label className="pick-row" style={{ paddingLeft: 12 + (q ? 0 : depth * 18) }}>
              <input type="checkbox" checked={selected.has(folder.id)} onChange={() => toggle(folder.id)} />
              <span>{folderLabel(folder)}</span>
              {folder.pinned && <span className="pin">📌</span>}
            </label>
          </li>
        ))}
        {!visible.length && !q && <li className="muted small pad">No folders yet. Type a name above to create one.</li>}
      </ul>
    </Sheet>
  );
}
