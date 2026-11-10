
'use strict';

const {
  checkAccess,
  callBridge,
  apiError
} = require('../lib/google');

module.exports = async function handler(req, res) {

  // Health check hanya menerima GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      message: 'Method tidak didukung.'
    });
  }

  try {

    // Periksa kode akses petugas
    checkAccess(req);

    // Hubungkan ke Google Apps Script
    const info = await callBridge('health');

    // Pastikan respons berhasil
    if (!info || info.ok !== true) {
      throw new Error(
        info && info.message
          ? info.message
          : 'Koneksi Google gagal.'
      );
    }

    return res.status(200).json({

      ok: true,

      app: 'Helpdesk Serah Terima Paket',

      spreadsheetName:
        info.spreadsheetName,

      spreadsheetUrl:
        info.spreadsheetUrl,

      summarySheetUrl:
        info.summarySheetUrl,

      detailSheetUrl:
        info.detailSheetUrl,

      driveFolderName:
        info.driveFolderName,

      driveFolderUrl:
        info.driveFolderUrl,

      storageMode:
        info.storageMode

    });

  } catch (error) {

    console.error(
      'HEALTH CHECK ERROR:',
      error
    );

    return apiError(res, error);

  }

};
