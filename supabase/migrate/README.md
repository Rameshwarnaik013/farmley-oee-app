# Moving off the egress-restricted Supabase project

## What happened

Supabase project `qvyoiovlblorahqkatlj` (`farmley_oeee`) is API-restricted:

```
HTTP 402 — Service for this project is restricted due to the following
violations: exceed_egress_quota.
```

The restriction is applied at Supabase's edge, so **every** endpoint is off —
`/rest/v1/*`, and `/auth/v1/*` too. That is why the app cannot log in and cannot
save a record. Nothing in the app code is broken, and the database itself is
untouched and still reachable over a direct Postgres connection.

## Why the quota blew

`supabase/apps-script/PullFromSupabase.gs` used to install a **5-minute**
time-driven trigger (`installTrigger` → `syncNow`). Each run called
`fetchAllRecords()`, which downloads the *entire* `oee_records` table with its
`plants` / `lines` / `machines` joins — about 2 MB of JSON.

    288 runs/day x ~2 MB  ≈  17 GB/month   vs. a 5 GB/month free-tier cap

That one trigger is the whole story. It has been changed to:

* every 2 hours instead of every 5 minutes (`SYNC_INTERVAL_HOURS = 2`),
* a ~1 KB probe (exact row count + newest `created_at`) before each pull, so a
  run where nothing changed costs a kilobyte instead of two megabytes,
* a forced full rebuild every 6th run (`FULL_SYNC_EVERY_N_RUNS`), i.e. every
  12 hours, so in-place Admin edits — which change neither the row count nor
  `created_at` — still reach the sheet.

Estimated egress after the change: well under 1 GB/month.

**Do not shorten the sync interval again** without re-checking egress.

## Why the replacement project has to live in another account

`jatothr-lgtm's Org` cannot host it. Two limits bite at once:

* **Free plan allows 2 active projects per owner.** `create_project` fails with
  *"jatothr-lgtm (2 project limit)"*. The slots are held by `farmley_oeee` and
  `jatothr-lgtm's Project`. (`RM/PM Wastage` and `cfa-suite` are already paused
  and do not occupy slots.)
* **Neither slot can be freed.** `jatothr-lgtm's Project` will not pause
  (*"Cannot pause project while it is currently hibernating"*) and will not
  restore either — that call returns:

      This organization is currently under service restrictions. The project
      can only be restored once restrictions are lifted or organization is
      upgraded to paid plan.

The restriction is scoped to the **organisation**, not just to `farmley_oeee`,
so a new project in this org would very likely be born restricted too. A
different Supabase account gets its own 5 GB free allowance.

## Migration

`migrate.py` copies the database directly from the old project to the new one
over two Postgres connections. Nothing is written to an intermediate dump file,
and no credentials are stored in the repo — both connection strings come from
the environment.

### 1. Create the project

In the other Supabase account: **New project**, Free plan, region `ap-south-1`
(Mumbai) — closest to the plants.

### 2. Collect both connection strings

For each project: **Connect → Session pooler → URI**. Use the pooler URI, not
`db.<ref>.supabase.co` — direct connections are IPv6-only on the free plan.
If you do not have a project's database password, reset it on that page.

Copy each URI verbatim. The host prefix is **not** predictable — both
`aws-0-ap-southeast-2.pooler.supabase.com` and
`aws-1-ap-southeast-2.pooler.supabase.com` exist, and which one a project uses
is shown only on its own Connect page. The lines below are the shape, not the
values:

