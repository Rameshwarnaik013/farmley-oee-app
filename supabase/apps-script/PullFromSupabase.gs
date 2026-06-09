/**
 * Farmley OEE — Pull data from Supabase into Google Sheets
 * ---------------------------------------------------------
 * Reads oee_records from Supabase (REST API, service_role key, bypasses RLS)
 * and refreshes a sheet tab "OEE Records". Full refresh each run = exact mirror.
 *
 * SETUP
 * 1. Create / open a Google Sheet -> Extensions -> Apps Script. Paste this file.
 * 2. Set SUPABASE_URL and SERVICE_KEY below (Settings -> API -> service_role).
 * 3. Save. Run "syncNow" once (approve prompt). Run "installTrigger" for 5-min auto-sync.
 *
 * SECURITY: service_role has full DB access. Keep this script private; never
 * publish it as a public web app.
 */

var SUPABASE_URL = 'https://qvyoiovlblorahqkatlj.supabase.co';
var SERVICE_KEY  = 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

var SHEET_NAME = 'OEE Records';
var PAGE_SIZE  = 1000;

var HEADERS = [
  'ID', 'Date', 'Plant', 'Line', 'Machine', 'Shift', 'Units',
  'Planned Time (min)', 'Downtime (min) [Breakdown]', 'No. of Cycles',
  'Actual Output', 'Target Output', 'Good Qty',
  'Availability %', 'Performance %', 'Quality %', 'OEE %',
  'OEE Classification', 'Created By', 'Assigned Plants', 'Created At',
];

/** OEE % -> status. >85 Excellent, 70-85 Acceptable, <70 Critical. */
function classifyOEE(oee) {
  var v = Number(oee);
  if (!isFinite(v)) return '';
  if (v > 85) return 'Excellent';
  if (v >= 70) return 'Acceptable';
  return 'Critical';
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Farmley OEE')
    .addItem('Sync now', 'syncNow')
    .addItem('Install auto-sync (5 min)', 'installTrigger')
    .addToUi();
}

/** id -> { label: "Name (email)", role } */
function fetchUserMap() {
  var url = SUPABASE_URL + '/rest/v1/profiles?select=id,email,full_name,role';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  var map = {};
  if (resp.getResponseCode() === 200) {
    JSON.parse(resp.getContentText()).forEach(function (p) {
      map[p.id] = {
        label: p.full_name ? (p.full_name + ' (' + p.email + ')') : p.email,
        role: p.role,
      };
    });
  }
  return map;
}

/** user_id -> [plant names assigned] */
function fetchUserPlantsMap() {
  var url = SUPABASE_URL + '/rest/v1/user_plants?select=user_id,plants(name)';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  var map = {};
  if (resp.getResponseCode() === 200) {
    JSON.parse(resp.getContentText()).forEach(function (r) {
      if (!map[r.user_id]) map[r.user_id] = [];
      if (r.plants && r.plants.name) map[r.user_id].push(r.plants.name);
    });
  }
  return map;
}

function assignedPlantsFor(userId, userMap, userPlantsMap) {
  var u = userMap[userId];
  if (u && u.role === 'admin') return 'All plants (admin)';
  var list = userPlantsMap[userId] || [];
  return list.length ? list.sort().join(', ') : '—';
}

function fetchAllRecords() {
  var all = [];
  var from = 0;
  while (true) {
    var to = from + PAGE_SIZE - 1;
    var url = SUPABASE_URL + '/rest/v1/oee_records'
      + '?select=' + encodeURIComponent(
          'id,record_date,shift,units,number_of_cycles,'
        + 'planned_time_minutes,downtime_minutes,'
        + 'actual_output,target_output,good_qty,'
        + 'availability_pct,performance_pct,quality_pct,oee_pct,'
        + 'created_by,created_at,'
        + 'plants(name),lines(name),machines(name)')
      + '&order=created_at.asc';

    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        Range: from + '-' + to,
        'Range-Unit': 'items',
      },
    });

    var code = resp.getResponseCode();
    if (code !== 200 && code !== 206) {
      throw new Error('Supabase error ' + code + ': ' + resp.getContentText());
    }

    var batch = JSON.parse(resp.getContentText());
    all = all.concat(batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function syncNow() {
  if (SERVICE_KEY === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') {
    throw new Error('Set SERVICE_KEY at the top of the script first.');
  }
  var userMap = fetchUserMap();
  var userPlantsMap = fetchUserPlantsMap();
  var records = fetchAllRecords();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.clearContents();

  var rows = [HEADERS];
  records.forEach(function (r) {
    var u = userMap[r.created_by];
    rows.push([
      r.id,
      r.record_date,
      r.plants ? r.plants.name : '',
      r.lines ? r.lines.name : '',
      r.machines ? r.machines.name : '',
      r.shift || '',
      r.units || '',
      r.planned_time_minutes,
      r.downtime_minutes,
      (r.number_of_cycles === null || r.number_of_cycles === undefined) ? '' : r.number_of_cycles,
      r.actual_output,
      r.target_output,
      r.good_qty,
      r.availability_pct,
      r.performance_pct,
      r.quality_pct,
      r.oee_pct,
      classifyOEE(r.oee_pct),
      u ? u.label : (r.created_by || ''),
      assignedPlantsFor(r.created_by, userMap, userPlantsMap),
      r.created_at,
    ]);
  });

  sheet.getRange(1, 1, rows.length, HEADERS.length).setValues(rows);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, HEADERS.length + 2).setValue('Last synced: ' + new Date());
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Auto-sync enabled (every 5 min).');
}
