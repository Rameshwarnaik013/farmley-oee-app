/**
 * Farmley OEE — Pull data from Supabase into Google Sheets
 * ---------------------------------------------------------
 * Builds tabs: "OEE Records", "App Adoption", "OEE % by Line".
 * Emails latest-day adoption + OEE-by-line to recipients once daily.
 *
 * SETUP
 * 1. File -> Project Settings -> Time zone = Asia/Kolkata (for IST email time).
 * 2. Set SUPABASE_URL + SERVICE_KEY (Settings -> API -> service_role).
 * 3. Run "syncNow" (approve prompt). Run "installTrigger" (5-min sync) and
 *    "installEmailTrigger" (daily email).
 *
 * SECURITY: service_role has full DB access. Keep this script private.
 */

var SUPABASE_URL = 'https://qvyoiovlblorahqkatlj.supabase.co';
var SERVICE_KEY  = 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

var SHEET_NAME = 'OEE Records';
var ADOPTION_SHEET = 'App Adoption';
var PAGE_SIZE  = 1000;

// Daily adoption email
var EMAIL_HOUR = 20; // 8 PM (project time zone — set to Asia/Kolkata)
var RECIPIENTS = [
  'saurabh.u@farmley.com',
  'ravi.ku@farmley.com',
  'himanshu.j@farmley.com',
  'ankit.t@farmley.com',
  'avinash.k@farmley.com',
  'aman.j@farmley.com',
  'sujeet.c@farmley.com',
  'vaibhav.s@farmley.com',
  'samarth.t@farmley.com', // Samarth Taneja — verify exact address
].join(',');

var TEST_EMAIL = 'jatoth.r@farmley.com'; // delivery-test recipient

var HEADERS = [
  'ID', 'Date', 'Plant', 'Line', 'Machine', 'Machine Status', 'Shift', 'Units',
  'Planned Time (min)', 'Downtime (min) [Breakdown]', 'Operational Hours',
  'Pieces Per Minute (PPM)', 'No. of Cycles',
  'Actual Output', 'Target Output', 'Good Qty',
  'Availability %', 'Performance %', 'Quality %', 'OEE %',
  'OEE Classification', 'Created By', 'Assigned Plants', 'Created At',
];

var ADOPTION_HEADERS = [
  'Date', 'Plant', 'Created By', 'Shift',
  'Roasting (Filled/Total)', 'Packing (Filled/Total)', 'Mixing (Filled/Total)',
  'Overall Adoption %', 'Status',
];

var OEE_LINE_SHEET = 'OEE % by Line';
var OEE_LINE_HEADERS = ['Date', 'Plant', 'Line', 'Shift', 'OEE %'];

// Plants where Mixing is NOT counted toward Overall Adoption %.
var MIXING_EXCLUDED_PLANTS = ['Purnia'];

// Status colours
var C_COMPLETE = '#C6EFCE'; // green
var C_PARTIAL  = '#FF4D4D'; // red
var C_NONE     = '#C00000'; // dark red

// Adoption settings
var EXCLUDE_EMAILS = ['jatoth.r@farmley.com']; // entries by these users are ignored in adoption
var SHIFTS = ['Day', 'Night']; // every plant/day shows both shift rows

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
    .addItem('Email adoption now', 'emailLatestAdoption')
    .addItem('Resend adoption (ignore guard)', 'forceSendAdoption')
    .addItem('Email adoption to me (test)', 'emailAdoptionToSelf')
    .addItem('Send test email', 'testEmail')
    .addSeparator()
    .addItem('Install auto-sync (5 min)', 'installTrigger')
    .addItem('Install daily adoption email', 'installEmailTrigger')
    .addToUi();
}

/* ----------------------------- Supabase fetch ---------------------------- */

