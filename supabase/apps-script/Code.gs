/**
 * Farmley OEE — Google Apps Script Web App
 *
 * Receives OEE rows from the Supabase edge function and appends them to a sheet
 * named "OEE Records". Deploy as a Web App (Execute as: Me, Access: Anyone),
 * copy the /exec URL into the Supabase secret GSHEET_WEBAPP_URL.
 *
 * Set SHARED_SECRET below to the same value you store in GSHEET_SHARED_SECRET.
 */

var SHARED_SECRET = 'CHANGE_ME_to_a_long_random_string';
var SHEET_NAME = 'OEE Records';

var HEADERS = [
  'ID', 'Date', 'Plant', 'Line', 'Machine', 'Shift',
  'Planned Time (min)', 'Downtime (min)', 'Actual Output', 'Target Output',
  'Good Qty', 'Availability %', 'Performance %', 'Quality %', 'OEE %', 'Created At',
];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json({ error: 'unauthorized' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
    }
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

    sheet.appendRow([
      body.id,
      body.date,
      body.plant,
      body.line,
      body.machine,
      body.shift,
      body.planned_time_minutes,
      body.downtime_minutes,
      body.actual_output,
      body.target_output,
      body.good_qty,
      body.availability_pct,
      body.performance_pct,
      body.quality_pct,
      body.oee_pct,
      body.created_at,
    ]);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
