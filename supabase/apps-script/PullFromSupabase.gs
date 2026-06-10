/**
 * Farmley OEE — Pull data from Supabase into Google Sheets
 * ---------------------------------------------------------
 * Builds two tabs from Supabase (service_role key, bypasses RLS):
 *   "OEE Records"  — full mirror of oee_records, refreshed each sync.
 *   "App Adoption" — per Date+Plant adoption for Roasting + Packing lines.
 * Also emails the latest date's adoption to the recipients once daily.
 *
 * SETUP
 * 1. File -> Project Settings -> Time zone = Asia/Kolkata (for IST email time).
 * 2. Set SUPABASE_URL + SERVICE_KEY (Settings -> API -> service_role).
 * 3. Run "syncNow" (approve prompt). Run "installTrigger" (5-min sync) and
 *    "installEmailTrigger" (daily adoption email).
 *
 * SECURITY: service_role has full DB access. Keep this script private.
 */

var SUPABASE_URL = 'https://qvyoiovlblorahqkatlj.supabase.co';
var SERVICE_KEY  = 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

var SHEET_NAME = 'OEE Records';
var ADOPTION_SHEET = 'App Adoption';
var PAGE_SIZE  = 1000;

var EMAIL_HOUR = 20; // 8 PM project time (set project TZ to Asia/Kolkata)
var RECIPIENTS = [
  'saurabh.u@farmley.com',
  'ravi.ku@farmley.com',
  'himanshu.j@farmley.com',
  'ankit.t@farmley.com',
  'avinash.k@farmley.com',
  'aman.j@farmley.com',
  'sujeet.c@farmley.com',
  'vaibhav.s@farmley.com',
  'anand.v@farmley.com',
].join(',');

var HEADERS = [
  'ID', 'Date', 'Plant', 'Line', 'Machine', 'Shift', 'Units',
  'Planned Time (min)', 'Downtime (min) [Breakdown]', 'No. of Cycles',
  'Actual Output', 'Target Output', 'Good Qty',
  'Availability %', 'Performance %', 'Quality %', 'OEE %',
  'OEE Classification', 'Created By', 'Assigned Plants', 'Created At',
];

var ADOPTION_HEADERS = [
  'Date', 'Plant', 'Created By', 'Shift',
  'Roasting (Filled/Total)', 'Packing (Filled/Total)',
  'Overall Adoption %', 'Status',
];

var C_COMPLETE = '#C6EFCE';
var C_PARTIAL  = '#FF4D4D';
var C_NONE     = '#C00000';

// Adoption settings
var EXCLUDE_EMAILS = ['jatoth.r@farmley.com']; // entries by these users are ignored in adoption
var SHIFTS = ['Day', 'Night']; // every plant/day shows both shift rows

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
    .addSeparator()
    .addItem('Install auto-sync (5 min)', 'installTrigger')
    .addItem('Install daily adoption email', 'installEmailTrigger')
    .addToUi();
}

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