function sbGet(path) {
  var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Supabase error ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

/** id -> { label: "Name (email)", role } */
function fetchUserMap() {
  var map = {};
  sbGet('profiles?select=id,email,full_name,role').forEach(function (p) {
    map[p.id] = {
      label: p.full_name ? (p.full_name + ' (' + p.email + ')') : p.email,
      email: p.email,
      role: p.role,
    };
  });
  return map;
}

/** user_id -> [plant names assigned] */
function fetchUserPlantsMap() {
  var map = {};
  sbGet('user_plants?select=user_id,plants(name)').forEach(function (r) {
    if (!map[r.user_id]) map[r.user_id] = [];
    if (r.plants && r.plants.name) map[r.user_id].push(r.plants.name);
  });
  return map;
}

/** active machines with plant + line names (for adoption totals). */
function fetchMachines() {
  return sbGet('machines?select=id,name,is_active,plants(name),lines(name)&is_active=eq.true');
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
          'id,record_date,shift,machine_status,units,number_of_cycles,'
        + 'planned_time_minutes,downtime_minutes,operational_hours,pieces_per_minute,'
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

/* ----------------------------- OEE Records tab --------------------------- */

function syncNow() {
  if (SERVICE_KEY === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') {
    throw new Error('Set SERVICE_KEY at the top of the script first.');
  }
  var userMap = fetchUserMap();
  var userPlantsMap = fetchUserPlantsMap();
  var machines = fetchMachines();
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
      r.machine_status || '',
      r.shift || '',
      r.units || '',
      r.planned_time_minutes,
      r.downtime_minutes,
      (r.operational_hours === null || r.operational_hours === undefined) ? '' : r.operational_hours,
      (r.pieces_per_minute === null || r.pieces_per_minute === undefined) ? '' : r.pieces_per_minute,
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

  // Refresh adoption + OEE-by-line tabs too.
  writeAdoptionSheet(buildAdoption(records, machines, userMap));
  writeOeeByLineSheet(buildOeeByLine(records, userMap));
}

/* ------------------------------ App Adoption ----------------------------- */

/**
 * One row per Date + Plant. Only Roasting + Packing lines count.
 *   Roasting adoption = roasting machines filled / total roasting machines
 *   Packing adoption  = packing machines filled  / total packing machines
 *   Overall           = (roasting+packing filled) / (total roasting+packing)
 * A plant+date with no entries shows 0/total -> Not Filled (dark red).
 */
function buildAdoption(records, machines, userMap, extraDates) {
  var totalRoast = {}, totalPack = {}, totalMix = {};
  machines.forEach(function (m) {
    var plant = m.plants ? m.plants.name : '';
    var line = (m.lines ? m.lines.name : '').toLowerCase();
    if (line.indexOf('roasting') !== -1) totalRoast[plant] = (totalRoast[plant] || 0) + 1;
    else if (line.indexOf('packing') !== -1) totalPack[plant] = (totalPack[plant] || 0) + 1;
    else if (line.indexOf('mixing') !== -1) totalMix[plant] = (totalMix[plant] || 0) + 1;
  });

  var excluded = {};
  Object.keys(userMap).forEach(function (id) {
    if (userMap[id].email && EXCLUDE_EMAILS.indexOf(userMap[id].email) !== -1) excluded[id] = 1;
  });

  // Keyed by date|plant|shift (shift = Day/Night).
  var filledRoast = {}, filledPack = {}, filledMix = {}, creators = {}, dateSet = {};
  records.forEach(function (r) {
    dateSet[r.record_date] = 1;            // date appears even if only excluded users entered
    if (excluded[r.created_by]) return;     // ignore excluded users' entries
    var plant = r.plants ? r.plants.name : '';
    var line = (r.lines ? r.lines.name : '').toLowerCase();
    var sh = (r.shift || '').toLowerCase();
    var shift = sh === 'night' ? 'Night' : (sh === 'day' ? 'Day' : null);
    if (!shift) return;                     // only Day/Night entries count
    var isR = line.indexOf('roasting') !== -1;
    var isP = line.indexOf('packing') !== -1;
    var isM = line.indexOf('mixing') !== -1;
    if (!isR && !isP && !isM) return;
    var key = r.record_date + '|' + plant + '|' + shift;
    if (isR) { filledRoast[key] = filledRoast[key] || {}; if (r.machines) filledRoast[key][r.machines.name] = 1; }
    if (isP) { filledPack[key]  = filledPack[key]  || {}; if (r.machines) filledPack[key][r.machines.name]  = 1; }
    if (isM) { filledMix[key]   = filledMix[key]   || {}; if (r.machines) filledMix[key][r.machines.name]   = 1; }
    creators[key] = creators[key] || {};
    var u = userMap[r.created_by];
    creators[key][u ? u.label : (r.created_by || '')] = 1;
  });

  var plantsWith = {};
  Object.keys(totalRoast).forEach(function (p) { plantsWith[p] = 1; });
  Object.keys(totalPack).forEach(function (p) { plantsWith[p] = 1; });
  Object.keys(totalMix).forEach(function (p) { plantsWith[p] = 1; });

  (extraDates || []).forEach(function (d) { dateSet[d] = 1; }); // ensure email dates appear
  var dates = Object.keys(dateSet).sort();
  var plants = Object.keys(plantsWith).sort();

  var out = [];
  dates.forEach(function (date) {
    plants.forEach(function (plant) {
      var tR = totalRoast[plant] || 0, tP = totalPack[plant] || 0, tM = totalMix[plant] || 0;
      if (tR + tP + tM === 0) return;
      var includeMix = MIXING_EXCLUDED_PLANTS.indexOf(plant) === -1; // Purnia excludes Mixing
      var totalAll = tR + tP + (includeMix ? tM : 0);
      SHIFTS.forEach(function (shift) {       // always emit both Day and Night rows
        var key = date + '|' + plant + '|' + shift;
        var fR = filledRoast[key] ? Object.keys(filledRoast[key]).length : 0;
        var fP = filledPack[key] ? Object.keys(filledPack[key]).length : 0;
        var fM = filledMix[key] ? Object.keys(filledMix[key]).length : 0;
        var filledAll = fR + fP + (includeMix ? fM : 0);
        var pct = totalAll > 0 ? Math.min(100, Math.round((filledAll / totalAll) * 1000) / 10) : 0;
        var status = filledAll === 0 ? 'Not Filled'
                   : (filledAll < totalAll ? 'Partial' : 'Complete');
        out.push({
          date: date, plant: plant,
          createdBy: creators[key] ? Object.keys(creators[key]).sort().join(', ') : '—',
          shift: shift,
          roasting: fR + '/' + tR,
          packing: fP + '/' + tP,
          mixing: fM + '/' + tM,
          pct: pct, status: status,
        });
      });
    });
  });
  return out;
}

/**
 * OEE % by Line: one row per Date+Plant+Line+Shift = average of machine OEE%.
 * Excludes EXCLUDE_EMAILS. Only groups that actually have entries are returned.
 */
function buildOeeByLine(records, userMap) {
  var excluded = {};
  Object.keys(userMap).forEach(function (id) {
    if (userMap[id].email && EXCLUDE_EMAILS.indexOf(userMap[id].email) !== -1) excluded[id] = 1;
  });

  var groups = {};
  records.forEach(function (r) {
    if (excluded[r.created_by]) return;
    var sh = (r.shift || '').toLowerCase();
    var shift = sh === 'night' ? 'Night' : (sh === 'day' ? 'Day' : null);
    if (!shift) return;
    var line = r.lines ? r.lines.name : '';
    if (!line) return;
    var oee = Number(r.oee_pct);
    if (!isFinite(oee)) return;
    var plant = r.plants ? r.plants.name : '';
    var key = r.record_date + '|' + plant + '|' + line + '|' + shift;
    if (!groups[key]) groups[key] = { date: r.record_date, plant: plant, line: line, shift: shift, sum: 0, n: 0 };
    groups[key].sum += oee;
    groups[key].n += 1;
  });

  var out = Object.keys(groups).map(function (k) {
    var g = groups[k];
    return { date: g.date, plant: g.plant, line: g.line, shift: g.shift,
             oee: Math.round((g.sum / g.n) * 100) / 100 };
  });
  out.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first
    if (a.plant !== b.plant) return a.plant < b.plant ? -1 : 1;
    if (a.line !== b.line) return a.line < b.line ? -1 : 1;
    return a.shift < b.shift ? -1 : 1;
  });
  return out;
}

