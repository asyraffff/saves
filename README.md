# Saves

Folders for your Threads and TikTok saves.

Share a post from Threads or TikTok on your iPhone, tick one or more folders, done. Then browse, search and manage everything in a fast home-screen web app that syncs across devices.

- **Share sheet capture** through an iOS Shortcut ([SHORTCUT.md](SHORTCUT.md))
- **One post, many folders**, plus nested folders (`Recipes / Desserts`), emoji icons and pinning
- **Inbox** for anything you haven't filed yet
- **Post previews:** author, text or caption, and thumbnail, fetched automatically. Thumbnails are copied to storage so they don't expire.
- Search, Threads/TikTok filter, list or grid view, notes
- Sync across devices with Supabase. Each account only ever sees its own data (row-level security).

## Stack

| Part | Tech |
|---|---|
| App | React + Vite PWA ([`src/`](src)) |
| API for the Shortcut | Vercel functions ([`api/save.ts`](api/save.ts), [`api/assign.ts`](api/assign.ts)) |
| Database, login, image storage | Supabase ([`supabase/schema.sql`](supabase/schema.sql)) |

## Get started

See **[SETUP.md](SETUP.md)** (one time, about 15 min), then **[SHORTCUT.md](SHORTCUT.md)**.

## API

Both endpoints take `Authorization: Bearer <svs_ token | Supabase access token>`.

- `POST /api/save` `{ "input": "<shared text or URL>", "note"?: "…" }` saves the post (Inbox) and returns `{ id, prompt, folders: ["➕ New folder…", …], in_folders, item }`.
- `POST /api/assign` `{ "id": "…", "folders": "A\nB" | ["A","B"], "new_folder"?: "Parent / Child" }` adds the post to those folders and returns `{ message }`.

## Roadmap

- **Phase 2:** drag-to-reorder folders, bulk select/move, recently used folders first, sort options
- **Phase 3:** export/import backup, desktop "paste link" improvements
