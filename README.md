# Farmley OEE Monitoring

A web application to record **Overall Equipment Effectiveness (OEE)** across
Farmley plants. Email/password login, admin-controlled plant access, live OEE
calculation, data stored in **Supabase**, and each saved row pushed to **Google
Sheets**.

## Stack
- React + Vite (deploy to Vercel)
- Supabase (Auth, Postgres, Row-Level Security, Edge Function)
- Google Apps Script Web App (writes rows into a Google Sheet)

## Plants & Lines
- **Plants:** Indore, Purnia, Kundli, UD, Rebela
- **Line types (only these 3):** Roasting Line, Packing Line, Mixing Line
- Machines/sub-lines per plant are stored as editable master data in Supabase
  (see `supabase/seed.sql`).

## OEE formula
| Metric | Formula |
|---|---|
| Planned Time | entered in **hours** → ×60 → minutes |
| Downtime | entered in **minutes** |
| Availability % | (PlannedMin − Downtime) / PlannedMin |
| Performance % | Actual Output / Target Output |
| Quality % | Good Qty / Actual Output |
| **OEE %** | Availability × Performance × Quality |

Verified: 9h planned, 30 down, 6500/9000 out, 5000 good → 94.44% × 72.22% ×
76.92% = **52.47%**.

---

## Setup

### 1. Supabase
1. Create a project at https://supabase.com.
2. SQL Editor → run `supabase/schema.sql`, then `supabase/seed.sql`.
3. Project Settings → API → copy the **Project URL** and **anon public key**.

### 2. Web app (local)
```bash
npm install
cp .env.example .env      # then paste your Supabase URL + anon key
npm run dev               # http://localhost:5273
```

### 3. Create the first admin
Sign up in the app, then in Supabase SQL Editor:
```sql
update public.profiles set role = 'admin' where email = 'you@farmley.com';
```
Log out / back in. The **Admin** tab lets you assign plants and roles to other users.

### 4. Google Sheets push (server-side)
1. Create a Google Sheet. Extensions → Apps Script → paste `supabase/apps-script/Code.gs`.
   Set `SHARED_SECRET` to a long random string. Deploy → **Web app**
   (Execute as: Me, Who has access: Anyone). Copy the `/exec` URL.
2. Deploy the edge function and set secrets:
   ```bash
   supabase functions deploy push-to-sheets
   supabase secrets set GSHEET_WEBAPP_URL="https://script.google.com/macros/s/XXX/exec"
   supabase secrets set GSHEET_SHARED_SECRET="same-long-random-string"
   ```
On each save the app calls `push-to-sheets`, which appends the row to the
"OEE Records" sheet and marks the record `synced_to_sheet = true`. If the sheet
isn't configured yet, records still save to Supabase (sync shows "Pending").

### 5. Deploy (Vercel)
Import the repo, set the two `VITE_SUPABASE_*` env vars, deploy.

## Project structure
```
supabase/
  schema.sql                  tables, RLS, triggers, helper functions
  seed.sql                    plants, lines, machines master data
  functions/push-to-sheets/   edge function (Supabase -> Sheets)
  apps-script/Code.gs         Google Sheets receiver
src/
  lib/oee.js                  OEE calculation (single source of truth)
  lib/supabaseClient.js
  context/AuthContext.jsx
  pages/  Login, Dashboard, PlantModule, OEEForm, Records, Admin
```
