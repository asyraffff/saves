-- Saves: database schema.
-- Run this once in Supabase → SQL Editor → New query → Run.

-- ───────────────────────── Folders ─────────────────────────
create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id   uuid references public.folders(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  emoji       text,
  color       text,
  pinned      boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

-- No two sibling folders with the same name (case-insensitive).
create unique index if not exists folders_unique_sibling_name
  on public.folders (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index if not exists folders_user_idx on public.folders (user_id);

-- ───────────────────────── Items (saved posts) ─────────────────────────
create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source         text not null check (source in ('threads', 'tiktok', 'other')),
  url            text not null,
  author         text,          -- handle, e.g. "zuck"
  author_name    text,          -- display name, e.g. "Mark Zuckerberg"
  text           text,          -- post text / video caption
  thumbnail_url  text,
  note           text,
  saved_at       timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists items_user_saved_idx on public.items (user_id, saved_at desc);

-- ───────────────────────── Item ↔ Folder (many-to-many) ─────────────────────────
-- An item with no rows here is in the Inbox.
create table if not exists public.item_folders (
  item_id    uuid not null references public.items(id) on delete cascade,
  folder_id  uuid not null references public.folders(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (item_id, folder_id)
);
create index if not exists item_folders_folder_idx on public.item_folders (folder_id);

-- ───────────────────────── Shortcut access tokens ─────────────────────────
-- Only a SHA-256 hash of each token is stored.
create table if not exists public.api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash    text not null unique,
  label         text not null default 'iPhone Shortcut',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.folders      enable row level security;
alter table public.items        enable row level security;
alter table public.item_folders enable row level security;
alter table public.api_tokens   enable row level security;

drop policy if exists "own folders" on public.folders;
create policy "own folders" on public.folders for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (parent_id is null or exists (select 1 from public.folders p where p.id = parent_id and p.user_id = auth.uid()))
  );

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own item_folders" on public.item_folders;
create policy "own item_folders" on public.item_folders for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.items i   where i.id = item_id   and i.user_id = auth.uid())
    and exists (select 1 from public.folders f where f.id = folder_id and f.user_id = auth.uid())
  );

drop policy if exists "own tokens" on public.api_tokens;
create policy "own tokens" on public.api_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ───────────────────────── Thumbnail storage ─────────────────────────
-- TikTok/Threads image links expire after a few days, so the server copies
-- thumbnails here. Public-read; only the server (service role) writes.
insert into storage.buckets (id, name, public)
values ('thumbs', 'thumbs', true)
on conflict (id) do nothing;