function statusColor(status) {
  if (status === 'Complete') return C_COMPLETE;
  if (status === 'Partial') return C_PARTIAL;
  return C_NONE; // Not Filled
}

function writeAdoptionSheet(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ADOPTION_SHEET) || ss.insertSheet(ADOPTION_SHEET);
  sheet.clear();

  var values = [ADOPTION_HEADERS];
  rows.forEach(function (r) {
    values.push([r.date, r.plant, r.createdBy, r.shift, r.roasting, r.packing, r.mixing, r.pct, r.status]);
  });
  sheet.getRange(1, 1, values.length, ADOPTION_HEADERS.length).setValues(values);
  sheet.getRange(1, 1, 1, ADOPTION_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Colour the Overall % + Status cells per row (cols 8-9).
  for (var i = 0; i < rows.length; i++) {
    var bg = statusColor(rows[i].status);
    var font = (rows[i].status === 'Not Filled') ? '#FFFFFF' : '#000000';
    sheet.getRange(i + 2, 8, 1, 2).setBackground(bg).setFontColor(font);
  }
}

function writeOeeByLineSheet(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OEE_LINE_SHEET) || ss.insertSheet(OEE_LINE_SHEET);
  sheet.clear();
  var values = [OEE_LINE_HEADERS];
  rows.forEach(function (r) {
    values.push([r.date, r.plant, r.line, r.shift, r.oee]);
  });
  sheet.getRange(1, 1, values.length, OEE_LINE_HEADERS.length).setValues(values);
  sheet.getRange(1, 1, 1, OEE_LINE_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/* ------------------------------ Daily email ------------------------------ */

// Shift YYYY-MM-DD by n days (UTC-safe).
function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// One OEE Records row (mirrors the HEADERS column order).
function recordToRow(r, userMap, userPlantsMap) {
  var u = userMap[r.created_by];
  return [
    r.id, r.record_date,
    r.plants ? r.plants.name : '',
    r.lines ? r.lines.name : '',
    r.machines ? r.machines.name : '',
    r.machine_status || '',
    r.shift || '', r.units || '',
    r.planned_time_minutes, r.downtime_minutes,
    (r.operational_hours === null || r.operational_hours === undefined) ? '' : r.operational_hours,
    (r.pieces_per_minute === null || r.pieces_per_minute === undefined) ? '' : r.pieces_per_minute,
    (r.number_of_cycles === null || r.number_of_cycles === undefined) ? '' : r.number_of_cycles,
    r.actual_output, r.target_output, r.good_qty,
    r.availability_pct, r.performance_pct, r.quality_pct, r.oee_pct,
    classifyOEE(r.oee_pct),
    u ? u.label : (r.created_by || ''),
    assignedPlantsFor(r.created_by, userMap, userPlantsMap),
    r.created_at,
  ];
}

// Records limited to latest-day Day shift + previous-day Night shift.
function filterRecordsForReport(records, maxDate, prevDate) {
  return records.filter(function (r) {
    var sh = (r.shift || '').toLowerCase();
    return (r.record_date === maxDate && sh === 'day')
        || (r.record_date === prevDate && sh === 'night');
  });
}

// xlsx of just the supplied (already-filtered) OEE Records + OEE % by Line rows.
function buildFilteredXlsxBlob(recRows, oeeRows) {
  var temp = SpreadsheetApp.create('Farmley OEE export ' + new Date().getTime());
  var s1 = temp.getActiveSheet();
  s1.setName(SHEET_NAME);
  var v1 = [HEADERS].concat(recRows);
  s1.getRange(1, 1, v1.length, HEADERS.length).setValues(v1);

  var s2 = temp.insertSheet(OEE_LINE_SHEET);
  var v2 = [OEE_LINE_HEADERS].concat(oeeRows);
  s2.getRange(1, 1, v2.length, OEE_LINE_HEADERS.length).setValues(v2);

  SpreadsheetApp.flush();
  var url = 'https://docs.google.com/spreadsheets/d/' + temp.getId() + '/export?format=xlsx';
  var resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  });
  var blob = resp.getBlob().setName(
    'Farmley_OEE_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  DriveApp.getFileById(temp.getId()).setTrashed(true); // clean up temp file
  return blob;
}

