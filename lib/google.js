
'use strict';

const crypto = require('node:crypto');

// Validasi Environment Variables
function requiredEnv(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(
      `Environment Variable ${name} belum diatur di Vercel.`
    );
  }

  return String(value).trim();
}

// Validasi kode akses petugas
function checkAccess(req) {
  const expected = requiredEnv('APP_ACCESS_PIN');
  const supplied = String(req.headers['x-app-pin'] || '');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');

  if (
    !supplied ||
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    const error = new Error(
      'Kode akses tidak benar atau sesi telah berakhir.'
    );

    error.statusCode = 401;
    throw error;
  }
}

// Konfigurasi Apps Script Bridge
function getBridgeConfig() {
  return {
    url: requiredEnv('APPS_SCRIPT_WEB_APP_URL'),
    secret: requiredEnv('APPS_SCRIPT_SHARED_SECRET'),
    spreadsheetId: requiredEnv('GOOGLE_SPREADSHEET_ID'),
    driveFolderId: requiredEnv('GOOGLE_DRIVE_FOLDER_ID')
  };
}

// Kirim permintaan dari Vercel ke Google Apps Script
async function callBridge(action, payload = {}) {
  const config = getBridgeConfig();

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    25000
  );

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      redirect: 'follow',

      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },

      body: JSON.stringify({
        secret: config.secret,
        action: action,

        config: {
          spreadsheetId: config.spreadsheetId,
          driveFolderId: config.driveFolderId
        },

        payload: payload
      }),

      signal: controller.signal
    });

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch (error) {
      const preview = raw
        .replace(/\s+/g, ' ')
        .slice(0, 240);

      throw new Error(
        `Google Apps Script mengirim respons bukan JSON (HTTP ${response.status}). ` +
        `Periksa URL Web App, deployment Anyone, dan izin Google. ` +
        `Respons: ${preview || '(kosong)'}`
      );
    }

    if (!response.ok || !data || data.ok !== true) {
      throw new Error(
        data && data.message
          ? data.message
          : `Bridge gagal (HTTP ${response.status}).`
      );
    }

    return data;

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        'Waktu tunggu Google Apps Script habis. Coba lagi; draft tetap berada di browser.'
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

// Format respons error API
function apiError(res, error) {
  const status = Number(error.statusCode) || 500;

  return res.status(status).json({
    ok: false,
    message: error.message || 'Terjadi kesalahan server.'
  });
}

module.exports = {
  checkAccess,
  callBridge,
  apiError
};
