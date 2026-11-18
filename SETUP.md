# Setup (one time, about 10 minutes)

All you need is your Google account. Do steps 1–5 on a **computer**, because Apps Script can't be edited in the iPhone app.

## 1. Create the sheet
1. Go to <https://sheets.new>.
2. Rename it **Saves**: click "Untitled spreadsheet" at the top left.

## 2. Add the script
1. In the sheet, open **Extensions → Apps Script**. A new tab opens.
2. Click "Untitled project" and rename it **Saves**.
3. In `Code.gs`, **delete everything**. Paste the whole of [`apps-script/Code.js`](apps-script/Code.js); the raw file is at <https://raw.githubusercontent.com/asyraffff/saves/main/apps-script/Code.js>, where Ctrl+A then Ctrl+C copies it.
4. Press **Ctrl+S** to save.

## 3. Run setup and allow access
1. In the toolbar, pick **`setup`** from the function dropdown, then click **▶ Run**.
2. Google asks for permission. Click **Review permissions** and choose your account.
3. You'll see **"Google hasn't verified this app"**. That's expected, because it's your own script. Click **Advanced**, then **Go to Saves (unsafe)**, then **Allow**.
   It asks to see and edit this spreadsheet, and to fetch post details from Threads, TikTok, Instagram and YouTube.
4. The **Execution log** at the bottom shows your **Shortcut token** (`svs_…`). You can see it again any time later.

Back in the sheet tab you'll now have four tabs: **Browse**, **Shortlist**, **Saves** and **Folders**.

## 4. Publish it as a web app (for the Shortcut)
1. In Apps Script, click **Deploy** (top right), then **New deployment**.
2. Click the ⚙️ gear next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `Saves`
   - **Execute as: Me**
   - **Who has access: Anyone**
4. Click **Deploy** (approve again if asked), then **copy the Web app URL**. It ends in `/exec`.

> "Anyone" only means the Shortcut can reach it without a Google login. Every request must include your secret token, and without the token nothing is read or written.

## 5. Let a post have several folders
1. Reload the sheet. A **Saves** menu appears. **Saves → Show Shortcut token** shows your token and the Web app URL together.
2. Open the **Saves** tab and click cell **F2**. It has a dropdown arrow.
3. Open **Data → Data validation** and click the rule shown on the right.
4. Click **Advanced options** and set **If the data is invalid** to **Reject the input**. Set **Display style** to **Chip** if that option is shown.
5. Tick **Allow multiple selections** and click **Done**. It stays greyed out until step 4 is done.

## 6. On your iPhone
1. Install **Google Sheets** from the App Store and open the **Saves** sheet.
2. Build the share-sheet Shortcut using [SHORTCUT.md](SHORTCUT.md), with your Web app URL and token.

---

## Using it

**Browse tab:** your main view, sized for the phone.
- Tap the yellow **📁 Folder** cell and pick a folder, **All saves**, or **Inbox** (posts not in any folder yet). Picking `Weddings` also shows posts in `Weddings / Venue`.
- Type in the yellow **🔎 Search** cell to search text, authors, folders, notes, prices and contacts.
- **🏷️ Status** picks which posts show. **All active** hides *Not for us* and *Archived*; pick one of those to see them again.
- The sort cell next to Status offers **Newest first**, **Oldest first** or **Top rated**.
- Next to these you'll see how many posts are shown, and how many are still unsorted in the Inbox.
- Each post shows 🧵 Threads, 🎵 TikTok, 📸 Instagram, ▶️ YouTube or 🔗 another link. Tap **Open ↗** to open it in the app.

**Saving from the share sheet:**
- Works from Threads, TikTok, Instagram, YouTube, and any other link.
- Subfolders appear indented under their parent (`Weddings`, then `↳ Venue`).
- Once you have more than 8 folders, your 5 most recently used ones appear at the top, marked 🕘.
- Tick **📝 Add note…** as well as your folders to type a quick note, e.g. `free on 12 Dec`.
- Tick **🏷️ Status, rating & price…** to set those straight away. Each list has **— Skip**.
- You get the "Saved to …" notification right away. The author and text fill in a few seconds later. Instagram often hides details from Google's servers, so an Instagram post may save with only its link and author. Add a Note if you need the context.