function getReportAttachments(recRows, oeeRows) {
  try { return [buildFilteredXlsxBlob(recRows, oeeRows)]; } catch (e) { return []; }
}

function emailLatestAdoption() {
  var userMap = fetchUserMap();
  var machines = fetchMachines();
  var records = fetchAllRecords();
  if (!records.length) return;

  // Latest day = max record date; previous day = latest - 1.
  var maxDate = records.reduce(function (a, r) {
    return r.record_date > a ? r.record_date : a;
  }, records[0].record_date);
  var prevDate = addDays(maxDate, -1);

  // Force both dates to exist so "Not Filled" rows show even with no entries.
  var rows = buildAdoption(records, machines, userMap, [maxDate, prevDate]);
  var dayRows = rows.filter(function (r) { return r.date === maxDate && r.shift === 'Day'; });
  var nightRows = rows.filter(function (r) { return r.date === prevDate && r.shift === 'Night'; });

  // OEE % by line for the same Day(latest)/Night(prev) sections.
  var oee = buildOeeByLine(records, userMap);
  var dayOee = oee.filter(function (r) { return r.date === maxDate && r.shift === 'Day'; });
  var nightOee = oee.filter(function (r) { return r.date === prevDate && r.shift === 'Night'; });

  // Attachment rows: only latest-day Day + previous-day Night.
  var userPlantsMap = fetchUserPlantsMap();
  var recRows = filterRecordsForReport(records, maxDate, prevDate)
    .map(function (r) { return recordToRow(r, userMap, userPlantsMap); });
  var oeeRows = dayOee.concat(nightOee).map(function (r) {
    return [r.date, r.plant, r.line, r.shift, r.oee];
  });

  // Always send (fixed daily trigger). Keep ONE trigger to avoid duplicates.
  MailApp.sendEmail({
    to: RECIPIENTS,
    subject: 'Farmley OEE — Adoption + OEE (Day ' + maxDate + ' / Night ' + prevDate + ')',
    htmlBody: buildAdoptionEmailHtml(maxDate, dayRows, prevDate, nightRows, dayOee, nightOee),
    attachments: getReportAttachments(recRows, oeeRows),
  });
  PropertiesService.getScriptProperties().setProperty('lastEmailedDate', maxDate);
}

