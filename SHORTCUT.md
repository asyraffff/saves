# "Save to Saves" iPhone Shortcut

This Shortcut puts **Saves** in the share sheet of Threads, TikTok, Safari and any other app.

**What it does when you share a post:**
1. Saves the link right away, to your **Inbox**.
2. Shows your folders. Tick as many as you like, or pick **➕ New folder…**.
3. Files the post and shows "Saved to Recipes, Ideas".

If you cancel the folder list, the post stays safely in the Inbox, and you can file it later in the app.

You need:
- **App address**, e.g. `https://saves-xxxx.vercel.app`
- **Token**, starting with `svs_`, from **Saves → Settings & Shortcut → Create Shortcut token**

Below, replace `APP` with your app address and `TOKEN` with your token.

---

## Build it (about 5 minutes, in the Shortcuts app)

Tap **＋** to start a new shortcut. Rename it to **Save to Saves**: tap the name at the top, then **Rename**. You can pick a bookmark icon there too.

### A. Accept shared links
1. Tap the **ⓘ** (or the name ▾ → **Details**), turn on **Show in Share Sheet**, then tap **Done**.
2. At the top, a **Receive … input from Share Sheet** block appears. Tap the input types and keep only **URLs** and **Text**.
3. Tap **If there's no input** and choose **Get Clipboard**. This lets you also run it after copying a link.

### B. Save the link
Add these actions in order. Use the search bar at the bottom to find each one.

4. **Get Contents of URL**
   - URL: `APP/api/save`
   - Tap **▸ Show More**:
     - Method: **POST**
     - Headers → **Add new header**: Key `Authorization`, Value `Bearer TOKEN` (the word Bearer, a space, then your token)
     - Request Body: **JSON** → **Add new field → Text**: Key `input`, Value: tap and pick the **Shortcut Input** variable
5. **Set Variable**: name `Saved`, input **Contents of URL**

### C. Pick folders
6. **Get Dictionary Value**: Get **Value** for key `folders` in **Saved**
7. **Choose from List**: list **Dictionary Value**
   - Tap **▸ Show More**, turn on **Select Multiple**, and set the Prompt to `Save to folders`
8. **Combine Text**: **Chosen Item** with **New Lines**
9. **Set Variable**: name `Chosen`, input **Combined Text**

### D. Optional new folder
10. **Text**: leave it empty
11. **Set Variable**: name `NewFolder`, input **Text**
12. **If**: input **Chosen**, condition **contains**, text `New folder`
    - Inside the If, add **Ask for Input**: type **Text**, prompt `Folder name (use / for a subfolder, e.g. Recipes / Desserts)`
    - Still inside, add **Set Variable**: `NewFolder` = **Provided Input**
    - Leave **Otherwise** empty. **End If** is added automatically.

### E. File the post
13. **Get Dictionary Value**: Get **Value** for key `id` in **Saved**
14. **Get Contents of URL**
    - URL: `APP/api/assign`
    - Method **POST**, header `Authorization` = `Bearer TOKEN` (same as step 4)
    - Request Body: **JSON** with three **Text** fields:
      - `id` = **Dictionary Value** (the one from step 13)
      - `folders` = **Chosen**
      - `new_folder` = **NewFolder**
15. **Get Dictionary Value**: Get **Value** for key `message` in **Contents of URL**
16. **Show Notification**: **Dictionary Value**

Tap **Done**.

---

## Use it

- **Threads:** on a post, tap the **share arrow ↗**, then **Share via…** (or **More**), then **Save to Saves**.
- **TikTok:** tap **Share**, scroll the bottom row to **More / Others** (⋯), then **Save to Saves**.
- **Tip:** in the iOS share sheet, scroll to the bottom, tap **Edit Actions…**, and add **Save to Saves** to Favourites so it's always near the top.

The first time, iOS asks to allow the Shortcut to connect to your app address. Tap **Always Allow**.

## Troubleshooting

| Message | Fix |
|---|---|
| "Missing access token" or "token is invalid" | Check the `Authorization` header in both URL steps is exactly `Bearer svs_…`. Or make a new token in Settings. |
| "No link found" | The app shared plain text without a link. Use **Copy link** in Threads or TikTok, then run the Shortcut from the Shortcuts app; it reads the clipboard. |
| The folder list is empty apart from "➕ New folder…" | You don't have folders yet. Pick ➕ and type a name. |
| Nothing happens and the post doesn't appear | Open the Saves app and pull it to the foreground; it refreshes automatically. Also check your app address has no trailing `/`. |
