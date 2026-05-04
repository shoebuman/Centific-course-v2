// ─── Centific Medical Transcription – Score Receiver ────────────────────────
//
// DEPLOYMENT STEPS (do this every time you change the script):
//   1. Click Deploy → Manage deployments → Edit (pencil icon)
//   2. Change "Version" to "New version"
//   3. Set "Who has access" → "Anyone"          ← critical
//   4. Click Deploy and copy the new /exec URL into app.js
//
// NOTE: ContentService does NOT support .setHeader(), so CORS headers cannot
// be returned from Apps Script. The front-end must use mode:"no-cors" +
// Content-Type:"text/plain" (a "simple request") to bypass the preflight.
// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    var headers = [
      'timestamp',
      'username',
      'selectedLocale',
      'courseLanguage',
      'course',
      'score',
      'total',
      'percentage',
      'passingScore',
      'status'
    ];

    // Write header row once
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
    }

    var row = headers.map(function (h) {
      return payload[h] !== undefined ? payload[h] : '';
    });

    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Log the error so you can inspect it in Apps Script → Executions
    console.error('doPost error:', err.message);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Handy test function — run this manually inside Apps Script editor ─────────
// Click the ▶ Run button while this function is selected to write a test row.
function testDoPost() {
  var fakeEvent = {
    postData: {
      contents: JSON.stringify({
        timestamp: new Date().toISOString(),
        username: 'test.user',
        selectedLocale: 'English / UK',
        courseLanguage: 'en',
        course: 'Medical Transcription Training',
        score: 24,
        total: 30,
        percentage: 80,
        passingScore: 23,
        status: 'Passed'
      })
    }
  };
  var result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