/** Sends the full new-format report to TEST_EMAIL only (no guard, no team). */
function emailAdoptionToSelf() {
  var userMap = fetchUserMap();
  var machines = fetchMachines();
  var records = fetchAllRecords();
  if (!records.length) {
    MailApp.sendEmail({ to: TEST_EMAIL, subject: 'Farmley OEE — test (no records)',
      htmlBody: 'Ran OK, but Supabase has no OEE records yet.' });
    return;
  }
  var maxDate = records.reduce(function (a, r) {
    return r.record_date > a ? r.record_date : a;
  }, records[0].record_date);
  var prevDate = addDays(maxDate, -1);
  var rows = buildAdoption(records, machines, userMap, [maxDate, prevDate]);
  var dayRows = rows.filter(function (r) { return r.date === maxDate && r.shift === 'Day'; });
  var nightRows = rows.filter(function (r) { return r.date === prevDate && r.shift === 'Night'; });
  var oee = buildOeeByLine(records, userMap);
  var dayOee = oee.filter(function (r) { return r.date === maxDate && r.shift === 'Day'; });
  var nightOee = oee.filter(function (r) { return r.date === prevDate && r.shift === 'Night'; });

  var userPlantsMap = fetchUserPlantsMap();
  var recRows = filterRecordsForReport(records, maxDate, prevDate)
    .map(function (r) { return recordToRow(r, userMap, userPlantsMap); });
  var oeeRows = dayOee.concat(nightOee).map(function (r) {
    return [r.date, r.plant, r.line, r.shift, r.oee];
  });

  MailApp.sendEmail({
    to: TEST_EMAIL,
    subject: '[TEST to self] Farmley OEE — Adoption + OEE (Day ' + maxDate + ' / Night ' + prevDate + ')',
    htmlBody: buildAdoptionEmailHtml(maxDate, dayRows, prevDate, nightRows, dayOee, nightOee),
    attachments: getReportAttachments(recRows, oeeRows),
  });
}

function renderAdoptionTable(title, rows) {
  var th = 'style="border:1px solid #ccc;padding:6px;background:#16a34a;color:#fff;text-align:left"';
  var td = 'style="border:1px solid #ccc;padding:6px"';
  var html = '<h3 style="margin:16px 0 6px;color:#15803d">' + title + '</h3>';
  if (!rows.length) return html + '<p style="color:#64748b">No data.</p>';
  html += '<table style="border-collapse:collapse;font-size:14px">'
    + '<tr><th ' + th + '>Plant</th><th ' + th + '>Created By</th>'
    + '<th ' + th + '>Roasting</th><th ' + th + '>Packing</th><th ' + th + '>Mixing</th>'
    + '<th ' + th + '>Overall %</th><th ' + th + '>Status</th></tr>';
  rows.forEach(function (r) {
    var bg = statusColor(r.status);
    var fc = (r.status === 'Not Filled') ? '#fff' : '#000';
    html += '<tr>'
      + '<td ' + td + '>' + r.plant + '</td>'
      + '<td ' + td + '>' + r.createdBy + '</td>'
      + '<td ' + td + '>' + r.roasting + '</td>'
      + '<td ' + td + '>' + r.packing + '</td>'
      + '<td ' + td + '>' + r.mixing + '</td>'
      + '<td ' + td + '>' + r.pct + '%</td>'
      + '<td style="border:1px solid #ccc;padding:6px;background:' + bg + ';color:' + fc + '">' + r.status + '</td>'
      + '</tr>';
  });
  return html + '</table>';
}

