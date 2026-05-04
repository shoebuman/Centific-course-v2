function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var payload = JSON.parse(e.postData.contents || '{}');
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

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  sheet.appendRow(headers.map(function(header) {
    return payload[header] === undefined ? '' : payload[header];
  }));

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST');
}
