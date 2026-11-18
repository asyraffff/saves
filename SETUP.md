# Setup (one time, about 15 minutes)

You need three free accounts: **GitHub** (you have it), **Supabase** (database + login), and **Vercel** (hosting).

## 1. Supabase: database and login

1. Go to <https://supabase.com>, sign in with GitHub, click **New project**.
   - Name: `saves`. Pick a strong database password (save it in your password manager). Region: the closest to you (e.g. Singapore).
2. When the project is ready, open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. You should see "Success".
3. Open **Project Settings → API keys** (or **Settings → API**) and keep these three values handy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon / publishable** key
   - **service_role / secret** key (never share this one)

> Free Supabase projects pause after about a week with no activity. If you stop using the app for a while, open the Supabase dashboard and click **Restore**.

## 2. Vercel: host the app

1. Go to <https://vercel.com>, sign in with GitHub, click **Add New… → Project**, and import **asyraffff/saves**.
2. Framework preset: **Vite** (auto-detected). Before deploying, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role / secret key |

3. Click **Deploy**. You get an address like `https://saves-xxxx.vercel.app`. That is your **app address**.

## 3. Point Supabase login at your app

Supabase → **Authentication → URL Configuration**:
- **Site URL**: your app address (e.g. `https://saves-xxxx.vercel.app`)
- **Redirect URLs**: add the same address.

This makes the "confirm your email" link go back to your app.

## 4. Install on your iPhone

1. Open your app address in **Safari** on the iPhone.
2. Tap **Share → Add to Home Screen → Add**.
3. Open **Saves** from the Home Screen, tap **Create an account**, then confirm the email and sign in.

## 5. Add Saves to the share sheet

In the app: **☰ → Settings & Shortcut → Create Shortcut token**. Then follow [SHORTCUT.md](SHORTCUT.md).

---

## Running locally (optional, for development)

```powershell
copy .env.example .env.local   # then fill in the three values
npm install
npm run dev                     # http://localhost:5173 (the /api routes run too)
npm test                        # unit tests
```

Live check against real Threads/TikTok pages (PowerShell):

```powershell
$env:LIVE=1; npx vitest run tests/live.test.ts
```
