import { useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { childrenOf, folderLabel, folderPath, useLibrary } from '../library';
import type { Folder, Item, Source, View } from '../types';
import Sidebar from './Sidebar';
import ItemCard from './ItemCard';
import FolderPicker from './FolderPicker';
import FolderEditor from './FolderEditor';
import Settings from './Settings';
import Sheet from './Sheet';

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

type Modal =
  | { kind: 'picker'; item: Item }
  | { kind: 'menu'; item: Item }
  | { kind: 'note'; item: Item }
  | { kind: 'folder'; folder?: Folder; parent?: string | null }
  | { kind: 'add' }
  | { kind: 'settings' }
  | null;

export default function Home({ session }: { session: Session }) {
  const lib = useLibrary(session.user.id);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source | 'any'>('any');
  const [grid, setGrid] = useState(() => readPref('saves.grid', '0') === '1');
  const [modal, setModal] = useState<Modal>(null);

  const folderById = useMemo(() => new Map(lib.folders.map((f) => [f.id, f])), [lib.folders]);
  const inboxCount = useMemo(() => lib.items.filter((i) => !lib.foldersByItem.get(i.id)?.size).length, [lib.items, lib.foldersByItem]);

  const currentFolder = view.kind === 'folder' ? folderById.get(view.id) : undefined;
  if (view.kind === 'folder' && !currentFolder && !lib.loading) setView({ kind: 'all' });

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lib.items.filter((i) => {
      const fs = lib.foldersByItem.get(i.id);
      if (view.kind === 'inbox' && fs?.size) return false;
      if (view.kind === 'folder' && !fs?.has(view.id)) return false;
      if (source !== 'any' && i.source !== source) return false;
      if (!q) return true;
      const folderNames = [...(fs ?? [])].map((id) => folderById.get(id)?.name ?? '').join(' ');
      return [i.text, i.author, i.author_name, i.note, i.url, folderNames].some((s) => s?.toLowerCase().includes(q));
    });
  }, [lib.items, lib.foldersByItem, view, source, query, folderById]);

  const subfolders = view.kind === 'folder' ? childrenOf(lib.folders, view.id) : [];
  const title = view.kind === 'all' ? 'All saves' : view.kind === 'inbox' ? 'Inbox' : currentFolder ? folderLabel(currentFolder) : '';
  const crumbs = currentFolder ? folderPath(lib.folders, currentFolder.id).slice(0, -1) : [];

  const select = (v: View) => {
    setView(v);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className={`app ${drawer ? 'drawer-open' : ''}`}>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
      <Sidebar
        lib={lib}
        view={view}
        inboxCount={inboxCount}
        onSelect={select}
        onEdit={(f) => setModal({ kind: 'folder', folder: f })}
        onNewFolder={() => setModal({ kind: 'folder', parent: null })}
        onSettings={() => {
          setDrawer(false);
          setModal({ kind: 'settings' });
        }}
      />

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Folders">
            ☰
          </button>
          <div className="title-wrap">
            {crumbs.length > 0 && (
              <div className="crumbs">
                {crumbs.map((c) => (
                  <button key={c.id} className="link" onClick={() => select({ kind: 'folder', id: c.id })}>
                    {c.name} ›
                  </button>
                ))}
              </div>
            )}
            <h1 className="title">{title}</h1>
          </div>
          {currentFolder && (
            <button className="icon-btn" onClick={() => setModal({ kind: 'folder', folder: currentFolder })} aria-label="Edit folder">
              ✎
            </button>
          )}
          <button className="btn primary small" onClick={() => setModal({ kind: 'add' })}>
            ＋ Add
          </button>
        </header>

        <div className="toolbar">
          <input className="search" type="search" placeholder="Search saves…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="seg">
            {(['any', 'threads', 'tiktok'] as const).map((s) => (
              <button key={s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>
                {s === 'any' ? 'All' : s === 'threads' ? 'Threads' : 'TikTok'}
              </button>
            ))}
          </div>
          <button
            className="icon-btn"
            onClick={() => {
              setGrid(!grid);
              writePref('saves.grid', grid ? '0' : '1');
            }}
            aria-label={grid ? 'List view' : 'Grid view'}
            title={grid ? 'List view' : 'Grid view'}
          >
            {grid ? '☰' : '▦'}
          </button>
        </div>

        {lib.error && (
          <div className="banner error" onClick={lib.clearError}>
            {lib.error} <span className="muted small">(tap to dismiss)</span>
          </div>
        )}

        {(subfolders.length > 0 || currentFolder) && (
          <div className="subfolders">
            {subfolders.map((f) => (
              <button key={f.id} className="subfolder" onClick={() => select({ kind: 'folder', id: f.id })}>
                <span>{f.emoji || '📁'}</span>
                <span className="nav-name">{f.name}</span>
                <span className="count">{lib.countByFolder.get(f.id) ?? 0}</span>
              </button>
            ))}
            {currentFolder && (
              <button className="subfolder ghost" onClick={() => setModal({ kind: 'folder', parent: currentFolder.id })}>
                ＋ Subfolder
              </button>
            )}
          </div>
        )}

        {lib.loading ? (
          <p className="muted pad">Loading…</p>
        ) : visibleItems.length ? (
          <div className={grid ? 'items grid' : 'items list'}>
            {visibleItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                grid={grid}
                folders={[...(lib.foldersByItem.get(item.id) ?? [])].map((id) => folderById.get(id)).filter((f): f is Folder => !!f)}
                onMenu={() => setModal({ kind: 'menu', item })}
                onFolders={() => setModal({ kind: 'picker', item })}
                onOpenFolder={(id) => select({ kind: 'folder', id })}
              />
            ))}
          </div>
        ) : (
          <Empty view={view} hasQuery={!!query || source !== 'any'} noItems={!lib.items.length} onSettings={() => setModal({ kind: 'settings' })} />
        )}
      </main>

      {modal?.kind === 'picker' && <FolderPicker lib={lib} item={modal.item} onClose={() => setModal(null)} />}
      {modal?.kind === 'folder' && (
        <FolderEditor
          lib={lib}
          folder={modal.folder}
          defaultParent={modal.parent}
          onClose={() => setModal(null)}
          onDeleted={() => setView({ kind: 'all' })}
        />
      )}
      {modal?.kind === 'settings' && <Settings session={session} onClose={() => setModal(null)} />}
      {modal?.kind === 'menu' && (
        <ItemMenu
          item={modal.item}
          onClose={() => setModal(null)}
          onFolders={() => setModal({ kind: 'picker', item: modal.item })}
          onNote={() => setModal({ kind: 'note', item: modal.item })}
          onDelete={async () => {
            if (window.confirm('Delete this save from every folder?')) {
              await lib.deleteItem(modal.item.id);
              setModal(null);
            }
          }}
        />
      )}
      {modal?.kind === 'note' && (
        <NoteEditor
          item={modal.item}
          onClose={() => setModal(null)}
          onSave={async (note) => {
            await lib.updateItem(modal.item.id, { note: note || null });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'add' && (
        <AddLink
          onClose={() => setModal(null)}
          onAdd={async (input) => {
            const item = await lib.addLink(input);
            // Adding while inside a folder puts it there; then let the user pick more.
            if (view.kind === 'folder' && !lib.foldersByItem.get(item.id)?.has(view.id)) {
              await lib.setItemFolders(item.id, [...(lib.foldersByItem.get(item.id) ?? []), view.id]);
            }
            setModal({ kind: 'picker', item });
          }}
        />
      )}
    </div>
  );
}

function Empty({ view, hasQuery, noItems, onSettings }: { view: View; hasQuery: boolean; noItems: boolean; onSettings: () => void }) {
  if (hasQuery) return <p className="muted pad">No saves match.</p>;
  if (noItems)
    return (
      <div className="empty">
        <div className="empty-icon">🔖</div>
        <h2>Nothing saved yet</h2>
        <p className="muted">
          Set up the iPhone Shortcut, then tap <strong>Share</strong> on any Threads or TikTok post and choose{' '}
          <strong>Save to Saves</strong>.
        </p>
        <button className="btn primary" onClick={onSettings}>
          Set up the Shortcut
        </button>
      </div>
    );
  if (view.kind === 'inbox') return <p className="muted pad">Inbox zero 🎉 Everything is in a folder.</p>;
  return <p className="muted pad">This folder is empty.</p>;
}

function ItemMenu({
  item,
  onClose,
  onFolders,
  onNote,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onFolders: () => void;
  onNote: () => void;
  onDelete: () => void;
}) {
  return (
    <Sheet title={item.author ? `@${item.author}` : 'Saved post'} onClose={onClose}>
      <div className="menu">
        <a className="row-btn" href={item.url} target="_blank" rel="noreferrer" onClick={onClose}>
          ↗ Open in {item.source === 'tiktok' ? 'TikTok' : item.source === 'threads' ? 'Threads' : 'browser'}
        </a>
        <button className="row-btn" onClick={onFolders}>
          📁 Folders…
        </button>
        <button className="row-btn" onClick={onNote}>
          📝 {item.note ? 'Edit note' : 'Add note'}
        </button>
        <button
          className="row-btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(item.url);
            } catch {
              window.prompt('Copy link:', item.url);
            }
            onClose();
          }}
        >
          🔗 Copy link
        </button>
        <button className="row-btn danger" onClick={onDelete}>
          🗑 Delete save
        </button>
      </div>
    </Sheet>
  );
}

function NoteEditor({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (n: string) => Promise<void> }) {
  const [note, setNote] = useState(item.note ?? '');
  return (
    <Sheet title="Note" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(note.trim());
        }}
      >
        <textarea autoFocus rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why did you save this?" />
        <button className="btn primary">Save note</button>
      </form>
    </Sheet>
  );
}

function AddLink({ onClose, onAdd }: { onClose: () => void; onAdd: (input: string) => Promise<void> }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Add a link" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">Paste a Threads or TikTok link (or any link).</p>
        <input
          autoFocus
          required
          inputMode="url"
          placeholder="https://www.threads.com/@…/post/…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Fetching post…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}