```bash
set SRC_DSN=postgresql://postgres.qvyoiovlblorahqkatlj:<pw>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
set DST_DSN=postgresql://postgres.<new-ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

### 3. Run it

```bash
pip install "psycopg[binary]"
python migrate.py --check     # connects to both, prints row counts, changes nothing
python migrate.py --all       # applies 01_schema.sql, then copies every table
```

`--check` against the old project should report:

| table | rows |
| --- | --- |
| `public.plants` | 5 |
| `public.lines` | 3 |
| `public.machines` | 62 |
| `public.machine_status_defaults` | 40 |
| `auth.users` | 15 |
| `auth.identities` | 15 |
| `public.profiles` | 15 |
| `public.user_plants` | 13 |
| `public.oee_records` | 3,351 |

`--all` prints a matching count per table and fails loudly if any differs.

What it preserves:

* **Primary keys**, so every foreign key and every `row_code` stays valid.
* **`encrypted_password`**, so nobody has to reset a password. The hashes are
  bcrypt and do not depend on the project's JWT secret, so they move across
  projects unchanged.
* **Roles in `profiles`.** Copying `auth.users` fires `on_auth_user_created`,
  which inserts default `role = 'user'` rows; the script clears `profiles`
  before copying the real ones.

It copies only the columns both databases have, so a newer GoTrue on the
destination does not break the `auth` tables; any source-only column is named
in the output.

### 4. Repoint the app

* Deployment env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (new project → Settings → API). Redeploy.
* `supabase/apps-script/PullFromSupabase.gs`: `SUPABASE_URL` and `SERVICE_KEY`
  at the top. Then run **Force full sync now** once, and re-run
  `installTrigger` so the old 5-minute trigger is deleted and replaced with the
  2-hourly one.
* The `push-to-sheets` edge function and its `GSHEET_WEBAPP_URL` /
  `SHARED_SECRET` secrets need redeploying to the new project as well.

### 5. Afterwards

Leave `farmley_oeee` alone until the new project is verified end to end — it is
still the only copy of the data. Once you are happy, pause it.


---

## Outcome (2026-11-21)

Done. The app's backend is now:

| | |
| --- | --- |
| Project | `farmley-oee` (`qsqaqyvblvqzwfsruajz`) in **Rameshwar Org** |
| URL | `https://qsqaqyvblvqzwfsruajz.supabase.co` |
| Publishable key | `sb_publishable_o6gSjws8eXZF4XVUJUw1Lg_60jgMnry` |
| Region | Southeast Asia (Singapore) |

Rameshwar Org is a separate free organisation with its own 5 GB allowance, so
it is unaffected by the restriction on `jatothr-lgtm's Org`.

### How the slot was freed

A Free-plan account is limited to **2 active projects across all
organisations**, not per organisation — so the empty Rameshwar Org did not help
by itself. `farmley_oeee` was dumped to disk, verified, and then **paused** to
free the slot. It was already serving nothing (HTTP 402), so pausing cost
nothing. Note that while `jatothr-lgtm's Org` is restricted, a paused project
there **cannot be restored**; the local dump in `dump/` is the fallback copy.

### Verified on the new project

* 3,351 `oee_records`, all `row_code` values distinct, dates 2026-06-08 to
  2026-11-18, spread Indore 2,379 / Purnia 678 / Kundli 294.
* 15 `auth.users`, every one with its original bcrypt hash; 15 `auth.identities`.
* `profiles` roles intact — `jatoth.r@farmley.com` is still the only admin.
* 6 tables with RLS on, 15 policies, 4 functions, both triggers, and the
  `machine_shift_plan` view returning 96 rows.
* No orphaned foreign keys on `plant_id` or `created_by`.
* `GET /auth/v1/health` → 200, `GET /rest/v1/plants` as anon → `[]` (RLS holds).

### Done

* **Apps Script** (2026-11-21). The bound project had **diverged from this
  repo** - different `RECIPIENTS`, different `HEADERS`, and an extra
  `fetchMachineStatusDefaults()` planning matrix that is not in version
  control. It was therefore *patched in place*, not overwritten:
  `SUPABASE_URL` and `SERVICE_KEY` repointed, plus the probe, the 2-hour
  interval, the noon-midnight window and `forceFullSync`. `forceFullSync` ran
  clean (24 s) and the sheet now reads "Last synced: Sat Nov 21 2026 15:23:29
  GMT+0530". `installTrigger` re-ran: exactly two triggers remain, `syncNow`
  and `emailLatestAdoption`, with the 5-minute one gone. Project time zone
  confirmed as Asia/Kolkata, which the window depends on.
  **The repo copy of `PullFromSupabase.gs` is still not what runs** - treat the
  live script as the source of truth until someone reconciles the two.
* The old project is paused, not lost: the dashboard says data remains safe and
  it is resumable until **26 Dec 2027**.

### Still to do

