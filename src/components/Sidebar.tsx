import { useState } from 'react';
import { childrenOf, type Library } from '../library';
import type { Folder, View } from '../types';

function FolderRow({
  lib,
  folder,
  depth,
  view,
  onSelect,
  onEdit,
}: {
  lib: Library;
  folder: Folder;
  depth: number;
  view: View;
  onSelect: (v: View) => void;
  onEdit: (f: Folder) => void;
}) {
  const kids = childrenOf(lib.folders, folder.id);
  const [open, setOpen] = useState(true);
  const active = view.kind === 'folder' && view.id === folder.id;
  return (
    <li>
      <div className={`nav-row ${active ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
        <button
          className={`twisty ${kids.length ? '' : 'hidden'}`}
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        <button className="nav-main" onClick={() => onSelect({ kind: 'folder', id: folder.id })}>
          <span className="nav-icon">{folder.emoji || '📁'}</span>
          <span className="nav-name">{folder.name}</span>
          <span className="count">{lib.countByFolder.get(folder.id) ?? 0}</span>
        </button>
        <button className="icon-btn tiny" onClick={() => onEdit(folder)} aria-label={`Edit ${folder.name}`}>
          ⋯
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <FolderRow key={k.id} lib={lib} folder={k} depth={depth + 1} view={view} onSelect={onSelect} onEdit={onEdit} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Sidebar({
  lib,
  view,
  inboxCount,
  onSelect,
  onEdit,
  onNewFolder,
  onSettings,
}: {
  lib: Library;
  view: View;
  inboxCount: number;
  onSelect: (v: View) => void;
  onEdit: (f: Folder) => void;
  onNewFolder: () => void;
  onSettings: () => void;
}) {
  const pinned = lib.folders.filter((f) => f.pinned).sort((a, b) => a.name.localeCompare(b.name));
  const roots = childrenOf(lib.folders, null);
  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <img src="/icon.svg" alt="" width={28} height={28} />
        <strong>Saves</strong>
      </div>
      <ul className="nav">
        <li>
          <button className={`nav-row nav-main ${view.kind === 'all' ? 'active' : ''}`} onClick={() => onSelect({ kind: 'all' })}>
            <span className="nav-icon">🗂️</span>
            <span className="nav-name">All saves</span>
            <span className="count">{lib.items.length}</span>
          </button>
        </li>
        <li>
          <button className={`nav-row nav-main ${view.kind === 'inbox' ? 'active' : ''}`} onClick={() => onSelect({ kind: 'inbox' })}>
            <span className="nav-icon">📥</span>
            <span className="nav-name">Inbox</span>
            <span className={`count ${inboxCount ? 'hot' : ''}`}>{inboxCount}</span>
          </button>
        </li>
      </ul>

      {pinned.length > 0 && (
        <>
          <div className="nav-section">Pinned</div>
          <ul className="nav">
            {pinned.map((f) => (
              <li key={f.id}>
                <button
                  className={`nav-row nav-main ${view.kind === 'folder' && view.id === f.id ? 'active' : ''}`}
                  onClick={() => onSelect({ kind: 'folder', id: f.id })}
                >
                  <span className="nav-icon">{f.emoji || '📌'}</span>
                  <span className="nav-name">{f.name}</span>
                  <span className="count">{lib.countByFolder.get(f.id) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="nav-section">
        Folders
        <button className="icon-btn tiny" onClick={onNewFolder} aria-label="New folder">
          ＋
        </button>
      </div>
      <ul className="nav tree">
        {roots.map((f) => (
          <FolderRow key={f.id} lib={lib} folder={f} depth={0} view={view} onSelect={onSelect} onEdit={onEdit} />
        ))}
        {!roots.length && (
          <li className="muted small pad">
            No folders yet.{' '}
            <button className="link" onClick={onNewFolder}>
              Create one
            </button>
          </li>
        )}
      </ul>

      <div className="sidebar-foot">
        <button className="nav-row nav-main" onClick={onSettings}>
          <span className="nav-icon">⚙️</span>
          <span className="nav-name">Settings &amp; Shortcut</span>
        </button>
      </div>
    </nav>
  );
}
