export type Source = 'threads' | 'tiktok' | 'other';

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  emoji: string | null;
  color: string | null;
  pinned: boolean;
  position: number;
  created_at: string;
}

export interface Item {
  id: string;
  source: Source;
  url: string;
  author: string | null;
  author_name: string | null;
  text: string | null;
  thumbnail_url: string | null;
  note: string | null;
  saved_at: string;
}

export interface Link {
  item_id: string;
  folder_id: string;
}

/** Which list is showing: everything, the Inbox, or one folder. */
export type View = { kind: 'all' } | { kind: 'inbox' } | { kind: 'folder'; id: string };