function renderOeeTable(title, rows) {
  var th = 'style="border:1px solid #ccc;padding:6px;background:#f59e0b;color:#fff;text-align:left"';
  var td = 'style="border:1px solid #ccc;padding:6px"';
  var html = '<h3 style="margin:16px 0 6px;color:#b45309">' + title + '</h3>';
  if (!rows.length) return html + '<p style="color:#64748b">No data.</p>';
  html += '<table style="border-collapse:collapse;font-size:14px">'
    + '<tr><th ' + th + '>Plant</th><th ' + th + '>Line</th><th ' + th + '>OEE %</th></tr>';
  rows.forEach(function (r) {
    html += '<tr>'
      + '<td ' + td + '>' + r.plant + '</td>'
      + '<td ' + td + '>' + r.line + '</td>'
      + '<td ' + td + '>' + r.oee + '%</td>'
      + '</tr>';
  });
  return html + '</table>';
}

// Average the per-line OEE rows up to one overall value per plant.
function plantAvgFromLines(lineRows) {
  var g = {};
  (lineRows || []).forEach(function (r) {
    if (!g[r.plant]) g[r.plant] = { sum: 0, n: 0 };
    g[r.plant].sum += r.oee;
    g[r.plant].n += 1;
  });
  return Object.keys(g).sort().map(function (p) {
    return { plant: p, oee: Math.round((g[p].sum / g[p].n) * 100) / 100 };
  });
}

function renderPlantOeeTable(title, rows) {
  var th = 'style="border:1px solid #ccc;padding:6px;background:#0ea5e9;color:#fff;text-align:left"';
  var td = 'style="border:1px solid #ccc;padding:6px;font-weight:bold"';
  var html = '<h3 style="margin:16px 0 6px;color:#0369a1">' + title + '</h3>';
  if (!rows.length) return html + '<p style="color:#64748b">No data.</p>';
  html += '<table style="border-collapse:collapse;font-size:14px">'
    + '<tr><th ' + th + '>Plant</th><th ' + th + '>Overall OEE % (avg of lines)</th></tr>';
  rows.forEach(function (r) {
    html += '<tr><td ' + td + '>' + r.plant + '</td><td ' + td + '>' + r.oee + '%</td></tr>';
  });
  return html + '</table>';
}

function buildAdoptionEmailHtml(dayDate, dayRows, nightDate, nightRows, dayOee, nightOee) {
  return '<div style="font-family:Arial,sans-serif">'
    + '<h2 style="color:#15803d">Farmley OEE — App Adoption</h2>'
    + renderAdoptionTable('Day shift — ' + dayDate, dayRows)
    + renderAdoptionTable('Night shift — ' + nightDate, nightRows)
    + '<h2 style="color:#0369a1;margin-top:22px">Overall Plant OEE % (avg of lines)</h2>'
    + renderPlantOeeTable('Day shift — ' + dayDate, plantAvgFromLines(dayOee))
    + renderPlantOeeTable('Night shift — ' + nightDate, plantAvgFromLines(nightOee))
    + '<h2 style="color:#b45309;margin-top:22px">OEE % by Line (avg of machines)</h2>'
    + renderOeeTable('Day shift — ' + dayDate, dayOee || [])
    + renderOeeTable('Night shift — ' + nightDate, nightOee || [])
    + '<p style="color:#64748b;font-size:12px">Adoption: Red = partial · Dark red = not filled · Green = complete. '
    + 'Mixing excluded from Overall % for Purnia. Auto-generated from Supabase.</p></div>';
}

/* ------------------------------- Triggers -------------------------------- */

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Auto-sync enabled (every 5 min).');
}

function installEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'emailLatestAdoption') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('emailLatestAdoption').timeBased().atHour(EMAIL_HOUR).everyDays(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Daily adoption email enabled (' + EMAIL_HOUR + ':00).');
}

/* --------------------------- Email diagnostics --------------------------- */

/** Plain delivery test -> TEST_EMAIL. Confirms Gmail send works + grants scope. */
function testEmail() {
  MailApp.sendEmail({
    to: TEST_EMAIL,
    subject: 'Farmley OEE — test email',
    htmlBody: 'If you can read this, email delivery works.<br>Sent: ' + new Date(),
  });
}

/** Resend the latest date's adoption now, bypassing the "already sent" guard. */
function forceSendAdoption() {
  PropertiesService.getScriptProperties().deleteProperty('lastEmailedDate');
  emailLatestAdoption();
}
