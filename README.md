# Saves

Folders for your Threads and TikTok saves, in a Google Sheet.

Share a post from Threads or TikTok on your iPhone, tick one or more folders, done. Your saves live in a Google Sheet that you browse in the Google Sheets app. There's nothing to host and no other accounts.

- **Share-sheet capture** with an iOS Shortcut ([SHORTCUT.md](SHORTCUT.md))
- **One post, many folders**, plus subfolders (`Recipes / Desserts`)
- **Inbox** for anything not filed yet
- **Browse tab:** pick a folder or search, and the matching posts appear
- **Folder management that works on the phone:** rename a folder cell to rename it everywhere, clear it to remove it, drag rows to reorder
- **Post details:** author and text or caption, fetched automatically
- Syncs everywhere your Google account does

## How it fits together

```
iPhone share sheet ──► Shortcut ──► Apps Script web app (apps-script/Code.js) ──► Google Sheet
                                                                                  ├─ Browse   (pick a folder / search)
                                                                                  ├─ Saves    (one row per post)
                                                                                  └─ Folders  (your folder list)
```

## Get started

1. **[SETUP.md](SETUP.md)**: create the sheet and paste the script (about 10 min)
2. **[SHORTCUT.md](SHORTCUT.md)**: build the share-sheet Shortcut (about 5 min)

## Web app API

`POST <Web app URL>` with a JSON body. Every call needs `"token"`.

- `{"action":"save","input":"<shared text or URL>"}` saves the post to the Inbox and returns `{id, prompt, folders:["➕ New folder…", …], in_folders}`.
- `{"action":"assign","id":"…","folders":"A\nB","new_folder":"Parent / Child"}` adds those folders and returns `{message}`.
- `{"action":"folders"}` returns `{folders}`.

On an error, the response has `error: true`, and the message is also placed in `folders`, so it shows up in the Shortcut's list.

## Development

```powershell
npm install
npm test           # Code.js against an in-memory fake of SpreadsheetApp/UrlFetchApp
npm run test:live  # parsers against real Threads/TikTok pages
```

The earlier web-app version (React PWA + Supabase + Vercel) is at the git tag `v0-pwa-supabase`.
