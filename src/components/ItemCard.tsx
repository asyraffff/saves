import { useState } from 'react';
import { folderLabel } from '../library';
import type { Folder, Item } from '../types';

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function SourceBadge({ source }: { source: Item['source'] }) {
  const label = source === 'threads' ? 'Threads' : source === 'tiktok' ? 'TikTok' : 'Link';
  return <span className={`badge ${source}`}>{label}</span>;
}

export default function ItemCard({
  item,
  folders,
  grid,
  onMenu,
  onFolders,
  onOpenFolder,
}: {
  item: Item;
  folders: Folder[];
  grid: boolean;
  onMenu: () => void;
  onFolders: () => void;
  onOpenFolder: (id: string) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const who = item.author ? `@${item.author}` : item.author_name || new URL(item.url).hostname;

  return (
    <article className={`item ${grid ? 'grid' : 'list'}`}>
      <a className="item-main" href={item.url} target="_blank" rel="noreferrer">
        <div className={`thumb ${item.source}`}>
          {item.thumbnail_url && imgOk ? (
            <img src={item.thumbnail_url} alt="" loading="lazy" onError={() => setImgOk(false)} />
          ) : (
            <span className="thumb-fallback">{item.source === 'tiktok' ? '♪' : item.source === 'threads' ? '@' : '🔗'}</span>
          )}
        </div>
        <div className="item-body">
          <div className="item-meta">
            <SourceBadge source={item.source} />
            <span className="who">{who}</span>
            <span className="muted">· {timeAgo(item.saved_at)}</span>
          </div>
          {item.text && <p className={`item-text ${grid ? 'clamp-2' : 'clamp-3'}`}>{item.text}</p>}
          {!item.text && !grid && <p className="item-text muted small">{item.url}</p>}
          {item.note && <p className="item-note clamp-2">📝 {item.note}</p>}
        </div>
      </a>
      <div className="item-foot">
        <div className="chips">
          {folders.length ? (
            folders.map((f) => (
              <button key={f.id} className="chip" onClick={() => onOpenFolder(f.id)}>
                {folderLabel(f)}
              </button>
            ))
          ) : (
            <span className="chip inbox">Inbox</span>
          )}
          <button className="chip add" onClick={onFolders} aria-label="Change folders">
            ＋
          </button>
        </div>
        <button className="icon-btn" onClick={onMenu} aria-label="More">
          ⋯
        </button>
      </div>
    </article>
  );
}
