# "Save to Saves" iPhone Shortcut

This Shortcut puts **Saves** in the share sheet of Threads, TikTok, Instagram, YouTube, Safari and other apps.

**What it does when you share a post:**
1. Adds a row to your sheet right away (in the **Inbox**).
2. Shows your folders. Tick as many as you like, pick **➕ New folder…**, tick **📝 Add note…** to type a note, or tick **🏷️ Status, rating & price…** to set those straight away.
3. Files the post, fills in the author and text, and shows "Saved to Recipes, Ideas".

If you cancel the folder list, the post stays in the Inbox, and you can file it later in the sheet.

You need two things from **SETUP.md**:
- **URL**: your Web app URL, ending in `/exec`
- **TOKEN**: your token, starting with `svs_`

Both are shown in the sheet under **Saves → Show Shortcut token** (on a computer), or in the Apps Script execution log.

---

## Build it (about 5 minutes, in the Shortcuts app)

Tap **＋** to start a new shortcut. Rename it to **Save to Saves**: tap the name at the top, then **Rename**.

### A. Accept shared links
1. Tap the **ⓘ** (or the name ▾ → **Details**), turn on **Show in Share Sheet**, then tap **Done**.
2. At the top, a **Receive … input from Share Sheet** block appears. Tap the input types and keep only **URLs** and **Text**.
3. Tap **If there's no input** and choose **Get Clipboard**. This lets you also run it after copying a link.

### B. Save the link
Add these actions in order. Use the search bar at the bottom to find each one.

4. **Get Contents of URL**
   - URL: your **URL**
   - Tap **▸ Show More**: Method **POST**, Request Body **JSON**, then add three **Text** fields:
     - `action` = `save`
     - `token` = your **TOKEN**
     - `input` = tap and pick the **Shortcut Input** variable
5. **Set Variable**: name `Saved`, input **Contents of URL**

### C. Pick folders
6. **Get Dictionary Value**: Get **Value** for key `folders` in **Saved**
7. **Choose from List**: list **Dictionary Value**
   - Tap **▸ Show More** and turn on **Select Multiple**. Set the Prompt to `Save to folders`.
8. **Combine Text**: **Chosen Item** with **New Lines**
9. **Set Variable**: name `Chosen`, input **Combined Text**

### D. Optional new folder
10. **Text**: leave it empty
11. **Set Variable**: name `NewFolder`, input **Text**
12. **If**: input **Chosen**, condition **contains**, text `New folder`
    - Inside the If, add **Ask for Input**: type **Text**, prompt `Folder name (use / for a subfolder, e.g. Recipes / Desserts)`
    - Still inside, add **Set Variable**: `NewFolder` = **Provided Input**
    - Leave **Otherwise** empty. **End If** is added automatically.

### E. Optional note
13. **Text**: leave it empty
14. **Set Variable**: name `Note`, input **Text** (the one from step 13)
15. **If**: input **Chosen**, condition **contains**, text `Add note`
    - Inside the If, add **Ask for Input**: type **Text**, prompt `Note (e.g. RM15k, free on 12 Dec)`
    - Still inside, add **Set Variable**: `Note` = **Provided Input**
    - Leave **Otherwise** empty.

### F. Optional status, rating and price
16. **Set Variable**: name `Status`, input **Text** (the empty one from step 13)
17. **Set Variable**: name `Rating`, input **Text** (the same one)
18. **Set Variable**: name `Price`, input **Text** (the same one)
19. **If**: input **Chosen**, condition **contains**, text `Status, rating`. Inside the If, add:
    - **Get Dictionary Value**: Get **Value** for key `statuses` in **Saved**
    - **Choose from List**: list **Dictionary Value**, Prompt `Status` (leave Select Multiple **off**)
    - **Set Variable**: `Status` = **Chosen Item**
    - **Get Dictionary Value**: Get **Value** for key `ratings` in **Saved**
    - **Choose from List**: list **Dictionary Value**, Prompt `Rating`
    - **Set Variable**: `Rating` = **Chosen Item**
    - **Ask for Input**: type **Text**, prompt `Price (e.g. RM 15,000), or leave empty`
    - **Set Variable**: `Price` = **Provided Input**
    - Leave **Otherwise** empty.

Each list starts with **— Skip**, so you can set just the rating, say, and skip the rest. Don't tap Cancel there: Cancel stops the whole Shortcut, and the post stays in the Inbox.

> Wherever a field says **Chosen**, **NewFolder**, **Note**, **Status**, **Rating**, **Price** or **Dictionary Value**, it must be the blue variable bubble. Long-press the field → **Select Variable**, then tap the variable. Typing the word as plain text makes it a folder name. If that ever happens, running `setup` again cleans those folders up.

### G. File the post
20. **Get Dictionary Value**: Get **Value** for key `id` in **Saved**
21. **Get Contents of URL**
    - URL: your **URL** (same as step 4)
    - Method **POST**, Request Body **JSON**, nine **Text** fields:
      - `action` = `assign`
      - `token` = your **TOKEN**
      - `id` = **Dictionary Value** (the one from step 20)
      - `folders` = **Chosen**
      - `new_folder` = **NewFolder**
      - `note` = **Note**
      - `status` = **Status**
      - `rating` = **Rating**
      - `price` = **Price**
22. **Get Dictionary Value**: Get **Value** for key `message` in **Contents of URL**
23. **Show Notification**: **Dictionary Value**

**Already built the Shortcut?** Add steps 16–19 right after the note's **End If**, then add the `status`, `rating` and `price` fields to your assign **Get Contents of URL**.

**Why can't I type a new folder name in the list itself?** iOS's **Choose from List** popup has no text box, so **➕ New folder…** opens a second prompt to type the name. Tip: type `Weddings / Catering` there to create a subfolder.

Tap **Done**.

---

## Use it

- **Threads:** on a post, tap the **share arrow ↗**, then **Share via…** (or **More**), then **Save to Saves**.
- **TikTok:** tap **Share**, scroll the bottom row to **More / Others** (⋯), then **Save to Saves**.
- **Tip:** in the iOS share sheet, scroll to the bottom, tap **Edit Actions…**, and add **Save to Saves** to Favourites.

The first time, iOS asks to allow the Shortcut to connect to `script.google.com`. Tap **Always Allow**.

Each save takes a few seconds, because Google's script servers need a moment to start.

## Troubleshooting

| You see | Fix |
|---|---|
| A folder list with only **⚠️ Wrong token…** | The `token` field doesn't match. Copy it again from **Saves → Show Shortcut token**. |
| **⚠️ Run Saves → Set up…** | Run `setup` in Apps Script (SETUP.md step 3). |
| **⚠️ No link found** | The app shared text without a link. Use **Copy link**, then run the Shortcut from the Shortcuts app; it reads the clipboard. |
| An HTML page or a "Page not found" error | The URL is wrong. Make sure it's the **Web app URL ending in `/exec`**, and that the deployment's access is **Anyone**. |
| Changes to the script aren't taking effect | Deploy a **new version**: Deploy → Manage deployments → ✏️ → Version: New version. |
| A post saved without its text | Threads or TikTok didn't answer Google's servers. The link and author are still saved. On a computer, **Saves → Fill missing post details** tries again, or add a Note yourself. |
