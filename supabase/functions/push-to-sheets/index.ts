// ============================================================================
// Supabase Edge Function: push-to-sheets
//
// Called by the web app right after an OEE record is saved. It reads the full
// record server-side (service-role) and POSTs it to a Google Apps Script Web
// App, which appends a row to your Google Sheet. Credentials never touch the
// browser.
//
// Deploy:
//   supabase functions deploy push-to-sheets
//   supabase secrets set GSHEET_WEBAPP_URL="https://script.google.com/macros/s/XXX/exec"
//   supabase secrets set GSHEET_SHARED_SECRET="some-long-random-string"
//
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { record_id } = await req.json()
    if (!record_id) {
      return new Response(JSON.stringify({ error: 'record_id required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Pull the full record with related names for a readable sheet row.
    const { data: rec, error } = await admin
      .from('oee_records')
      .select('*, plants(name), lines(name), machines(name)')
      .eq('id', record_id)
      .single()
    if (error || !rec) throw error ?? new Error('record not found')

    const webhook = Deno.env.get('GSHEET_WEBAPP_URL')
    if (!webhook) throw new Error('GSHEET_WEBAPP_URL not configured')

    const row = {
      secret: Deno.env.get('GSHEET_SHARED_SECRET') ?? '',
      id: rec.id,
      date: rec.record_date,
      plant: rec.plants?.name ?? '',
      line: rec.lines?.name ?? '',
      machine: rec.machines?.name ?? '',
      machine_status: rec.machine_status ?? '',
      shift: rec.shift ?? '',
      planned_time_minutes: rec.planned_time_minutes,
      downtime_minutes: rec.downtime_minutes,
      operational_hours: rec.operational_hours ?? '',
      pieces_per_minute: rec.pieces_per_minute ?? '',
      actual_output: rec.actual_output,
      target_output: rec.target_output,
      good_qty: rec.good_qty,
      availability_pct: rec.availability_pct,
      performance_pct: rec.performance_pct,
      quality_pct: rec.quality_pct,
      oee_pct: rec.oee_pct,
      created_at: rec.created_at,
    }

    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    })
    if (!resp.ok) throw new Error(`Sheets webhook failed: ${resp.status}`)

    // Mark as synced.
    await admin
      .from('oee_records')
      .update({ synced_to_sheet: true })
      .eq('id', record_id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