**Saves tab:** every post, one per row. For planning (e.g. weddings), each post also has:

| Column | Use it for |
|---|---|
| **Status** | `To check` (new saves), `Shortlisted`, `Contacted`, `Booked`, `Not for us`, `Archived` |
| **Rating** | ⭐ to ⭐⭐⭐⭐⭐ |
| **Price** | Any text, e.g. `RM 15,000` or `RM 45/pax` |
| **Contact** | Phone, WhatsApp or IG handle |

- To change a post's folders, tap its **Folders** cell and tick the folders, or type `Ideas, Recipes / Desserts`.
- Add your own **Note**.
- To hide a post without deleting it, set its Status to **Archived**. To delete a post, delete its row.

**Folders tab:** your folders, one per row. These changes work on the iPhone too:

| To… | Do this |
|---|---|
| Add a folder | Type a name in an empty row. Use `/` for subfolders, e.g. `Recipes / Desserts`. |
| Rename a folder | Edit its cell. Every post and subfolder updates automatically. |
| Move a folder | Rename it with a new path, e.g. `Desserts` becomes `Food / Desserts`. |
| Delete a folder | Clear its cell. It's removed from posts; the posts themselves are kept. |
| Reorder folders | Drag the rows. The Shortcut shows folders in this order, so put favourites at the top. |

The **Posts** column counts the posts in each folder.

On a computer, the **Saves** menu also has *Rename or move folder…*, *Delete folder…* and *Fill missing post details*.

## Reviewing your saves (so they don't pile up)

### Review page on your Home Screen
1. On a computer, open the sheet and choose **Saves → Show Review page link**. Send the link to your iPhone, e.g. AirDrop it or paste it into Notes.
2. On the iPhone, open the link in **Safari**, tap **Share → Add to Home Screen**, and name it **Review**.

The link contains your token, so don't share it. If you ever use *Make a new token*, get a new link.

The page shows **one post at a time**, newest first, for every post still *To check*:
- Pick a folder at the top to review just that folder, or **📥 Inbox** for unfiled posts.
- Tap the ★ stars, type a price, contact or note, or **➕ Add to a folder**.
- Then tap **⭐ Shortlist**, **📞 Contacted**, **✅ Booked**, **👎 Not for us** or **🗄️ Archive**. The next post appears straight away.
- **⏭️ Skip** leaves it for later. **Undo** in the toast puts the last post back.
- The **⭐ Shortlist** tab lists everything Shortlisted, Contacted or Booked, grouped by folder with stars, price and contact. Use it when you're calling vendors.

### Weekly reminder
Set up the iPhone automation in [SHORTCUT.md](SHORTCUT.md#weekly-review-reminder). Every week it shows something like *"🗂️ 12 saves to review (5 Venue Tunang, 4 Attire, 3 Inbox)"* and opens the Review page.

### Auto-archive after 60 days
Every night, posts still *To check* after **60 days** are set to **Archived**. Nothing is deleted. To see them, pick **Archived** in Browse's 🏷️ Status. To run it right away, use **Saves → Archive unreviewed posts older than 60 days**.

### Shortlist tab (in the sheet)
The **Shortlist** tab lists every Shortlisted, Contacted or Booked post, grouped by folder and best rated first, with price, contact and notes. It updates by itself.

## Updating the script later
1. Paste the new code into Apps Script and save.
2. Pick **`setup`** in the function dropdown and click **▶ Run**. This applies layout changes, adds any new columns, removes junk folders (like `Chosen` or `NewFolder` from Shortcut mix-ups), and asks for any new permission. Your folders, posts and token are kept.
3. Go to **Deploy → Manage deployments**, click the ✏️ pencil, set **Version: New version**, then click **Deploy**.

Your Web app URL stays the same, so the Shortcut keeps working.

## Development

```powershell
npm install
npm test           # runs Code.js against a fake in-memory spreadsheet
npm run test:live  # checks the Threads/TikTok parsers against real pages
```

The earlier web-app version (React + Supabase + Vercel) is kept at the git tag `v0-pwa-supabase`.