function fetchUserPlantsMap() {
  var map = {};
  sbGet('user_plants?select=user_id,plants(name)').forEach(function (r) {
    if (!map[r.user_id]) map[r.user_id] = [];
    if (r.plants && r.plants.name) map[r.user_id].push(r.plants.name);
  });
  return map;
}

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
  var machines = fetchMachines();
  var records = fetchAllRecords();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.clearContents();

  var rows = [HEADERS];
  records.forEach(function (r) {
    var u = userMap[r.created_by];
    rows.push([
      r.id, r.record_date,
      r.plants ? r.plants.name : '',
      r.lines ? r.lines.name : '',
      r.machines ? r.machines.name : '',
      r.shift || '', r.units || '',
      r.planned_time_minutes, r.downtime_minutes,
      (r.number_of_cycles === null || r.number_of_cycles === undefined) ? '' : r.number_of_cycles,
      r.actual_output, r.target_output, r.good_qty,
      r.availability_pct, r.performance_pct, r.quality_pct, r.oee_pct,
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

  writeAdoptionSheet(buildAdoption(records, machines, userMap));
}

function buildAdoption(records, machines, userMap) {
  var totalRoast = {}, totalPack = {};
  machines.forEach(function (m) {
    var plant = m.plants ? m.plants.name : '';
    var line = (m.lines ? m.lines.name : '').toLowerCase();
    if (line.indexOf('roasting') !== -1) totalRoast[plant] = (totalRoast[plant] || 0) + 1;
    else if (line.indexOf('packing') !== -1) totalPack[plant] = (totalPack[plant] || 0) + 1;
  });

  var excluded = {};
  Object.keys(userMap).forEach(function (id) {
    if (userMap[id].email && EXCLUDE_EMAILS.indexOf(userMap[id].email) !== -1) excluded[id] = 1;
  });

  // Keyed by date|plant|shift (shift = Day/Night).
  var filledRoast = {}, filledPack = {}, creators = {}, dateSet = {};
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
    if (!isR && !isP) return;
    var key = r.record_date + '|' + plant + '|' + shift;
    if (isR) { filledRoast[key] = filledRoast[key] || {}; if (r.machines) filledRoast[key][r.machines.name] = 1; }
    if (isP) { filledPack[key]  = filledPack[key]  || {}; if (r.machines) filledPack[key][r.machines.name]  = 1; }
    creators[key] = creators[key] || {};
    var u = userMap[r.created_by];
    creators[key][u ? u.label : (r.created_by || '')] = 1;
  });

  var plantsWith = {};
  Object.keys(totalRoast).forEach(function (p) { plantsWith[p] = 1; });
  Object.keys(totalPack).forEach(function (p) { plantsWith[p] = 1; });

  var dates = Object.keys(dateSet).sort();
  var plants = Object.keys(plantsWith).sort();

  var out = [];
  dates.forEach(function (date) {
    plants.forEach(function (plant) {
      var tR = totalRoast[plant] || 0, tP = totalPack[plant] || 0;
      var totalAll = tR + tP;
      if (totalAll === 0) return;
      SHIFTS.forEach(function (shift) {       // always emit both Day and Night rows
        var key = date + '|' + plant + '|' + shift;
        var fR = filledRoast[key] ? Object.keys(filledRoast[key]).length : 0;
        var fP = filledPack[key] ? Object.keys(filledPack[key]).length : 0;
        var filledAll = fR + fP;
        var pct = Math.round((filledAll / totalAll) * 1000) / 10;
        var status = filledAll === 0 ? 'Not Filled'
                   : (filledAll < totalAll ? 'Partial' : 'Complete');
        out.push({
          date: date, plant: plant,
          createdBy: creators[key] ? Object.keys(creators[key]).sort().join(', ') : '—',
          shift: shift,
          roasting: fR + '/' + tR, packing: fP + '/' + tP,
          pct: pct, status: status,
        });
      });
    });
  });
  return out;
}

function statusColor(status) {
  if (status === 'Complete') return C_COMPLETE;
  if (status === 'Partial') return C_PARTIAL;
  return C_NONE;
}

function writeAdoptionSheet(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ADOPTION_SHEET) || ss.insertSheet(ADOPTION_SHEET);
  sheet.clear();

  var values = [ADOPTION_HEADERS];
  rows.forEach(function (r) {
    values.push([r.date, r.plant, r.createdBy, r.shift, r.roasting, r.packing, r.pct, r.status]);
  });
  sheet.getRange(1, 1, values.length, ADOPTION_HEADERS.length).setValues(values);
  sheet.getRange(1, 1, 1, ADOPTION_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  for (var i = 0; i < rows.length; i++) {
    var bg = statusColor(rows[i].status);
    var font = (rows[i].status === 'Not Filled') ? '#FFFFFF' : '#000000';
    sheet.getRange(i + 2, 7, 1, 2).setBackground(bg).setFontColor(font);
  }
}

function emailLatestAdoption() {
  var userMap = fetchUserMap();
  var machines = fetchMachines();
  var records = fetchAllRecords();
  var rows = buildAdoption(records, machines, userMap);
  if (!rows.length) return;

  var maxDate = rows.reduce(function (a, r) { return r.date > a ? r.date : a; }, rows[0].date);
  var todays = rows.filter(function (r) { return r.date === maxDate; });

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('lastEmailedDate') === maxDate) return;

  MailApp.sendEmail({
    to: RECIPIENTS,
    subject: 'Farmley OEE — App Adoption (' + maxDate + ')',
    htmlBody: buildAdoptionEmailHtml(maxDate, todays),
  });
  props.setProperty('lastEmailedDate', maxDate);
}

function buildAdoptionEmailHtml(date, rows) {
  var th = 'style="border:1px solid #ccc;padding:6px;background:#16a34a;color:#fff;text-align:left"';
  var td = 'style="border:1px solid #ccc;padding:6px"';
  var html = '<div style="font-family:Arial,sans-serif">'
    + '<h2 style="color:#15803d">Farmley OEE — App Adoption</h2>'
    + '<p>Adoption summary for <b>' + date + '</b> (Roasting + Packing lines).</p>'
    + '<table style="border-collapse:collapse;font-size:14px">'
    + '<tr><th ' + th + '>Plant</th><th ' + th + '>Created By</th><th ' + th + '>Shift</th>'
    + '<th ' + th + '>Roasting</th><th ' + th + '>Packing</th>'
    + '<th ' + th + '>Overall %</th><th ' + th + '>Status</th></tr>';
  rows.forEach(function (r) {
    var bg = statusColor(r.status);
    var fc = (r.status === 'Not Filled') ? '#fff' : '#000';
    html += '<tr>'
      + '<td ' + td + '>' + r.plant + '</td>'
      + '<td ' + td + '>' + r.createdBy + '</td>'
      + '<td ' + td + '>' + r.shift + '</td>'
      + '<td ' + td + '>' + r.roasting + '</td>'
      + '<td ' + td + '>' + r.packing + '</td>'
      + '<td ' + td + '>' + r.pct + '%</td>'
      + '<td style="border:1px solid #ccc;padding:6px;background:' + bg + ';color:' + fc + '">' + r.status + '</td>'
      + '</tr>';
  });
  html += '</table>'
    + '<p style="color:#64748b;font-size:12px">Red = partially filled · Dark red = not filled · Green = complete. '
    + 'Auto-generated from Supabase.</p></div>';
  return html;
}

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
