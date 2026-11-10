const { google } = require('googleapis');

const SUMMARY_SHEET = 'REKAP_BAGSHIELD';
const DETAIL_SHEET = 'DETAIL_PAKET';

const SUMMARY_HEADERS = [
  'ID Laporan', 'ID Bagshield', 'Tanggal Pengiriman', 'Nama Petugas',
  'HUB Pengirim', 'No Bagshield', 'Total Paket', 'Paket Ada Resi',
  'Paket Tanpa Resi', 'Waktu Simpan'
];

const DETAIL_HEADERS = [
  'ID Laporan', 'ID Bagshield', 'Tanggal Pengiriman', 'Nama Petugas',
  'HUB Pengirim', 'No Bagshield', 'Status Resi', 'No Resi / AWB',
  'Ciri-ciri / Keterangan Paket', 'Link Foto Google Drive',
  'Nama File Foto', 'Waktu Simpan'
];

function getSpreadsheetId() {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error('Environment GOOGLE_SPREADSHEET_ID belum diisi di Vercel.');
  return id.trim();
}

function checkAccess(req) {
  const expected = process.env.APP_ACCESS_PIN;
  if (!expected) throw new Error('APP_ACCESS_PIN belum diatur di Vercel Environment Variables.');
  const supplied = String(req.headers['x-app-pin'] || '');
  if (!supplied || supplied !== expected) {
    const error = new Error('Kode akses tidak benar atau sesi telah berakhir.');
    error.statusCode = 401;
    throw error;
  }
}

async function getGoogleClients() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!encoded) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 belum diisi di Vercel.');

  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error('Service Account JSON Base64 tidak valid. Periksa kembali Environment Variable.');
  }

  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });

  const authClient = await auth.getClient();
  return {
    sheets: google.sheets({ version: 'v4', auth: authClient }),
    drive: google.drive({ version: 'v3', auth: authClient }),
    serviceAccountEmail: credentials.client_email
  };
}

async function ensureSheet(sheets, spreadsheetId, title, headers) {
  let meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)'
  });

  let found = (meta.data.sheets || []).find(s => s.properties.title === title);
  let created = false;

  if (!found) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
    meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)'
    });
    found = (meta.data.sheets || []).find(s => s.properties.title === title);
    created = true;
  }

  if (!found) throw new Error(`Sheet ${title} tidak berhasil dibuat.`);

  const headerRange = `'${title.replace(/'/g, "''")}'!A1:${columnLetter(headers.length)}1`;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange
  });

  const currentHeaders = existing.data.values && existing.data.values[0];
  if (!currentHeaders || currentHeaders.every(v => !v)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
    created = true;
  } else if (headers.some((h, i) => currentHeaders[i] !== h)) {
    throw new Error(`Header pada sheet ${title} tidak sesuai. Gunakan sheet baru atau pulihkan header sesuai panduan.`);
  }

  if (created) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: found.properties.sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: headers.length
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.76, green: 0.09, blue: 0.34 },
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)'
          }
        }, {
          updateSheetProperties: {
            properties: { sheetId: found.properties.sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        }]
      }
    });
  }

  return { sheetId: found.properties.sheetId, title, headers };
}

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function getDriveFolder(drive) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID belum diisi. Buat folder foto di Google Drive dan masukkan ID-nya ke Vercel.');

  const response = await drive.files.get({
    fileId: folderId,
    fields: 'id,name,mimeType,webViewLink,driveId',
    supportsAllDrives: true
  });

  if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID bukan ID folder Google Drive.');
  }
  if (!response.data.driveId) {
    throw new Error('Folder foto harus berada di Shared Drive perusahaan. Service Account tidak memiliki kuota untuk membuat file di My Drive biasa. Pindahkan/buat folder pada Shared Drive lalu isi GOOGLE_DRIVE_FOLDER_ID dengan ID folder tersebut.');
  }
  return response.data;
}

async function initializeWorkspace() {
  const spreadsheetId = getSpreadsheetId();
  const { sheets, drive, serviceAccountEmail } = await getGoogleClients();

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'spreadsheetId,spreadsheetUrl,properties.title'
  });
  const folder = await getDriveFolder(drive);

  const summary = await ensureSheet(sheets, spreadsheetId, SUMMARY_SHEET, SUMMARY_HEADERS);
  const detail = await ensureSheet(sheets, spreadsheetId, DETAIL_SHEET, DETAIL_HEADERS);

  return {
    sheets,
    drive,
    spreadsheetId,
    spreadsheetUrl: spreadsheet.data.spreadsheetUrl,
    spreadsheetName: spreadsheet.data.properties.title,
    folder,
    serviceAccountEmail,
    summary,
    detail
  };
}

function apiError(res, error) {
  const status = error.statusCode || 500;
  return res.status(status).json({ ok: false, message: error.message || 'Terjadi kesalahan server.' });
}

module.exports = {
  SUMMARY_SHEET,
  DETAIL_SHEET,
  SUMMARY_HEADERS,
  DETAIL_HEADERS,
  checkAccess,
  getGoogleClients,
  getSpreadsheetId,
  ensureSheet,
  getDriveFolder,
  initializeWorkspace,
  apiError,
  columnLetter
};
